import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RankingService } from '../src/ranking-persistence/rankingService.js';

// Ranking final: los que terminaron por tiempo y luego los demás por avance.

const ranking = new RankingService();
const player = (id, finishTime, lap, nextCheckpoint) => ({ id, name: id, finishTime, lap, nextCheckpoint });

test('los que terminaron van primero, ordenados por tiempo', () => {
  const r = ranking.buildRanking([player('lento', 90000, 3, 0), player('rapido', 80000, 3, 0), player('dnf', null, 2, 5)]);
  assert.deepEqual(r.map(x => x.id), ['rapido', 'lento', 'dnf']);
});

test('los que no terminaron se ordenan por vueltas y luego por puntos de control', () => {
  const r = ranking.buildRanking([
    player('vuelta0', null, 0, 7),
    player('vuelta2cp1', null, 2, 1),
    player('vuelta2cp6', null, 2, 6),
    player('vuelta1', null, 1, 9)
  ]);
  assert.deepEqual(r.map(x => x.id), ['vuelta2cp6', 'vuelta2cp1', 'vuelta1', 'vuelta0']);
  assert.deepEqual(r.map(x => x.position), [1, 2, 3, 4]);
});

test('el resultado incluye la vuelta alcanzada', () => {
  const [r] = ranking.buildRanking([player('a', null, 2, 3)]);
  assert.equal(r.lap, 2);
});
