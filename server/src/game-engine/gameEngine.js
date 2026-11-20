import {
  TURN_SPEED, ACCEL, BRAKE, FRICTION, MAX_SPEED, WALL_GRAZE_DAMPING, WALL_IMPACT_DEPTH, WALL_IMPACT_DAMPING, WALL_IMPACT_MAX_SPEED, CRASH_STUN_TICKS, GRIP, SKID_SLIP_ANGLE, SKID_SCRUB, SKID_MAX_SCRUB,
  TOTAL_LAPS, BOOST_DURATION_MS, BOOST_MULTIPLIER,
  PUDDLE_GRIP_FACTOR, PUDDLE_DRAG, AQUAPLANING_MIN_SPEED
} from './gameplayConfig.js';

// Game Engine — server-authoritative (HU02, componente "Game Engine" de la
// vista de aplicación, sección 4.1). Es la única fuente de verdad del estado
// de carrera: posición, colisión con el borde de la pista y vueltas. Recibe
// la pista activa como parámetro en cada llamada en vez de tener una fija,
// para poder soportar varios circuitos con la misma física. Ni el
// Concurrency Resolver ni el Event Manager tocan posición directamente; solo
// leen/afectan parámetros (velocidad máxima efectiva) que el motor aplica.

export { TICK_MS } from './gameplayConfig.js';

// Muestras de la línea central revisadas a cada lado de la última posición
// conocida (×4 unidades): cubre de sobra lo que avanza un kart por tick.
const TRACK_SEARCH_WINDOW = 30;

const INPUT_KEYS = ['up', 'down', 'left', 'right'];

function angleDiff(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

export class GameEngine {
  createPlayerState(id, name, color, startSlot, track) {
    const start = track.startPositions[startSlot % track.startPositions.length];
    return {
      id,
      name,
      color,
      x: start.x,
      y: start.y,
      angle: start.angle,
      moveAngle: start.angle, // dirección real de movimiento (≠ angle al derrapar)
      speed: 0,
      input: { left: false, right: false, up: false, down: false },
      nextCheckpoint: 0,
      lap: 0,
      finished: false,
      finishTime: null,
      lapStartedAt: null, // reloj de carrera al empezar la vuelta actual (null = la salida)
      lapTimes: [],
      bestLapMs: null,
      boostUntil: 0,
      trackIdx: start.idx // posición conocida sobre la línea central (ver locateOnTrack)
    };
  }

  placeOnGrid(p, startSlot, track) {
    const start = track.startPositions[startSlot % track.startPositions.length];
    p.x = start.x;
    p.y = start.y;
    p.angle = start.angle;
    p.moveAngle = start.angle;
    p.trackIdx = start.idx;
  }

  resetPlayerState(p) {
    p.lap = 0;
    p.nextCheckpoint = 0;
    p.finished = false;
    p.finishTime = null;
    p.lapStartedAt = null;
    p.lapTimes = [];
    p.bestLapMs = null;
    p.speed = 0;
    p.boostUntil = 0;
  }

  /**
   * El input llega del cliente: solo se aceptan las cuatro teclas conocidas y
   * se convierten a booleano. Así un mensaje con claves arbitrarias no crece
   * el estado del jugador ni mete valores raros en la física.
   */
  setInput(p, input) {
    if (!input || typeof input !== 'object') return;
    const next = { ...p.input };
    for (const key of INPUT_KEYS) {
      if (key in input) next[key] = input[key] === true;
    }
    p.input = next;
  }

  /**
   * Avanza un tick de física para un jugador, aplica la colisión con el
   * borde de la carretera y evalúa si cruzó su próximo punto de control.
   * Devuelve un evento "lap_completed" cuando corresponde, para que Event
   * Manager y Ranking Service reaccionen sin acoplarse a la física.
   */
  step(p, now, raceStartedAt, effectiveMaxSpeedFactor, track, gripFactor = 1, puddle = null) {
    if (p.finished) return null;

    // Aquaplaning: sobre un charco el agua separa las llantas del asfalto.
    p.aquaplaning = !!puddle && Math.abs(p.speed) > AQUAPLANING_MIN_SPEED;
    if (puddle) {
      gripFactor *= PUDDLE_GRIP_FACTOR;
      p.speed *= PUDDLE_DRAG;
    }

    // El volante gira el kart (p.angle), pero la dirección en que se mueve
    // (p.moveAngle) solo puede seguirlo tan rápido como permite el agarre:
    // a velocidad v cambia como mucho GRIP / v por tick. Si se entra muy
    // rápido a una curva, el kart apunta hacia adentro pero se desliza hacia
    // afuera (derrape) y termina contra el muro: hay que frenar antes.
    const steering = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
    p.angle += steering * TURN_SPEED;
    if (p.moveAngle == null) p.moveAngle = p.angle;
    const speed = Math.abs(p.speed);
    const maxDirChange = speed > 0.01 ? (GRIP * gripFactor) / speed : Math.PI;
    const slip = angleDiff(p.angle, p.moveAngle);
    p.moveAngle += Math.max(-maxDirChange, Math.min(maxDirChange, slip));
    const remainingSlip = Math.abs(angleDiff(p.angle, p.moveAngle));
    p.skidding = remainingSlip > SKID_SLIP_ANGLE;
    // Ir de lado frena: fricción lateral proporcional al ángulo de derrape.
    if (remainingSlip > 0.02) p.speed *= 1 - Math.min(SKID_MAX_SCRUB, remainingSlip * SKID_SCRUB);

    // El boost empuja más (la velocidad final la fija la fricción, no solo el tope).
    const boosted = p.boostUntil > now;
    const accel = boosted ? ACCEL * BOOST_MULTIPLIER : ACCEL;
    if (p.crashTicks > 0) p.crashTicks -= 1;
    if (p.input.up && !(p.crashTicks > 0)) p.speed += accel;
    // Freno fuerte mientras se avanza; ya detenido, "abajo" es reversa suave.
    if (p.input.down) p.speed -= p.speed > 0 ? BRAKE : ACCEL;
    p.speed *= FRICTION;

    let effectiveMax = MAX_SPEED * effectiveMaxSpeedFactor;
    if (boosted) effectiveMax *= BOOST_MULTIPLIER;

    p.speed = Math.max(-effectiveMax / 2, Math.min(effectiveMax, p.speed));
    p.x += Math.cos(p.moveAngle) * p.speed;
    p.y += Math.sin(p.moveAngle) * p.speed;

    this.confineToRoad(p, track);

    return this.evaluateCheckpoint(p, now, raceStartedAt, track);
  }

  /**
   * Ubica al kart sobre la línea central: devuelve el índice de la muestra
   * más cercana. Se busca solo alrededor de la última posición conocida
   * (p.trackIdx), lo que es rápido y evita "saltar" a un tramo paralelo de
   * la pista que pase cerca (horquillas, rectas de ida y vuelta).
   */
  locateOnTrack(p, track) {
    const { x, y, count } = track.path;
    let best = 0;
    let bestDist = Infinity;
    const scan = (from, to) => {
      for (let k = from; k <= to; k++) {
        const i = ((k % count) + count) % count;
        const d = (x[i] - p.x) ** 2 + (y[i] - p.y) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
    };
    if (p.trackIdx == null) scan(0, count - 1);
    else scan(p.trackIdx - TRACK_SEARCH_WINDOW, p.trackIdx + TRACK_SEARCH_WINDOW);
    p.trackIdx = best;
    return best;
  }

  /**
   * Mantiene al kart dentro de la carretera (colisión con los muros): si su
   * distancia lateral a la línea central supera medio ancho de pista, se lo
   * devuelve al borde y pierde velocidad. Funciona igual para cualquier
   * trazado (rectas, horquillas, chicanas).
   */
  confineToRoad(p, track) {
    const i = this.locateOnTrack(p, track);
    const { x, y, nx, ny } = track.path;
    const lateral = (p.x - x[i]) * nx[i] + (p.y - y[i]) * ny[i];
    const limit = track.roadWidth / 2;
    if (Math.abs(lateral) > limit) {
      const excess = lateral - Math.sign(lateral) * limit;
      p.x -= nx[i] * excess;
      p.y -= ny[i] * excess;
      if (Math.abs(excess) > WALL_IMPACT_DEPTH) {
        p.speed = Math.min(p.speed * WALL_IMPACT_DAMPING, WALL_IMPACT_MAX_SPEED);
        p.crashTicks = CRASH_STUN_TICKS;
      } else {
        p.speed *= WALL_GRAZE_DAMPING;
      }
    }
  }

  evaluateCheckpoint(p, now, raceStartedAt, track) {
    const cp = track.checkpoints[p.nextCheckpoint];
    const dx = p.x - cp.x;
    const dy = p.y - cp.y;
    if (Math.sqrt(dx * dx + dy * dy) > track.checkpointRadius) return null;

    const wasLastCheckpoint = p.nextCheckpoint === track.checkpoints.length - 1;
    p.nextCheckpoint = (p.nextCheckpoint + 1) % track.checkpoints.length;
    if (!wasLastCheckpoint) return null;

    p.lap += 1;
    const lapTimeMs = now - (p.lapStartedAt ?? raceStartedAt);
    p.lapTimes.push(lapTimeMs);
    if (p.bestLapMs === null || lapTimeMs < p.bestLapMs) p.bestLapMs = lapTimeMs;
    p.lapStartedAt = now;
    if (p.lap >= TOTAL_LAPS) {
      p.finished = true;
      p.finishTime = now - raceStartedAt;
    }
    return { type: 'lap_completed', playerId: p.id, name: p.name, lap: p.lap, finished: p.finished, lapTimeMs };
  }

  applyBoost(p, now) {
    p.boostUntil = now + BOOST_DURATION_MS;
  }

  isBoosted(p, now) {
    return p.boostUntil > now;
  }

  serializePlayer(p, now) {
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      x: p.x,
      y: p.y,
      angle: p.angle,
      speed: p.speed,
      lap: p.lap,
      finished: p.finished,
      boosted: this.isBoosted(p, now),
      skidding: !!p.skidding,
      aquaplaning: !!p.aquaplaning,
      crashed: p.crashTicks > 0
    };
  }
}
