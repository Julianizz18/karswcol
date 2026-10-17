import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS } from '../src/game-engine/trackCatalog.js';
import { PuddleField } from '../src/game-engine/puddles.js';
import { GameEngine } from '../src/game-engine/gameEngine.js';
import { computeBotInput } from '../src/bots/botDriver.js';
import { RaceRoom } from '../src/raceRoom.js';
import {
  TICK_MS, TOTAL_LAPS, RACE_TIME_LIMIT_MS, RAIN_GRIP_FACTOR, PUDDLE_FILL_MS, PUDDLE_DRY_MS
} from '../src/game-engine/gameplayConfig.js';

// Lluvia: charcos, aquaplaning, pista mojada por clima real y hora del día.

function lateralOffset(track, x, y) {
  const { path } = track;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < path.count; i++) {
    const d = (path.x[i] - x) ** 2 + (path.y[i] - y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return Math.abs((x - path.x[best]) * path.nx[best] + (y - path.y[best]) * path.ny[best]);
}

afterEach(() => mock.timers.reset());

for (const track of TRACKS) {
  test(`${track.id}: los charcos quedan sobre la pista, lejos de la parrilla y son iguales en cada carrera`, () => {
    const a = new PuddleField(track).serialize();
    const b = new PuddleField(track).serialize();
    assert.deepEqual(a, b);
    for (const p of a) {
      assert.ok(lateralOffset(track, p.x, p.y) <= track.roadWidth / 2, `charco ${p.id} fuera de la pista`);
      for (const slot of track.startPositions) {
        assert.ok(Math.hypot(slot.x - p.x, slot.y - p.y) > p.radius * p.stretch + 10, `charco ${p.id} en la parrilla`);
      }
    }
  });
}

test('los charcos se llenan con la lluvia y se secan después', () => {
  const field = new PuddleField(TRACKS[0]);
  const p = field.puddles[0];
  assert.equal(field.puddleAt(p.x, p.y), null, 'seco al empezar');
  field.update(PUDDLE_FILL_MS, true);
  assert.equal(field.puddleAt(p.x, p.y), p, 'lleno tras llover');
  field.update(PUDDLE_DRY_MS, false);
  assert.equal(field.puddleAt(p.x, p.y), null, 'seco tras parar');
  assert.equal(field.anyWater, false);
});

test('pisar un charco a velocidad provoca aquaplaning: el kart casi no puede cambiar de rumbo', () => {
  const track = TRACKS[0];
  const field = new PuddleField(track);
  field.update(PUDDLE_FILL_MS, true);
  const puddle = field.puddles[0];
  const turnWith = onPuddle => {
    const engine = new GameEngine();
    engine.confineToRoad = () => {};
    const p = engine.createPlayerState('x', 'X', '#fff', 0, track);
    p.speed = 5;
    engine.setInput(p, { right: true, up: true });
    const before = p.moveAngle;
    engine.step(p, 50, 0, 1, track, RAIN_GRIP_FACTOR, onPuddle ? puddle : null);
    return { turn: Math.abs(p.moveAngle - before), aquaplaning: p.aquaplaning, speed: p.speed };
  };
  const wet = turnWith(false);
  const aqua = turnWith(true);
  assert.equal(wet.aquaplaning, false);
  assert.equal(aqua.aquaplaning, true);
  assert.ok(aqua.turn < wet.turn * 0.5, `sobre el charco gira ${aqua.turn} vs ${wet.turn}`);
  assert.ok(aqua.speed < wet.speed, 'el agua frena un poco');
});

for (const track of TRACKS) {
  test(`${track.id}: con la pista mojada toda la carrera, los bots igual terminan a tiempo`, () => {
    const engine = new GameEngine();
    const field = new PuddleField(track);
    field.update(PUDDLE_FILL_MS, true);
    const bots = Array.from({ length: 6 }, (_, i) => {
      const p = engine.createPlayerState(`b${i}`, `Bot ${i}`, '#fff', i, track);
      p.botLane = ((i % 3) - 1) * track.roadWidth * 0.18;
      return p;
    });
    let now = 0;
    while (now < RACE_TIME_LIMIT_MS && !bots.every(b => b.finished)) {
      now += TICK_MS;
      for (const b of bots) {
        if (!b.finished) engine.setInput(b, computeBotInput(b, track, 'medio', RAIN_GRIP_FACTOR));
        engine.step(b, now, 0, 0.9, track, RAIN_GRIP_FACTOR, field.puddleAt(b.x, b.y));
      }
    }
    const times = bots.map(b => (b.finishTime == null ? 'no terminó' : `${(b.finishTime / 1000).toFixed(0)}s`));
    assert.ok(bots.every(b => b.lap >= TOTAL_LAPS), `tiempos: ${times.join(', ')}`);
  });
}

function roomWithWeather(condition, isDay = false) {
  const messages = [];
  const room = new RaceRoom(msg => messages.push(msg));
  room.weather = { getForTrack: () => ({ condition, tempC: 20, isDay, city: 'X', source: 'real' }) };
  return { room, messages };
}

test('la hora del día elegida en el lobby reemplaza la real', () => {
  const { room } = roomWithWeather('despejado', false);
  assert.equal(room.weatherFor('caribe').isDay, true, 'por defecto: de día');
  room.selectTimeOfDay('noche');
  assert.equal(room.weatherFor('caribe').isDay, false);
  room.selectTimeOfDay('real');
  assert.equal(room.weatherFor('caribe').isDay, false, 'real: es de noche en la región');
  room.selectTimeOfDay('mediodia-inventado');
  assert.equal(room.timeOfDay, 'real', 'valores desconocidos se ignoran');
});

test('si llueve de verdad en la región la carrera arranca mojada y con charcos', () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const { room, messages } = roomWithWeather('lluvia');
  room.addPlayer('1', 'Ana', '#ECF0F1');
  room.startRace();
  assert.equal(messages.find(m => m.type === 'race_start').wetStart, true);
  mock.timers.tick(TICK_MS);
  const state = messages.filter(m => m.type === 'state').at(-1);
  assert.equal(state.rainActive, true);
  assert.ok(state.puddles.length > 0 && state.puddles.every(p => p.level === 1));
  room.resetToLobby();
});

test('con clima seco la carrera arranca seca y sin charcos', () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const { room, messages } = roomWithWeather('despejado', true);
  room.addPlayer('1', 'Ana', '#ECF0F1');
  room.startRace();
  mock.timers.tick(TICK_MS);
  const state = messages.filter(m => m.type === 'state').at(-1);
  assert.equal(state.rainActive, false);
  assert.deepEqual(state.puddles, []);
  room.resetToLobby();
});
