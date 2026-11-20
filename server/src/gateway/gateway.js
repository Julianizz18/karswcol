import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { SESSION_COOKIE, publicUser } from '../auth/authService.js';
import { logger } from '../observability/logger.js';
import {
  register, httpRequestsTotal, httpRequestDuration, wsConnections, wsConnectionsTotal,
  wsMessagesReceived, wsMessagesSent, wsBytesSent, wsBroadcastDuration, joinRejections
} from '../observability/metrics.js';

// Connection Gateway (HU01, componente "Connection Gateway" de la sección
// 4.1). Es el único punto de entrada de red: sirve el cliente estático,
// acepta conexiones WebSocket y traduce mensajes JSON hacia la sala de
// carrera. No conoce reglas de juego ni de matchmaking, solo enruta.
// También expone los endpoints de operación: /health y /metrics (Prometheus).

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const MAX_BODY_BYTES = 16 * 1024;
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Body demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function sessionCookie(req, value, maxAgeSeconds) {
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

// Mismo origen que el servidor: evita que otra página abra el WebSocket o
// inicie sesión usando la cookie del usuario.
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// Ruta para las etiquetas de métricas: solo valores conocidos, así una URL
// arbitraria no crea series nuevas en Prometheus (cardinalidad acotada).
const KNOWN_ROUTES = new Set([
  '/', '/health', '/metrics',
  '/api/auth/config', '/api/auth/me', '/api/auth/google', '/api/auth/logout', '/api/auth/loadtest'
]);

function routeLabel(url, status) {
  const pathname = String(url || '').split('?')[0];
  if (KNOWN_ROUTES.has(pathname)) return pathname;
  if (pathname.startsWith('/api/')) return '/api/other';
  return status === 404 ? 'not_found' : 'static';
}

const CLIENT_MESSAGE_TYPES = new Set([
  'join', 'ready', 'select_track', 'select_time', 'select_difficulty', 'toggle_bots', 'input', 'toggle_pause', 'restart'
]);

// Límite de mensajes por conexión (token bucket). Un jugador real manda
// unos pocos por segundo (solo cuando cambia una tecla) y k6 unos 10/s.
// Lo que pase de ahí se descarta; quien insista muy por encima se desconecta.
export const MESSAGE_RATE_PER_SEC = 30;
export const MESSAGE_BURST = 60;
export const MAX_DROPPED_BEFORE_CLOSE = 300;

function createRateLimiter(now = Date.now()) {
  let tokens = MESSAGE_BURST;
  let last = now;
  let dropped = 0;
  return {
    /** true si el mensaje se puede procesar. */
    allow(t = Date.now()) {
      tokens = Math.min(MESSAGE_BURST, tokens + ((t - last) / 1000) * MESSAGE_RATE_PER_SEC);
      last = t;
      if (tokens >= 1) {
        tokens -= 1;
        return true;
      }
      dropped += 1;
      return false;
    },
    get dropped() { return dropped; }
  };
}

function joinRejectionReason(text) {
  return /llena/i.test(text) ? 'room_full' : /curso/i.test(text) ? 'race_in_progress' : /pestaña/i.test(text) ? 'already_joined' : 'other';
}

// Rutas de la API de autenticación. Devuelve true si atendió la petición.
async function handleAuthApi(req, res, auth, onLogout = () => {}) {
  const url = req.url.split('?')[0];
  if (!url.startsWith('/api/')) return false;

  if (url === '/api/auth/config' && req.method === 'GET') {
    sendJson(res, 200, { googleClientId: auth.clientId });
  } else if (url === '/api/auth/me' && req.method === 'GET') {
    const session = auth.sessionFromRequest(req);
    const headers = session ? { 'Set-Cookie': sessionCookie(req, auth.renewSession(session), SESSION_MAX_AGE_SECONDS) } : {};
    sendJson(res, session ? 200 : 401, { user: publicUser(session) }, { 'Cache-Control': 'no-store', ...headers });
  } else if (url === '/api/auth/google' && req.method === 'POST') {
    if (!isSameOrigin(req)) {
      sendJson(res, 403, { error: 'Origen no permitido.' });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      const { user, token } = await auth.loginWithGoogle(body.credential);
      logger.info('auth.login', { provider: 'google' });
      sendJson(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(req, token, SESSION_MAX_AGE_SECONDS) });
    } catch (err) {
      logger.warn('auth.login_failed', { provider: 'google', reason: err.message });
      sendJson(res, 401, { error: err.message || 'No se pudo iniciar sesión.' });
    }
  } else if (url === '/api/auth/loadtest' && req.method === 'POST' && auth.loadTestEnabled) {
    // Solo existe si el servidor arrancó con LOAD_TEST_TOKEN (pruebas con k6).
    try {
      const body = await readJsonBody(req);
      const { user, token } = auth.loginForLoadTest(req.headers['x-load-test-token'], body.name);
      sendJson(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(req, token, SESSION_MAX_AGE_SECONDS) });
    } catch (err) {
      logger.warn('auth.login_failed', { provider: 'loadtest', reason: err.message });
      sendJson(res, 401, { error: err.message });
    }
  } else if (url === '/api/auth/logout' && req.method === 'POST') {
    const session = auth.sessionFromRequest(req);
    if (session) {
      auth.revokeSession(session);
      onLogout(session.sid);
      logger.info('auth.logout');
    }
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  } else {
    sendJson(res, 404, { error: 'Not found' });
  }
  return true;
}

function hasBearerToken(req, expected) {
  const given = Buffer.from(String(req.headers.authorization || ''));
  const wanted = Buffer.from(`Bearer ${expected}`);
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
}

export function createGateway({ clientDir, room, auth, metricsToken = process.env.METRICS_TOKEN || '' }) {
  const clients = new Map(); // id -> ws
  const sessionOf = new Map(); // id -> sid de la sesión con que se conectó

  // Al cerrar sesión, las pestañas abiertas con esa sesión se desconectan.
  function closeSessionSockets(sid) {
    if (!sid) return;
    for (const [connId, connSid] of sessionOf) {
      if (connSid === sid) clients.get(connId)?.close(4401, 'Sesión cerrada');
    }
  }
  let nextId = 1;
  const startedAt = Date.now();

  // Endpoints de operación: /health para Docker/balanceadores y /metrics para Prometheus.
  async function handleOpsEndpoints(req, res) {
    const url = req.url.split('?')[0];
    if (url === '/health' && req.method === 'GET') {
      sendJson(res, 200, {
        status: 'ok',
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        roomState: room.state ?? null,
        connections: clients.size
      }, { 'Cache-Control': 'no-store' });
      return true;
    }
    if (url === '/metrics' && req.method === 'GET') {
      // En un despliegue público (Render) METRICS_TOKEN protege las métricas
      // internas; sin definir (Docker Compose local) quedan abiertas para Prometheus.
      if (metricsToken && !hasBearerToken(req, metricsToken)) {
        res.writeHead(401, { 'WWW-Authenticate': 'Bearer' });
        res.end('Unauthorized');
        return true;
      }
      res.writeHead(200, { 'Content-Type': register.contentType, 'Cache-Control': 'no-store' });
      res.end(await register.metrics());
      return true;
    }
    return false;
  }

  async function handleRequest(req, res) {
    if (await handleOpsEndpoints(req, res)) return;
    if (await handleAuthApi(req, res, auth, closeSessionSockets)) return;

    let filePath = req.url === '/' ? '/index.html' : req.url;
    try {
      filePath = path.join(clientDir, decodeURIComponent(filePath.split('?')[0]));
    } catch {
      // URL mal codificada (p. ej. "/%"): sin este catch tumbaba el proceso.
      res.writeHead(400);
      res.end('Bad request');
      return;
    }

    if (!filePath.startsWith(clientDir + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.stat(filePath, (statErr, stat) => {
      if (statErr || !stat.isFile()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      const lastModified = stat.mtime.toUTCString();
      const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Last-Modified': lastModified,
        'Cache-Control': cacheControlFor(filePath, ext)
      };
      // El navegador ya tiene la versión actual: 304 sin cuerpo.
      const since = Date.parse(req.headers['if-modified-since'] || '');
      if (!Number.isNaN(since) && Math.floor(stat.mtimeMs / 1000) * 1000 <= since) {
        res.writeHead(304, headers);
        res.end();
        return;
      }
      res.writeHead(200, { ...headers, 'Content-Length': stat.size });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
    });
  }

  // Imágenes y librerías de vendor/ casi nunca cambian: caché de un día.
  // HTML, JS y CSS se revalidan siempre (304 si no cambiaron), así un
  // despliegue nuevo se ve de inmediato.
  function cacheControlFor(filePath, ext) {
    const isVendor = filePath.startsWith(path.join(clientDir, 'vendor') + path.sep);
    const isImage = ['.png', '.jpg', '.jpeg', '.svg'].includes(ext);
    return isVendor || isImage ? 'public, max-age=86400' : 'no-cache';
  }

  const server = http.createServer((req, res) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const route = routeLabel(req.url, res.statusCode);
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      httpRequestsTotal.inc({ method: req.method, route, status: res.statusCode });
      httpRequestDuration.observe({ method: req.method, route }, seconds);
    });
    handleRequest(req, res).catch(err => {
      logger.error('http.unhandled_error', { route: routeLabel(req.url), err });
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  const wss = new WebSocketServer({ server });

  function sendTo(ws, message) {
    const payload = JSON.stringify(message);
    ws.send(payload);
    wsMessagesSent.inc({ type: message.type });
    wsBytesSent.inc(Buffer.byteLength(payload));
  }

  function broadcast(message) {
    const end = wsBroadcastDuration.startTimer();
    const payload = JSON.stringify(message);
    let sent = 0;
    for (const ws of clients.values()) {
      if (ws.readyState === ws.OPEN) {
        ws.send(payload);
        sent += 1;
      }
    }
    end();
    if (sent > 0) {
      wsMessagesSent.inc({ type: message.type }, sent);
      wsBytesSent.inc(Buffer.byteLength(payload) * sent);
    }
  }
  room.broadcast = broadcast;

  wss.on('connection', (ws, req) => {
    // Solo usuarios con sesión de Google válida pueden entrar a la sala.
    const session = auth.sessionFromRequest(req);
    if (!session || !isSameOrigin(req)) {
      wsConnectionsTotal.inc({ result: 'rejected' });
      logger.warn('ws.rejected', { reason: session ? 'origin' : 'unauthenticated' });
      ws.close(4401, 'No autenticado');
      return;
    }

    const id = String(nextId++);
    // Solo quien entró a la sala puede controlarla: una pestaña que se quedó
    // en el menú no debe cambiar la pista ni reiniciar la carrera de otros.
    let joined = false;
    // Id del kart en la sala: el de esta conexión, o el que recuperó al volver.
    let playerId = id;
    const limiter = createRateLimiter();
    clients.set(id, ws);
    sessionOf.set(id, session.sid);
    wsConnectionsTotal.inc({ result: 'accepted' });
    wsConnections.set(clients.size);
    logger.debug('ws.connected', { connId: id, connections: clients.size });

    ws.on('message', raw => {
      if (!limiter.allow()) {
        wsMessagesReceived.inc({ type: 'rate_limited' });
        if (limiter.dropped === MAX_DROPPED_BEFORE_CLOSE) {
          logger.warn('ws.rate_limited_close', { connId: id });
          ws.close(1008, 'Demasiados mensajes');
        }
        return;
      }
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        wsMessagesReceived.inc({ type: 'invalid' });
        return;
      }
      // JSON válido pero no objeto ("null", "3", ...): se ignora en vez de tumbar el proceso.
      if (!msg || typeof msg !== 'object') {
        wsMessagesReceived.inc({ type: 'invalid' });
        return;
      }
      wsMessagesReceived.inc({ type: CLIENT_MESSAGE_TYPES.has(msg.type) ? msg.type : 'unknown' });
      if (msg.type !== 'join' && !joined) return;

      switch (msg.type) {
        case 'join': {
          const name = String(msg.name || session.name || `Piloto ${id}`).slice(0, 20);
          const color = /^#[0-9a-fA-F]{6}$/.test(msg.color) ? msg.color : '#FCD116';
          // La foto sale de la sesión de Google, nunca del mensaje del cliente.
          if (joined) break;
          const result = room.join(id, { name, color, avatar: session.picture, userKey: session.sub });
          if (result.rejection) {
            joinRejections.inc({ reason: joinRejectionReason(result.rejection) });
            logger.info('room.join_rejected', { connId: id, reason: result.rejection });
            sendTo(ws, { type: 'join_rejected', reason: result.rejection });
            break;
          }
          joined = true;
          playerId = result.playerId;
          logger.info('room.joined', { connId: id, rejoined: result.rejoined });
          sendTo(ws, { type: 'joined', id: playerId, rejoined: result.rejoined });
          // Quien vuelve a mitad de carrera recibe la pista y el estado de pausa.
          if (result.rejoined) for (const m of room.resyncMessages()) sendTo(ws, m);
          break;
        }
        case 'ready':
          room.setReady(playerId);
          break;
        case 'select_track':
          room.selectTrack(String(msg.trackId || ''));
          break;
        case 'select_time':
          room.selectTimeOfDay(String(msg.timeOfDay || ''));
          break;
        case 'select_difficulty':
          room.selectDifficulty(String(msg.difficulty || ''));
          break;
        case 'toggle_bots':
          room.toggleBots(!!msg.enabled);
          break;
        case 'input':
          room.setInput(playerId, msg.input);
          break;
        case 'toggle_pause':
          room.togglePause(playerId);
          break;
        case 'restart':
          room.requestRestart();
          break;
        default:
          break;
      }
    });

    ws.on('close', () => {
      clients.delete(id);
      sessionOf.delete(id);
      wsConnections.set(clients.size);
      logger.debug('ws.disconnected', { connId: id, connections: clients.size });
      // Una conexión que nunca entró no está en la sala: sacarla mandaba un
      // lobby_update a todos, incluso en plena carrera.
      if (joined) room.handleDisconnect(playerId);
    });
  });

  return server;
}
