import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game-engine/gameEngine.js';
import { TRACKS } from '../src/game-engine/trackCatalog.js';
import { KART_RADIUS } from '../src/game-engine/gameplayConfig.js';

// Colisión entre karts: ya no se atraviesan.

const track = TRACKS[0];
const engine = new GameEngine();

function pair(gap) {
  const a = engine.createPlayerState('a', 'A', '#FCD116', 0, track);
  const b = engine.createPlayerState('b', 'B', '#CE1126', 0, track);
  const t = a.angle;
  b.x = a.x + Math.cos(t) * gap;
  b.y = a.y + Math.sin(t) * gap;
  b.trackIdx = a.trackIdx;
  return { a, b };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('dos karts solapados se separan hasta tocarse sin atravesarse', () => {
  const { a, b } = pair(5);
  const bumps = engine.resolveCollisions([a, b], track);
  assert.equal(bumps, 1);
  assert.ok(dist(a, b) >= KART_RADIUS * 2 - 1e-6);
});

test('el que choca por detrás pierde velocidad; el de adelante no', () => {
  const { a, b } = pair(10);
  a.speed = 6; // viene rápido por detrás
  b.speed = 2;
  engine.resolveCollisions([a, b], track);
  assert.ok(a.speed < 6, 'el de atrás frena');
  assert.equal(b.speed, 2, 'el de adelante sigue igual');
});

test('karts separados no se tocan', () => {
  const { a, b } = pair(KART_RADIUS * 2 + 1);
  const before = { ax: a.x, bx: b.x };
  assert.equal(engine.resolveCollisions([a, b], track), 0);
  assert.equal(a.x, before.ax);
  assert.equal(b.x, before.bx);
});

test('un kart que ya terminó no bloquea a los demás', () => {
  const { a, b } = pair(4);
  b.finished = true;
  assert.equal(engine.resolveCollisions([a, b], track), 0);
});

test('dos karts exactamente encima se separan de lado', () => {
  const { a, b } = pair(0);
  engine.resolveCollisions([a, b], track);
  assert.ok(dist(a, b) > 0);
});

test('ocho karts amontonados quedan sin solaparse después de unos ticks', () => {
  const karts = Array.from({ length: 8 }, (_, i) => {
    const p = engine.createPlayerState(String(i), `P${i}`, '#FCD116', 0, track);
    p.x += (i % 3) * 3;
    p.y += Math.floor(i / 3) * 3;
    return p;
  });
  for (let t = 0; t < 30; t++) engine.resolveCollisions(karts, track);
  for (let i = 0; i < karts.length; i++) {
    for (let j = i + 1; j < karts.length; j++) assert.ok(dist(karts[i], karts[j]) >= KART_RADIUS * 2 - 0.5, `${i}-${j}`);
  }
});
