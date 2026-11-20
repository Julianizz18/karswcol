import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { RaceRoom, RECONNECT_GRACE_MS } from '../src/raceRoom.js';

// Ciclo de vida de la sala en el lobby: entrar, salir y arrancar.

let room;
let messages;

beforeEach(() => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 1_000_000 });
  messages = [];
  room = new RaceRoom(msg => messages.push(msg));
});

afterEach(() => {
  room.resetToLobby();
  mock.timers.reset();
});

test('un segundo join de la misma conexión se rechaza y no cambia la parrilla', () => {
  assert.equal(room.addPlayer('1', 'Julian', '#ECF0F1'), null);
  assert.equal(room.addPlayer('2', 'Sara', '#CE1126'), null);
  const before = { ...room.playerStates.get('1') };
  assert.equal(room.addPlayer('1', 'Julian', '#ECF0F1'), 'Ya estás en la sala.');
  assert.equal(room.matchmaking.list().length, 2);
  assert.equal(room.playerStates.get('1').x, before.x);
  assert.equal(room.playerStates.get('1').y, before.y);
});

test('si se va el único jugador que no estaba listo, arranca la cuenta regresiva', () => {
  room.addPlayer('1', 'Julian', '#ECF0F1');
  room.addPlayer('2', 'Sara', '#CE1126');
  room.setReady('1');
  assert.equal(room.state, 'lobby');
  room.removePlayer('2');
  assert.equal(room.state, 'countdown');
  assert.deepEqual(messages.filter(m => m.type === 'countdown').at(-1), { type: 'countdown', seconds: 3 });
});

test('si se va un jugador y los que quedan no están listos, la sala sigue en el lobby', () => {
  room.addPlayer('1', 'Julian', '#ECF0F1');
  room.addPlayer('2', 'Sara', '#CE1126');
  room.removePlayer('2');
  assert.equal(room.state, 'lobby');
});

const join = (connId, user) => room.join(connId, { name: user, color: '#FCD116', userKey: user });

test('una misma cuenta no puede tener dos karts', () => {
  assert.deepEqual(join('1', 'johan'), { playerId: '1', rejoined: false });
  const second = join('2', 'johan');
  assert.match(second.rejection, /otra pestaña/);
  assert.equal(room.matchmaking.list().length, 1);
});

test('quien se desconecta en plena carrera recupera su kart si vuelve a tiempo', () => {
  join('1', 'johan');
  join('2', 'sara');
  room.startRace();
  room.playerStates.get('1').lap = 2;
  room.handleDisconnect('1');
  assert.ok(room.playerStates.has('1'), 'el kart se conserva');
  assert.ok(messages.some(m => m.kind === 'player_disconnected' && m.name === 'johan'));
  mock.timers.tick(RECONNECT_GRACE_MS - 1000);
  const back = join('7', 'johan');
  assert.deepEqual(back, { playerId: '1', rejoined: true });
  assert.equal(room.playerStates.get('1').lap, 2, 'conserva su avance');
  mock.timers.tick(5000);
  assert.ok(room.playerStates.has('1'), 'ya no corre el tiempo de gracia');
});

test('si no vuelve a tiempo, sale de la carrera', () => {
  join('1', 'johan');
  join('2', 'sara');
  room.startRace();
  room.handleDisconnect('1');
  mock.timers.tick(RECONNECT_GRACE_MS + 10);
  assert.ok(!room.playerStates.has('1'));
  // Puede volver a entrar como jugador nuevo cuando la sala esté en el lobby.
  room.resetToLobby();
  assert.equal(join('9', 'johan').playerId, '9');
});

test('al volver a mitad de carrera recibe la pista para ponerse al día', () => {
  join('1', 'johan');
  room.startRace();
  const resync = room.resyncMessages();
  assert.equal(resync[0].type, 'race_start');
  assert.equal(resync[0].track.id, room.trackId);
});

test('desconectarse en el lobby saca al jugador de inmediato', () => {
  join('1', 'johan');
  join('2', 'sara');
  room.handleDisconnect('1');
  assert.ok(!room.playerStates.has('1'));
  assert.equal(join('3', 'johan').playerId, '3');
});

test('al volver al lobby no quedan karts fantasma de desconectados', () => {
  join('1', 'johan');
  join('2', 'sara');
  room.startRace();
  room.handleDisconnect('1');
  room.finishRace('time_limit');
  room.requestRestart();
  assert.deepEqual(room.matchmaking.list().map(p => p.id), ['2']);
  assert.equal(room.disconnected.size, 0);
});
