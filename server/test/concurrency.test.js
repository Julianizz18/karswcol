import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createGateway } from '../src/gateway/gateway.js';
import { createAuthService } from '../src/auth/authService.js';
import { RaceRoom } from '../src/raceRoom.js';
import { ROOM_CAPACITY } from '../src/matchmaking/matchmakingService.js';
import { ConcurrencyResolver } from '../src/concurrency-resolver/concurrencyResolver.js';
import { GameEngine } from '../src/game-engine/gameEngine.js';
import { TRACKS } from '../src/game-engine/trackCatalog.js';

// Robustez en concurrencia (sección 2.7): clientes WebSocket reales contra el
// gateway y la sala reales, todos actuando a la vez. Se verifica que no haya
// pérdida ni duplicación de mensajes, que el orden de los estados se
// conserve y que los recursos compartidos tengan un solo dueño.

const CLIENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client');
const CLIENTS = ROOM_CAPACITY + 2; // dos más de los que caben

let server;
let base;
let room;

before(async () => {
  // Cada token falso es una cuenta de Google distinta (sub único).
  const auth = createAuthService({
    clientId: 'test.apps.googleusercontent.com',
    sessionSecret: 'secreto-concurrencia',
    verifyIdToken: async token => ({ sub: token, email: `${token}@example.com`, email_verified: true, name: token })
  });
  room = new RaceRoom(() => {});
  server = createGateway({ clientDir: CLIENT_DIR, room, auth });
  await new Promise(resolve => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => {
  room.resetToLobby();
  server.close();
});

async function login(name) {
  const res = await fetch(`${base}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: name })
  });
  return res.headers.get('set-cookie').split(';')[0];
}

/** Cliente que guarda todo lo que recibe, en orden. */
async function connect(name) {
  const cookie = await login(name);
  const ws = new WebSocket(base.replace('http', 'ws'), { headers: { cookie } });
  const received = [];
  ws.on('message', raw => received.push(JSON.parse(raw)));
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  return { name, ws, received, ofType: type => received.filter(m => m.type === type) };
}

const waitUntil = async (check, timeout = 8000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('tiempo agotado esperando la condición');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

test(`${CLIENTS} clientes entran a la vez: ids únicos, sin duplicados y la capacidad se respeta`, async () => {
  const clients = await Promise.all(Array.from({ length: CLIENTS }, (_, i) => connect(`piloto${i}`)));
  // Todos mandan "join" en el mismo instante.
  for (const c of clients) c.ws.send(JSON.stringify({ type: 'join', name: c.name, color: '#FCD116' }));
  await waitUntil(() => clients.every(c => c.ofType('joined').length + c.ofType('join_rejected').length >= 1));

  const accepted = clients.filter(c => c.ofType('joined').length === 1);
  const rejected = clients.filter(c => c.ofType('join_rejected').length === 1);
  assert.equal(accepted.length, ROOM_CAPACITY, 'entran exactamente los que caben');
  assert.equal(rejected.length, CLIENTS - ROOM_CAPACITY);
  assert.ok(rejected.every(c => /llena/.test(c.ofType('join_rejected')[0].reason)));
  assert.ok(clients.every(c => c.ofType('joined').length <= 1), 'ningún "joined" duplicado');
  const ids = accepted.map(c => c.ofType('joined')[0].id);
  assert.equal(new Set(ids).size, ROOM_CAPACITY, 'ids únicos');
  assert.equal(room.matchmaking.list().length, ROOM_CAPACITY, 'el estado del servidor coincide');

  // Todos ven la misma parrilla final (último lobby_update recibido).
  await waitUntil(() => accepted.every(c => c.ofType('lobby_update').at(-1)?.players.length === ROOM_CAPACITY));
  const grids = accepted.map(c => c.ofType('lobby_update').at(-1).players.map(p => p.id).join(','));
  assert.equal(new Set(grids).size, 1, 'vista consistente de la sala en todos los clientes');

  // Todos se marcan listos a la vez: una sola cuenta regresiva y una sola carrera.
  for (const c of accepted) c.ws.send(JSON.stringify({ type: 'ready' }));
  await waitUntil(() => accepted.every(c => c.ofType('race_start').length === 1), 10000);
  for (const c of accepted) {
    const countdowns = c.ofType('countdown').map(m => m.seconds);
    assert.deepEqual(countdowns, [3, 2, 1], `una sola cuenta regresiva para ${c.name}`);
  }

  // Durante la carrera los estados llegan en orden (t no retrocede) y sin duplicados.
  await waitUntil(() => accepted.every(c => c.ofType('state').length >= 10));
  for (const c of accepted) {
    const times = c.ofType('state').map(m => m.t);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1], `orden de estados en ${c.name}`);
  }

  for (const c of clients) c.ws.close();
  await waitUntil(() => room.state === 'lobby' || room.matchmaking.isEmpty(), 5000).catch(() => {});
});

test('varios jugadores sobre el mismo objeto en el mismo tick: uno solo se lo lleva', () => {
  const track = TRACKS[0];
  const engine = new GameEngine();
  const resolver = new ConcurrencyResolver();
  resolver.reset(track);
  const target = track.pickups[0];
  // Ocho jugadores exactamente sobre el mismo objeto, en el mismo tick.
  const players = Array.from({ length: 8 }, (_, i) => {
    const p = engine.createPlayerState(String(i), `P${i}`, '#FCD116', i, track);
    p.x = target.x;
    p.y = target.y;
    return p;
  });
  const now = 10_000;
  const claims = players.map(p => resolver.tryClaim(p, engine, now)).filter(e => e && e.pickupId === target.id);
  assert.equal(claims.length, 1, 'un solo dueño');
  assert.equal(claims[0].by, 'P0', 'gana el primero en el orden de llegada');
  assert.equal(players.filter(p => engine.isBoosted(p, now)).length, 1, 'un solo turbo aplicado');
  assert.equal(resolver.serialize(now).find(p => p.id === target.id).available, false);
});

test('repetido 200 veces con orden aleatorio, nunca hay dos dueños del mismo objeto', () => {
  const track = TRACKS[1];
  const engine = new GameEngine();
  const target = track.pickups[0];
  for (let round = 0; round < 200; round++) {
    const resolver = new ConcurrencyResolver();
    resolver.reset(track);
    const players = Array.from({ length: 8 }, (_, i) => {
      const p = engine.createPlayerState(String(i), `P${i}`, '#FCD116', i, track);
      p.x = target.x + (Math.random() - 0.5) * 10;
      p.y = target.y + (Math.random() - 0.5) * 10;
      return p;
    }).sort(() => Math.random() - 0.5);
    const owners = players.map(p => resolver.tryClaim(p, engine, 0)).filter(e => e && e.pickupId === target.id);
    assert.equal(owners.length, 1);
    assert.equal(owners[0].by, players.find(p => engine.isBoosted(p, 0)).name, 'el dueño es el primero que llegó');
  }
});

test('abandonar a propósito sale de inmediato: al volver no regresa a esa carrera', async () => {
  // La prueba anterior deja una carrera con karts en período de gracia: sala limpia.
  room.resetToLobby();
  const opened = [];
  const track = async name => { const c = await connect(name); opened.push(c); return c; };
  try {
  const a = await track('abandona');
  const b = await track('sigue');
  for (const c of [a, b]) c.ws.send(JSON.stringify({ type: 'join', name: c.name, color: '#FCD116' }));
  await waitUntil(() => a.ofType('joined').length && b.ofType('joined').length);
  for (const c of [a, b]) c.ws.send(JSON.stringify({ type: 'ready' }));
  await waitUntil(() => a.ofType('race_start').length === 1, 10000);
  const oldId = a.ofType('joined')[0].id;
  a.ws.send(JSON.stringify({ type: 'leave' }));
  await waitUntil(() => a.ofType('left').length === 1);
  assert.ok(!room.playerStates.has(oldId), 'sale sin período de gracia');
  a.ws.close();
  // Vuelve a entrar con la misma cuenta mientras la carrera sigue: no recupera el kart.
  const again = await track('abandona');
  again.ws.send(JSON.stringify({ type: 'join', name: 'abandona', color: '#FCD116' }));
  await waitUntil(() => again.ofType('joined').length + again.ofType('join_rejected').length >= 1);
  assert.equal(again.ofType('joined').length, 0);
  assert.match(again.ofType('join_rejected')[0].reason, /carrera en curso/);
  } finally {
    for (const c of opened) c.ws.terminate();
    room.resetToLobby();
  }
});
