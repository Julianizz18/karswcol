import { TRACK } from './track.js';

// Game Engine — server-authoritative (HU02, componente "Game Engine" de la
// vista de aplicación, sección 4.1). Es la única fuente de verdad del estado
// de carrera: posición, colisiones con el borde de pista y vueltas. Ni el
// Concurrency Resolver ni el Event Manager tocan posición directamente; solo
// leen/afectan parámetros (velocidad máxima efectiva) que el motor aplica.

export const TICK_MS = 50; // ciclo de actualización fijo del servidor (sección 5.1)
const TURN_SPEED = 0.06;
const ACCEL = 0.18;
const FRICTION = 0.965;
export const MAX_SPEED = 5.2;

export class GameEngine {
  createPlayerState(id, name, color, startSlot) {
    const start = TRACK.startPositions[startSlot % TRACK.startPositions.length];
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
   * Avanza un tick de física para un jugador y evalúa si cruzó su próximo
   * punto de control. Devuelve un evento de "lap_completed" cuando corresponde,
   * para que Event Manager y Ranking Service reaccionen sin acoplarse a la física.
   */
  step(p, now, raceStartedAt, effectiveMaxSpeedFactor) {
    if (p.finished) return null;

    if (p.input.left) p.angle -= TURN_SPEED;
    if (p.input.right) p.angle += TURN_SPEED;
    if (p.input.up) p.speed += ACCEL;
    if (p.input.down) p.speed -= ACCEL;
    p.speed *= FRICTION;

    const boosted = p.boostUntil > now;
    let effectiveMax = MAX_SPEED * effectiveMaxSpeedFactor;
    if (boosted) effectiveMax *= TRACK.boostMultiplier;

    p.speed = Math.max(-effectiveMax / 2, Math.min(effectiveMax, p.speed));
    p.x += Math.cos(p.angle) * p.speed;
    p.y += Math.sin(p.angle) * p.speed;
    p.x = Math.max(20, Math.min(TRACK.width - 20, p.x));
    p.y = Math.max(20, Math.min(TRACK.height - 20, p.y));

    return this.evaluateCheckpoint(p, now, raceStartedAt);
  }

  evaluateCheckpoint(p, now, raceStartedAt) {
    const cp = TRACK.checkpoints[p.nextCheckpoint];
    const dx = p.x - cp.x;
    const dy = p.y - cp.y;
    if (Math.sqrt(dx * dx + dy * dy) > TRACK.checkpointRadius) return null;

    const wasLastCheckpoint = p.nextCheckpoint === TRACK.checkpoints.length - 1;
    p.nextCheckpoint = (p.nextCheckpoint + 1) % TRACK.checkpoints.length;
    if (!wasLastCheckpoint) return null;

    p.lap += 1;
    if (p.lap >= TRACK.totalLaps) {
      p.finished = true;
      p.finishTime = now - raceStartedAt;
    }
    return { type: 'lap_completed', playerId: p.id, lap: p.lap, finished: p.finished };
  }

  applyBoost(p, now) {
    p.boostUntil = now + TRACK.boostDurationMs;
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
