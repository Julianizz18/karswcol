import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game-engine/gameEngine.js';
import { TRACKS } from '../src/game-engine/trackCatalog.js';

// Tiempo de cada vuelta y mejor vuelta: se miden con el reloj de carrera
// cada vez que el jugador cruza el último punto de control.

const track = TRACKS[0];
const engine = new GameEngine();

function crossAllCheckpoints(p, now, raceStartedAt) {
  let event = null;
  for (const cp of track.checkpoints) {
    p.x = cp.x;
    p.y = cp.y;
    event = engine.evaluateCheckpoint(p, now, raceStartedAt, track) || event;
  }
  return event;
}

test('cada vuelta guarda su tiempo y la mejor vuelta es la más rápida', () => {
  const p = engine.createPlayerState('1', 'Johan', '#FCD116', 0, track);
  const start = 1000;
  const e1 = crossAllCheckpoints(p, start + 60000, start);
  const e2 = crossAllCheckpoints(p, start + 110000, start);
  assert.equal(e1.lapTimeMs, 60000);
  assert.equal(e2.lapTimeMs, 50000);
  assert.deepEqual(p.lapTimes, [60000, 50000]);
  assert.equal(p.bestLapMs, 50000);
});

test('resetPlayerState borra los tiempos de vuelta', () => {
  const p = engine.createPlayerState('1', 'Johan', '#FCD116', 0, track);
  crossAllCheckpoints(p, 61000, 1000);
  engine.resetPlayerState(p);
  assert.deepEqual(p.lapTimes, []);
  assert.equal(p.bestLapMs, null);
  assert.equal(p.lapStartedAt, null);
});
