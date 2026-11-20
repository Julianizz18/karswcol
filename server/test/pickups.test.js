import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConcurrencyResolver } from '../src/concurrency-resolver/concurrencyResolver.js';
import { PICKUP_RESPAWN_MS } from '../src/game-engine/gameplayConfig.js';

// Objetos recogibles: el primero en llegar se lo lleva y reaparece según el
// reloj de carrera (que no avanza durante la pausa).

const track = { pickupRadius: 20, pickups: [{ id: 'p1', x: 0, y: 0, name: 'Tinto', emoji: '☕' }] };
const engine = { boosts: [], applyBoost(p) { this.boosts.push(p.name); } };

function setup() {
  const resolver = new ConcurrencyResolver();
  resolver.reset(track);
  engine.boosts = [];
  return resolver;
}

test('el primer jugador del tick se queda con el objeto', () => {
  const resolver = setup();
  const a = resolver.tryClaim({ name: 'Julian', x: 5, y: 0 }, engine, 1000);
  const b = resolver.tryClaim({ name: 'Sara', x: 0, y: 5 }, engine, 1000);
  assert.equal(a.by, 'Julian');
  assert.equal(b, null);
  assert.deepEqual(engine.boosts, ['Julian']);
});

test('fuera del radio no se recoge', () => {
  const resolver = setup();
  assert.equal(resolver.tryClaim({ name: 'Sara', x: 21, y: 0 }, engine, 0), null);
});

test('el objeto reaparece tras PICKUP_RESPAWN_MS del reloj de carrera', () => {
  const resolver = setup();
  resolver.tryClaim({ name: 'Julian', x: 0, y: 0 }, engine, 1000);
  assert.equal(resolver.serialize(1000 + PICKUP_RESPAWN_MS - 1)[0].available, false);
  assert.equal(resolver.tryClaim({ name: 'Sara', x: 0, y: 0 }, engine, 1000 + PICKUP_RESPAWN_MS - 1), null);
  assert.equal(resolver.serialize(1000 + PICKUP_RESPAWN_MS)[0].available, true);
  assert.equal(resolver.tryClaim({ name: 'Sara', x: 0, y: 0 }, engine, 1000 + PICKUP_RESPAWN_MS).by, 'Sara');
});
