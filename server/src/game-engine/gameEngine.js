import {
  TURN_SPEED, ACCEL, FRICTION, MAX_SPEED, WALL_BOUNCE_DAMPING,
  TOTAL_LAPS, BOOST_DURATION_MS, BOOST_MULTIPLIER
} from './gameplayConfig.js';

// Game Engine — server-authoritative (HU02, componente "Game Engine" de la
// vista de aplicación, sección 4.1). Es la única fuente de verdad del estado
// de carrera: posición, colisión con el borde de la pista y vueltas. Recibe
// la pista activa como parámetro en cada llamada en vez de tener una fija,
// para poder soportar varios circuitos con la misma física. Ni el
// Concurrency Resolver ni el Event Manager tocan posición directamente; solo
// leen/afectan parámetros (velocidad máxima efectiva) que el motor aplica.

export { TICK_MS } from './gameplayConfig.js';

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
      speed: 0,
      input: { left: false, right: false, up: false, down: false },
      nextCheckpoint: 0,
      lap: 0,
      finished: false,
      finishTime: null,
      boostUntil: 0
    };
  }

  placeOnGrid(p, startSlot, track) {
    const start = track.startPositions[startSlot % track.startPositions.length];
    p.x = start.x;
    p.y = start.y;
    p.angle = start.angle;
  }

  resetPlayerState(p) {
    p.lap = 0;
    p.nextCheckpoint = 0;
    p.finished = false;
    p.finishTime = null;
    p.speed = 0;
    p.boostUntil = 0;
  }

  setInput(p, input) {
    p.input = { ...p.input, ...input };
  }

  /**
   * Avanza un tick de física para un jugador, aplica la colisión con el
   * borde de la carretera y evalúa si cruzó su próximo punto de control.
   * Devuelve un evento "lap_completed" cuando corresponde, para que Event
   * Manager y Ranking Service reaccionen sin acoplarse a la física.
   */
  step(p, now, raceStartedAt, effectiveMaxSpeedFactor, track) {
    if (p.finished) return null;

    if (p.input.left) p.angle -= TURN_SPEED;
    if (p.input.right) p.angle += TURN_SPEED;
    if (p.input.up) p.speed += ACCEL;
    if (p.input.down) p.speed -= ACCEL;
    p.speed *= FRICTION;

    const boosted = p.boostUntil > now;
    let effectiveMax = MAX_SPEED * effectiveMaxSpeedFactor;
    if (boosted) effectiveMax *= BOOST_MULTIPLIER;

    p.speed = Math.max(-effectiveMax / 2, Math.min(effectiveMax, p.speed));
    p.x += Math.cos(p.angle) * p.speed;
    p.y += Math.sin(p.angle) * p.speed;

    this.confineToRoad(p, track);

    return this.evaluateCheckpoint(p, now, raceStartedAt, track);
  }

  /**
   * Mantiene al kart dentro del anillo de la carretera (colisión con el
   * borde). Se trabaja en coordenadas normalizadas de la elipse: en ese
   * espacio la pista es siempre un anillo centrado en radio 1, así que
   * proyectar el punto de vuelta al rango permitido funciona igual sin
   * importar la forma (rx/ry) de cada circuito.
   */
  confineToRoad(p, track) {
    const { center, rx, ry, roadWidth } = track;
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const nx = dx / rx;
    const ny = dy / ry;
    const t = Math.sqrt(nx * nx + ny * ny) || 0.0001;

    const avgRadius = (rx + ry) / 2;
    const halfBand = (roadWidth / 2) / avgRadius;
    const tMin = 1 - halfBand;
    const tMax = 1 + halfBand;

    if (t < tMin || t > tMax) {
      const clamped = Math.max(tMin, Math.min(tMax, t));
      const scale = clamped / t;
      p.x = center.x + dx * scale;
      p.y = center.y + dy * scale;
      p.speed *= WALL_BOUNCE_DAMPING;
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
    if (p.lap >= TOTAL_LAPS) {
      p.finished = true;
      p.finishTime = now - raceStartedAt;
    }
    return { type: 'lap_completed', playerId: p.id, name: p.name, lap: p.lap, finished: p.finished };
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
      boosted: this.isBoosted(p, now)
    };
  }
}
