import { TRACK } from '../game-engine/track.js';

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

  reset() {
    this.rainActive = false;
    this.rainEndsAt = null;
    this.rainTriggered = false;
  }

  /** Se invoca cuando el Game Engine reporta que un jugador completó una vuelta. */
  onLapCompleted(lap, now) {
    if (this.rainTriggered || lap < 1) return null;
    this.rainTriggered = true;
    this.rainActive = true;
    this.rainEndsAt = now + TRACK.rainDurationMs;
    return { type: 'rain_start', durationMs: TRACK.rainDurationMs };
  }

  /** Se invoca una vez por tick para expirar eventos activos. */
  tick(now) {
    if (this.rainActive && now >= this.rainEndsAt) {
      this.rainActive = false;
      return { type: 'rain_end' };
    }
    return null;
  }

  speedFactor() {
    return this.rainActive ? TRACK.rainSpeedFactor : 1;
  }
}
