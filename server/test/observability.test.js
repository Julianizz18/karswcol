import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createGateway } from '../src/gateway/gateway.js';
import { createAuthService } from '../src/auth/authService.js';
import { RaceRoom } from '../src/raceRoom.js';

// Observabilidad y pruebas de carga: /health, /metrics (formato Prometheus)
// y el login sintético que usa k6, que solo existe con LOAD_TEST_TOKEN.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const LOAD_TEST_TOKEN = 'token-k6-de-prueba';

let server;
let serverSinCarga;
let base;
let baseSinCarga;
let room;

before(async () => {
  room = new RaceRoom(() => {});
  const auth = createAuthService({ clientId: 'x', sessionSecret: 's', loadTestToken: LOAD_TEST_TOKEN });
  server = createGateway({ clientDir: CLIENT_DIR, room, auth });
  await new Promise(resolve => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;

  const authSinCarga = createAuthService({ clientId: 'x', sessionSecret: 's', loadTestToken: '' });
  serverSinCarga = createGateway({ clientDir: CLIENT_DIR, room: new RaceRoom(() => {}), auth: authSinCarga });
  await new Promise(resolve => serverSinCarga.listen(0, resolve));
  baseSinCarga = `http://localhost:${serverSinCarga.address().port}`;
});

after(() => {
  room.resetToLobby();
  server.close();
  serverSinCarga.close();
});

function loadTestLogin(baseUrl, token, name = 'Bot k6') {
  return fetch(`${baseUrl}/api/auth/loadtest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-load-test-token': token },
    body: JSON.stringify({ name })
  });
}

function nextMessage(ws, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando ${type}`)), 3000);
    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg.type === type) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

test('/health responde ok con el estado de la sala', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.roomState, 'lobby');
  assert.equal(typeof body.uptimeSeconds, 'number');
});

test('/metrics expone métricas en formato Prometheus', async () => {
  const res = await fetch(`${base}/metrics`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  const text = await res.text();
  for (const name of [
    'karswcol_ws_connections',
    'karswcol_tick_duration_seconds',
    'karswcol_room_players',
    'karswcol_http_requests_total',
    'karswcol_process_cpu_seconds_total',
    'karswcol_nodejs_eventloop_lag_seconds'
  ]) {
    assert.ok(text.includes(name), `falta la métrica ${name}`);
  }
});

test('las peticiones HTTP se cuentan con rutas de baja cardinalidad', async () => {
  await fetch(`${base}/no-existe-${Date.now()}`);
  const text = await (await fetch(`${base}/metrics`)).text();
  assert.match(text, /karswcol_http_requests_total\{[^}]*route="\/health"/);
  assert.match(text, /karswcol_http_requests_total\{[^}]*route="not_found"/);
  assert.ok(!/no-existe-/.test(text), 'una URL arbitraria no debe crear series');
});

test('login de carga sin LOAD_TEST_TOKEN configurado no existe (404)', async () => {
  const res = await loadTestLogin(baseSinCarga, LOAD_TEST_TOKEN);
  assert.equal(res.status, 404);
});

test('login de carga con token incorrecto responde 401', async () => {
  const res = await loadTestLogin(base, 'token-equivocado');
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('login de carga válido permite entrar a la sala y se refleja en métricas', async () => {
  const res = await loadTestLogin(base, LOAD_TEST_TOKEN, 'Bot k6 1');
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];

  const ws = new WebSocket(base.replace('http', 'ws'), { headers: { cookie } });
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  const joined = nextMessage(ws, 'joined');
  ws.send(JSON.stringify({ type: 'join', name: 'Bot k6 1', color: '#123456' }));
  await joined;

  const text = await (await fetch(`${base}/metrics`)).text();
  assert.match(text, /karswcol_ws_connections\{[^}]*\} 1/);
  assert.match(text, /karswcol_room_players\{kind="human"[^}]*\} 1/);
  assert.match(text, /karswcol_ws_messages_received_total\{type="join"/);

  const closed = new Promise(resolve => ws.on('close', resolve));
  ws.close();
  await closed;
  await new Promise(resolve => setTimeout(resolve, 50));
  const after = await (await fetch(`${base}/metrics`)).text();
  assert.match(after, /karswcol_ws_connections\{[^}]*\} 0/);
});
