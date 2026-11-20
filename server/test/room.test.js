import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { RaceRoom } from '../src/raceRoom.js';

// Ciclo de vida de la sala en el lobby: entrar, salir y arrancar.

let room;
let messages;

beforeEach(() => {
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 });
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
