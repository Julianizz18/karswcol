import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game-engine/gameEngine.js';
import { TRACKS } from '../src/game-engine/trackCatalog.js';

// El input viene del cliente: el motor solo debe aceptar las cuatro teclas
// conocidas, como booleanos.

function newPlayer() {
  const engine = new GameEngine();
  return { engine, p: engine.createPlayerState('1', 'Sara', '#CE1126', 0, TRACKS[0]) };
}

test('setInput acepta las teclas conocidas', () => {
  const { engine, p } = newPlayer();
  engine.setInput(p, { up: true, left: true });
  assert.deepEqual(p.input, { left: true, right: false, up: true, down: false });
});

test('setInput descarta claves desconocidas', () => {
  const { engine, p } = newPlayer();
  engine.setInput(p, { up: true, turbo: true, foo: 'x'.repeat(1000) });
  assert.deepEqual(Object.keys(p.input).sort(), ['down', 'left', 'right', 'up']);
});

test('setInput convierte valores no booleanos a false', () => {
  const { engine, p } = newPlayer();
  engine.setInput(p, { up: 'yes', right: 1 });
  assert.equal(p.input.up, false);
  assert.equal(p.input.right, false);
});

test('setInput ignora un input que no es objeto', () => {
  const { engine, p } = newPlayer();
  engine.setInput(p, { up: true });
  engine.setInput(p, 'abc');
  engine.setInput(p, null);
  assert.equal(p.input.up, true);
});
