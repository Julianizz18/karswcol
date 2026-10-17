import { RAIN_DURATION_MS, RAIN_SPEED_FACTOR, RAIN_GRIP_FACTOR } from '../game-engine/gameplayConfig.js';

// Event Manager (HU04, componente "Event Manager" de la sección 4.1).
// Genera y aplica eventos dinámicos durante la carrera. Por ahora solo
// conoce el evento de lluvia, pero expone un contrato genérico para que
// agregar un evento nuevo no obligue a tocar el Game Engine.

export class EventManager {
  constructor() {
    this.rainActive = false;
    this.rainEndsAt = null;
    this.rainTriggered = false;
  }

  /**
   * `startWet`: si en la región está lloviendo de verdad (clima real), la
   * carrera arranca con la pista mojada y sigue así hasta el final.
   */
  reset(startWet = false) {
    this.rainActive = startWet;
    this.rainEndsAt = startWet ? Infinity : null;
    this.rainTriggered = startWet;
  }

  /** Se invoca cuando el Game Engine reporta que un jugador completó una vuelta. */
  onLapCompleted(lap, now) {
    if (this.rainTriggered || lap < 1) return null;
    this.rainTriggered = true;
    this.rainActive = true;
    this.rainEndsAt = now + RAIN_DURATION_MS;
    return { type: 'rain_start', durationMs: RAIN_DURATION_MS };
  }

  /** Se invoca una vez por tick para expirar eventos activos. */
  tick(now) {
    if (this.rainActive && now >= this.rainEndsAt) {
      this.rainActive = false;
      return { type: 'rain_end' };
    }
    return null;
  }

  gripFactor() {
    return this.rainActive ? RAIN_GRIP_FACTOR : 1;
  }

  speedFactor() {
    return this.rainActive ? RAIN_SPEED_FACTOR : 1;
  }
}
