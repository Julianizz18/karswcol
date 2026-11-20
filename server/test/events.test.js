import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventManager } from '../src/event-manager/eventManager.js';
import { RAIN_DURATION_MS, RAIN_DURATION_JITTER, TOTAL_LAPS } from '../src/game-engine/gameplayConfig.js';

// Aguacero de la carrera: se sortea si llueve, en qué vuelta y cuánto dura.

const fixed = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

test('si el sorteo dice que llueve en la vuelta 2, no llueve en la 1', () => {
  // 0.1 -> llueve; 0.99 -> vuelta 2 (con 3 vueltas); 0.5 -> duración exacta
  const em = new EventManager({ random: fixed(0.1, 0.99, 0.5) });
  em.reset();
  assert.equal(em.onLapCompleted(1, 1000), null);
  const ev = em.onLapCompleted(2, 2000);
  assert.deepEqual(ev, { type: 'rain_start', durationMs: RAIN_DURATION_MS });
  assert.equal(em.rainActive, true);
});

test('si el sorteo dice que no llueve, no llueve en toda la carrera', () => {
  const em = new EventManager({ random: fixed(0.9, 0, 0.5) });
  em.reset();
  for (let lap = 1; lap <= TOTAL_LAPS; lap++) assert.equal(em.onLapCompleted(lap, lap * 1000), null);
  assert.equal(em.rainActive, false);
});

test('la duración varía dentro del margen y la lluvia termina a tiempo', () => {
  const em = new EventManager({ random: fixed(0.1, 0, 1) });
  em.reset();
  const ev = em.onLapCompleted(1, 0);
  assert.equal(ev.durationMs, Math.round(RAIN_DURATION_MS * (1 + RAIN_DURATION_JITTER)));
  assert.equal(em.tick(ev.durationMs - 1), null);
  assert.deepEqual(em.tick(ev.durationMs), { type: 'rain_end' });
});

test('llueve una sola vez por carrera', () => {
  const em = new EventManager({ random: fixed(0.1, 0, 0.5) });
  em.reset();
  assert.ok(em.onLapCompleted(1, 0));
  assert.equal(em.onLapCompleted(2, 1000), null);
});

test('si llueve de verdad en la región, la pista sigue mojada toda la carrera', () => {
  const em = new EventManager();
  em.reset(true);
  assert.equal(em.rainActive, true);
  assert.equal(em.onLapCompleted(1, 0), null);
  assert.equal(em.tick(10 ** 9), null);
});
