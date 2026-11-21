import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { RaceRoom, MAX_PAUSES_PER_PLAYER } from '../src/raceRoom.js';
import { TICK_MS } from '../src/game-engine/gameEngine.js';
import { RACE_TIME_LIMIT_MS, START_HOLD_MS } from '../src/game-engine/gameplayConfig.js';

// Pausa de carrera: se prueba con reloj simulado (Date y setInterval) para
// avanzar el tiempo sin esperar de verdad.

let room;
let messages;

function messagesOfType(type) {
  return messages.filter(m => m.type === type);
}

beforeEach(() => {
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 });
  messages = [];
  room = new RaceRoom(msg => messages.push(msg));
  room.addPlayer('1', 'Julian', '#ECF0F1');
  room.addPlayer('2', 'Sara', '#CE1126');
  room.startRace();
});

afterEach(() => {
  room.resetToLobby();
  mock.timers.reset();
});

test('pausar congela la carrera: no se envían más estados', () => {
  mock.timers.tick(TICK_MS * 3);
  room.togglePause('1');
  const statesAtPause = messagesOfType('state').length;
  mock.timers.tick(TICK_MS * 20);
  assert.equal(messagesOfType('state').length, statesAtPause);
  assert.deepEqual(messagesOfType('pause').at(-1), { type: 'pause', paused: true, by: 'Julian', byId: '1' });
});

test('cualquier jugador puede reanudar y la carrera sigue', () => {
  room.togglePause('1');
  room.togglePause('2');
  assert.deepEqual(messagesOfType('pause').at(-1), { type: 'pause', paused: false, by: 'Sara' });
  const before = messagesOfType('state').length;
  mock.timers.tick(TICK_MS * 5);
  assert.equal(messagesOfType('state').length, before + 5);
});

test('el tiempo en pausa no cuenta en el reloj de carrera', () => {
  mock.timers.tick(TICK_MS * 10);
  room.togglePause('1');
  mock.timers.tick(60_000);
  room.togglePause('1');
  mock.timers.tick(TICK_MS);
  // El cronómetro arranca en el verde (START_HOLD_MS después de la salida).
  assert.equal(messagesOfType('state').at(-1).t, TICK_MS * 11 - START_HOLD_MS);
});

test('la pausa no consume el tiempo límite de la carrera', () => {
  room.togglePause('1');
  mock.timers.tick(RACE_TIME_LIMIT_MS + 1000);
  room.togglePause('1');
  mock.timers.tick(TICK_MS);
  assert.equal(room.state, 'racing');
  assert.equal(messagesOfType('results').length, 0);
});

test('durante la pausa se ignoran los controles y se sueltan las teclas', () => {
  room.setInput('1', { up: true, down: false, left: false, right: false });
  room.togglePause('1');
  room.setInput('2', { up: true, down: false, left: false, right: false });
  assert.equal(room.playerStates.get('1').input.up, false);
  assert.equal(room.playerStates.get('2').input.up, false);
});

test('si se va quien pausó, la carrera se reanuda para los demás', () => {
  room.togglePause('1');
  room.removePlayer('1');
  assert.equal(room.paused, false);
  assert.equal(messagesOfType('pause').at(-1).paused, false);
  const before = messagesOfType('state').length;
  mock.timers.tick(TICK_MS * 2);
  assert.equal(messagesOfType('state').length, before + 2);
});

test('no se puede pausar fuera de la carrera', () => {
  room.resetToLobby();
  room.togglePause('1');
  assert.equal(room.paused, false);
  assert.equal(messagesOfType('pause').length, 0);
});

test('cada jugador puede pausar como máximo MAX_PAUSES_PER_PLAYER veces por carrera', () => {
  for (let i = 0; i < MAX_PAUSES_PER_PLAYER; i++) {
    room.togglePause('1');
    assert.equal(room.paused, true);
    room.togglePause('1');
    assert.equal(room.paused, false);
  }
  room.togglePause('1');
  assert.equal(room.paused, false, 'la cuarta pausa se rechaza');
  assert.deepEqual(messages.filter(m => m.kind === 'pause_denied').at(-1), { type: 'event', kind: 'pause_denied', byId: '1', max: MAX_PAUSES_PER_PLAYER });
  room.togglePause('2');
  assert.equal(room.paused, true, 'el otro jugador conserva sus pausas');
});

test('reanudar no gasta pausas y una carrera nueva las repone', () => {
  room.togglePause('1');
  room.togglePause('2'); // el otro reanuda: no le cuenta
  assert.equal(room.pausesUsed.get('2') || 0, 0);
  room.resetToLobby();
  room.startRace();
  assert.equal(room.pausesUsed.size, 0);
});
