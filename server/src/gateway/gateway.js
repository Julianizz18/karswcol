import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { SESSION_COOKIE, publicUser } from '../auth/authService.js';

// Connection Gateway (HU01, componente "Connection Gateway" de la sección
// 4.1). Es el único punto de entrada de red: sirve el cliente estático,
// acepta conexiones WebSocket y traduce mensajes JSON hacia la sala de
// carrera. No conoce reglas de juego ni de matchmaking, solo enruta.

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

// Rutas de la API de autenticación. Devuelve true si atendió la petición.
async function handleAuthApi(req, res, auth) {
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
      sendJson(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(req, token, SESSION_MAX_AGE_SECONDS) });
    } catch (err) {
      sendJson(res, 401, { error: err.message || 'No se pudo iniciar sesión.' });
    }
  } else if (url === '/api/auth/logout' && req.method === 'POST') {
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  } else {
    sendJson(res, 404, { error: 'Not found' });
  }
  return true;
}

export function createGateway({ clientDir, room, auth }) {
  const server = http.createServer(async (req, res) => {
    if (await handleAuthApi(req, res, auth)) return;

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

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });

  const wss = new WebSocketServer({ server });
  const clients = new Map(); // id -> ws
  let nextId = 1;

  function broadcast(message) {
    const payload = JSON.stringify(message);
    for (const ws of clients.values()) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }
  room.broadcast = broadcast;

  wss.on('connection', (ws, req) => {
    // Solo usuarios con sesión de Google válida pueden entrar a la sala.
    const session = auth.sessionFromRequest(req);
    if (!session || !isSameOrigin(req)) {
      ws.close(4401, 'No autenticado');
      return;
    }

    const id = String(nextId++);
    clients.set(id, ws);

    ws.on('message', raw => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      // JSON válido pero no objeto ("null", "3", ...): se ignora en vez de tumbar el proceso.
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'join': {
          const name = String(msg.name || session.name || `Piloto ${id}`).slice(0, 20);
          const color = /^#[0-9a-fA-F]{6}$/.test(msg.color) ? msg.color : '#FCD116';
          // La foto sale de la sesión de Google, nunca del mensaje del cliente.
          const rejection = room.addPlayer(id, name, color, session.picture);
          ws.send(JSON.stringify(rejection ? { type: 'join_rejected', reason: rejection } : { type: 'joined', id }));
          break;
        }
        case 'ready':
          room.setReady(id);
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
          room.setInput(id, msg.input);
          break;
        case 'toggle_pause':
          room.togglePause(id);
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
      room.removePlayer(id);
    });
  });

  return server;
}
