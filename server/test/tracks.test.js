import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS } from '../src/game-engine/trackCatalog.js';
import { CURB_WIDTH, PATH_SPACING } from '../src/game-engine/trackBuilder.js';
import { GameEngine } from '../src/game-engine/gameEngine.js';
import { computeBotInput } from '../src/bots/botDriver.js';
import { TICK_MS, TOTAL_LAPS, RACE_TIME_LIMIT_MS } from '../src/game-engine/gameplayConfig.js';

// Pistas tipo F1: se valida la geometría de cada trazado y que los bots
// puedan completar una carrera real (misma física del servidor) a tiempo.

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

for (const track of TRACKS) {
  test(`${track.id}: el circuito es cerrado y no se cruza consigo mismo`, () => {
    const { path } = track;
    const n = path.count;
    assert.ok(Math.hypot(path.x[0] - path.x[n - 1], path.y[0] - path.y[n - 1]) <= PATH_SPACING * 1.5, 'cierre');
    // Tramos alejados en la vuelta deben estar separados por más que el ancho con bordillos.
    const minGap = track.roadWidth + 2 * CURB_WIDTH + 16;
    for (let i = 0; i < n; i += 3) {
      for (let j = i + 3; j < n; j += 3) {
        const ds = Math.min(Math.abs(path.s[i] - path.s[j]), path.length - Math.abs(path.s[i] - path.s[j]));
        if (ds < 300) continue;
        const d = Math.hypot(path.x[i] - path.x[j], path.y[i] - path.y[j]);
        assert.ok(d >= minGap, `tramos a ${d.toFixed(0)} u en (${path.x[i].toFixed(0)}, ${path.y[i].toFixed(0)})`);
      }
    }
  });

  test(`${track.id}: ninguna curva es más cerrada que el ancho de la pista`, () => {
    const { path } = track;
    const W = 3;
    const minRadius = track.roadWidth / 2 + CURB_WIDTH + 12;
    for (let i = 0; i < path.count; i++) {
      const a = path.tangent[(i - W + path.count) % path.count];
      const b = path.tangent[(i + W) % path.count];
      const turn = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
      if (turn < 1e-4) continue;
      assert.ok((2 * W * PATH_SPACING) / turn >= minRadius - 1, `curva de radio ${((2 * W * PATH_SPACING) / turn).toFixed(0)}`);
    }
  });

  test(`${track.id}: parrilla, objetos y puntos de control quedan sobre la carretera`, () => {
    const half = track.roadWidth / 2;
    [...track.startPositions, ...track.pickups, ...track.checkpoints].forEach(p => {
      assert.ok(lateralOffset(track, p.x, p.y) <= half, `(${p.x.toFixed(0)}, ${p.y.toFixed(0)}) fuera de la pista`);
    });
    // La última meta de la vuelta es la línea de salida.
    const last = track.checkpoints.at(-1);
    assert.ok(Math.hypot(last.x - track.startLine.x, last.y - track.startLine.y) < PATH_SPACING * 2);
  });

  test(`${track.id}: los datos densos del servidor no viajan a los clientes`, () => {
    const json = JSON.parse(JSON.stringify(track));
    assert.equal(json.path, undefined);
    assert.ok(json.centerline.length > 100);
    assert.ok(JSON.stringify(track).length < 40_000);
  });

  test(`${track.id}: los muros devuelven a la pista a quien se sale`, () => {
    const engine = new GameEngine();
    const p = engine.createPlayerState('1', 'Test', '#fff', 0, track);
    const i = p.trackIdx;
    p.x = track.path.x[i] + track.path.nx[i] * (track.roadWidth * 2);
    p.y = track.path.y[i] + track.path.ny[i] * (track.roadWidth * 2);
    p.speed = 4;
    engine.confineToRoad(p, track);
    assert.ok(lateralOffset(track, p.x, p.y) <= track.roadWidth / 2 + 0.01);
    assert.ok(p.speed < 4);
  });

  test(`${track.id}: una carrera de bots termina las ${TOTAL_LAPS} vueltas a tiempo`, () => {
    const engine = new GameEngine();
    const bots = Array.from({ length: 6 }, (_, i) => {
      const p = engine.createPlayerState(`b${i}`, `Bot ${i}`, '#fff', i, track);
      p.isBot = true;
      p.botLane = ((i % 3) - 1) * track.roadWidth * 0.18;
      return p;
    });
    let now = 0;
    while (now < RACE_TIME_LIMIT_MS && !bots.every(b => b.finished)) {
      now += TICK_MS;
      for (const b of bots) {
        if (!b.finished) engine.setInput(b, computeBotInput(b, track, 'medio'));
        engine.step(b, now, 0, 1, track);
      }
    }
    const times = bots.map(b => (b.finishTime == null ? 'no terminó' : `${(b.finishTime / 1000).toFixed(0)}s`));
    assert.ok(bots.every(b => b.finished), `tiempos: ${times.join(', ')}`);
  });
}

// Frenar en curva es obligatorio: entrar a fondo a la curva más lenta de cada
// pista termina contra el muro (trompo); frenando a la velocidad segura no.
for (const track of TRACKS) {
  test(`${track.id}: entrar a fondo a la curva más lenta acaba en choque, frenando no`, () => {
    const P = track.path;
    const n = P.count;
    let apex = 0;
    for (let i = 0; i < n; i++) if (P.allowed[i] < P.allowed[apex]) apex = i;
    const start = (apex - 70 + n) % n;
    const drive = brake => {
      const engine = new GameEngine();
      const p = engine.createPlayerState('x', 'X', '#fff', 0, track);
      p.x = P.x[start];
      p.y = P.y[start];
      p.angle = p.moveAngle = P.tangent[start];
      p.trackIdx = start;
      p.speed = 6.3;
      let crashes = 0;
      for (let t = 1; t <= 300; t++) {
        const i = p.trackIdx;
        const j = (i + Math.round((30 + p.speed * 9) / PATH_SPACING)) % n;
        const want = Math.atan2(P.y[j] - p.y, P.x[j] - p.x);
        const delta = Math.atan2(Math.sin(want - p.angle), Math.cos(want - p.angle));
        const tooFast = brake && p.speed > P.allowed[i];
        engine.setInput(p, { left: delta < -0.03, right: delta > 0.03, up: !tooFast, down: brake && p.speed > P.allowed[i] + 0.2 });
        engine.step(p, t * TICK_MS, 0, 1, track);
        if (p.crashTicks > 0 && p.speed <= 1) crashes++;
        if ((p.trackIdx - start + n) % n > 150 && (p.trackIdx - start + n) % n < n / 2) break;
      }
      return crashes;
    };
    assert.ok(drive(false) > 0, 'a fondo debería chocar');
    assert.equal(drive(true), 0, 'frenando no debería chocar');
  });
}
