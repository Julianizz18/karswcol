// Biblioteca común de las pruebas de carga de KARSWCOL (k6).
//
// Simula lo que hace un navegador real:
//   1. Carga el cliente estático y consulta la API de sesión (HTTP).
//   2. Inicia sesión con el endpoint sintético /api/auth/loadtest (en vez de
//      Google), que solo existe si el servidor arrancó con LOAD_TEST_TOKEN.
//   3. Abre el WebSocket, entra a la sala, se marca listo y, durante la
//      carrera, envía controles (acelerar/girar) como lo haría un teclado.
//
// La sala admite 8 pilotos: los VUs que llegan después reciben
// "join_rejected" y se quedan conectados como espectadores, que igual
// reciben los 20 mensajes de estado por segundo. Así se mide el costo real
// del servidor: el broadcast crece con el número de conexiones.

import http from 'k6/http';
import ws from 'k6/ws';
import { check, fail, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const WS_URL = BASE_URL.replace(/^http/, 'ws');
const LOAD_TEST_TOKEN = __ENV.LOAD_TEST_TOKEN || '';
const INPUT_INTERVAL_MS = Number(__ENV.INPUT_INTERVAL_MS || 100); // un teclado real manda ~10 cambios/s
const BOTS = (__ENV.BOTS || 'true') === 'true'; // llenar la parrilla con bots = más trabajo por tick

// ------------------------------------------------------------ métricas propias
// Tiempo entre dos mensajes "state" consecutivos. El servidor emite uno cada
// 50 ms; si este valor sube, los jugadores ven el juego a saltos.
export const stateGap = new Trend('karswcol_state_gap', true);
// Desde que se envía "join" hasta recibir "joined" o "join_rejected".
export const joinLatency = new Trend('karswcol_join_latency', true);
export const joined = new Counter('karswcol_joined');
export const joinRejected = new Counter('karswcol_join_rejected');
export const racesSeen = new Counter('karswcol_races_seen');
export const stateMessages = new Counter('karswcol_state_messages');
export const wsSessionOk = new Rate('karswcol_ws_session_ok');
export const loginOk = new Rate('karswcol_login_ok');

// Umbrales de aceptación (SLO). Si alguno falla, k6 termina con código ≠ 0.
export const THRESHOLDS = {
  checks: ['rate>0.99'],
  http_req_failed: ['rate<0.01'],
  'http_req_duration{kind:static}': ['p(95)<300'],
  'http_req_duration{kind:api}': ['p(95)<200'],
  ws_connecting: ['p(95)<500'],
  karswcol_login_ok: ['rate>0.99'],
  karswcol_ws_session_ok: ['rate>0.99'],
  karswcol_join_latency: ['p(95)<250'],
  // 50 ms ideal; hasta 100 ms en p95 todavía se juega fluido.
  karswcol_state_gap: ['p(95)<100', 'p(99)<200']
};

// ------------------------------------------------------------ HTTP
const STATIC_ASSETS = ['/', '/css/style.css', '/js/app.js', '/js/network.js', '/js/race3d.js', '/img/menu-bg.jpg'];

/** Un visitante que abre la página: carga el cliente y consulta la API. */
export function browse() {
  group('cargar cliente', () => {
    const responses = http.batch(STATIC_ASSETS.map(p => ['GET', `${BASE_URL}${p}`, null, { tags: { kind: 'static', name: p } }]));
    for (const res of responses) {
      check(res, { 'estático 200': r => r.status === 200 });
    }
  });
  group('api de sesión', () => {
    const config = http.get(`${BASE_URL}/api/auth/config`, { tags: { kind: 'api', name: '/api/auth/config' } });
    check(config, { 'config 200': r => r.status === 200 });
    // Sin sesión /me responde 401: es lo esperado, no un error.
    const me = http.get(`${BASE_URL}/api/auth/me`, {
      tags: { kind: 'api', name: '/api/auth/me' },
      responseCallback: http.expectedStatuses(200, 401)
    });
    check(me, { 'me 200/401': r => r.status === 200 || r.status === 401 });
  });
}

// ------------------------------------------------------------ sesión
let sessionCookie = null; // una sesión por VU, reutilizada entre iteraciones

export function login() {
  if (sessionCookie) return sessionCookie;
  if (!LOAD_TEST_TOKEN) {
    fail('Falta LOAD_TEST_TOKEN: debe ser el mismo valor con el que arrancó el servidor.');
  }
  const res = http.post(`${BASE_URL}/api/auth/loadtest`, JSON.stringify({ name: `k6 ${__VU}` }), {
    headers: { 'Content-Type': 'application/json', 'x-load-test-token': LOAD_TEST_TOKEN },
    tags: { kind: 'api', name: '/api/auth/loadtest' }
  });
  const cookie = res.cookies.karswcol_session && res.cookies.karswcol_session[0];
  const ok = check(res, {
    'login 200': r => r.status === 200,
    'login entrega cookie de sesión': () => !!cookie
  });
  loginOk.add(ok);
  if (!ok) return null;
  sessionCookie = `karswcol_session=${cookie.value}`;
  return sessionCookie;
}

// ------------------------------------------------------------ jugador
const COLORS = ['#FCD116', '#003893', '#CE1126', '#1E8C3A', '#F28C28', '#7B2CBF', '#00A6A6', '#E5E5E5'];

function randomInput() {
  const r = Math.random();
  return { up: Math.random() < 0.9, down: false, left: r < 0.25, right: r > 0.75 };
}

/**
 * Un piloto conectado durante `seconds` segundos. Si consigue cupo en la sala
 * corre (y vuelve a correr cuando termina la carrera); si no, mira como espectador.
 */
export function play(seconds = 60) {
  const cookie = login();
  if (!cookie) {
    wsSessionOk.add(false);
    sleep(1);
    return;
  }

  let opened = false;
  const res = ws.connect(WS_URL, { headers: { Cookie: cookie }, tags: { name: 'ws' } }, socket => {
    let myId = null;
    let racing = false;
    let lastStateAt = 0;
    let joinSentAt = 0;
    let readySent = false;

    const send = msg => socket.send(JSON.stringify(msg));

    socket.on('open', () => {
      opened = true;
      joinSentAt = Date.now();
      send({ type: 'join', name: `k6-${__VU}`, color: COLORS[__VU % COLORS.length] });
    });

    socket.on('message', raw => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (e) {
        return;
      }
      switch (msg.type) {
        case 'joined':
          myId = msg.id;
          joinLatency.add(Date.now() - joinSentAt);
          joined.add(1);
          if (BOTS) send({ type: 'toggle_bots', enabled: true });
          break;
        case 'join_rejected':
          joinLatency.add(Date.now() - joinSentAt);
          joinRejected.add(1);
          break; // se queda como espectador
        case 'lobby_update': {
          // Tras cada carrera el servidor reinicia "listo": hay que volver a marcarlo.
          const me = myId && (msg.players || []).find(p => p.id === myId);
          if (me && !me.ready && !readySent) {
            readySent = true;
            send({ type: 'ready' });
          } else if (me && me.ready) {
            readySent = false;
          }
          break;
        }
        case 'race_start':
          racing = true;
          lastStateAt = 0;
          if (myId) racesSeen.add(1);
          break;
        case 'state': {
          const now = Date.now();
          if (lastStateAt) stateGap.add(now - lastStateAt);
          lastStateAt = now;
          stateMessages.add(1);
          break;
        }
        case 'pause':
          lastStateAt = 0; // el hueco de una pausa no es latencia
          break;
        case 'results':
          racing = false;
          lastStateAt = 0;
          readySent = false;
          // Unos segundos en el podio y de vuelta al lobby para otra carrera.
          if (myId) socket.setTimeout(() => send({ type: 'restart' }), 3000 + Math.random() * 2000);
          break;
        default:
          break;
      }
    });

    socket.setInterval(() => {
      if (myId && racing) send({ type: 'input', input: randomInput() });
    }, INPUT_INTERVAL_MS);

    socket.on('error', e => {
      if (e.error() !== 'websocket: close sent') console.warn(`VU ${__VU}: error de WebSocket: ${e.error()}`);
    });

    socket.setTimeout(() => socket.close(), seconds * 1000);
  });

  const ok = check(res, { 'handshake WebSocket 101': r => r && r.status === 101 });
  wsSessionOk.add(ok && opened);
}

/** Lee un número de __ENV con valor por defecto. */
export function envNumber(name, fallback) {
  const v = Number(__ENV[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Convierte "90s", "5m" o "1h" a segundos (para sumar duraciones de escenarios). */
export function durationSeconds(text) {
  const m = /^(\d+(?:\.\d+)?)(s|m|h)$/.exec(String(text).trim());
  if (!m) throw new Error(`Duración inválida: "${text}" (usa por ejemplo 90s, 5m o 1h)`);
  return Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2]];
}
