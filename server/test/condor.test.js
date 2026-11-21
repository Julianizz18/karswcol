import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game-engine/gameEngine.js';
import { TRACKS } from '../src/game-engine/trackCatalog.js';
import { STUCK_RESCUE_TICKS, WRONG_WAY_RESCUE_TICKS } from '../src/game-engine/gameplayConfig.js';

// El cóndor: rescata al kart que acelera sin avanzar (trabado contra el
// muro) o que va en contravía, y lo deja sobre la línea central mirando
// hacia adelante.

const track = TRACKS[0];

function kart() {
  const engine = new GameEngine();
  const p = engine.createPlayerState('1', 'Johan', '#FCD116', 0, track);
  return { engine, p };
}

test('acelerar sin avanzar durante 3 s pide el rescate', () => {
  const { engine, p } = kart();
  p.input.up = true;
  p.speed = 0;
  for (let t = 1; t < STUCK_RESCUE_TICKS; t++) assert.equal(engine.needsRescue(p, track), false);
  assert.equal(engine.needsRescue(p, track), true);
});

test('si vuelve a moverse, el conteo se reinicia', () => {
  const { engine, p } = kart();
  p.input.up = true;
  p.speed = 0;
  for (let t = 0; t < STUCK_RESCUE_TICKS - 5; t++) engine.needsRescue(p, track);
  p.speed = 3;
  engine.needsRescue(p, track);
  assert.equal(p.stuckTicks, 0);
});

test('ir en contravía durante 4 s pide el rescate', () => {
  const { engine, p } = kart();
  p.angle = track.path.tangent[p.trackIdx] + Math.PI;
  p.speed = 3;
  for (let t = 1; t < WRONG_WAY_RESCUE_TICKS; t++) assert.equal(engine.needsRescue(p, track), false);
  assert.equal(engine.needsRescue(p, track), true);
});

test('el rescate deja el kart en la línea central, quieto y mirando hacia adelante', () => {
  const { engine, p } = kart();
  const i = p.trackIdx;
  p.x += 30;
  p.angle += Math.PI;
  p.speed = 2;
  p.crashTicks = 5;
  const ev = engine.rescue(p, track);
  assert.equal(p.x, track.path.x[i]);
  assert.equal(p.y, track.path.y[i]);
  assert.equal(p.angle, track.path.tangent[i]);
  assert.equal(p.speed, 0);
  assert.equal(p.crashTicks, 0);
  assert.deepEqual(ev, { type: 'condor_rescue', playerId: '1', name: 'Johan', x: p.x, y: p.y });
});

test('un kart que ya terminó no se rescata', () => {
  const { engine, p } = kart();
  p.finished = true;
  p.input.up = true;
  p.speed = 0;
  for (let t = 0; t < STUCK_RESCUE_TICKS + 5; t++) assert.equal(engine.needsRescue(p, track), false);
});
