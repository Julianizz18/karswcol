import {
  RAIN_DURATION_MS, RAIN_SPEED_FACTOR, RAIN_GRIP_FACTOR, RAIN_CHANCE, RAIN_DURATION_JITTER, TOTAL_LAPS
} from '../game-engine/gameplayConfig.js';

// Event Manager (HU04, componente "Event Manager" de la sección 4.1).
// Genera y aplica eventos dinámicos durante la carrera. Por ahora solo
// conoce el evento de lluvia, pero expone un contrato genérico para que
// agregar un evento nuevo no obligue a tocar el Game Engine.

export class EventManager {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.rainActive = false;
    this.rainEndsAt = null;
    this.rainTriggered = false;
    this.planRain();
  }

  /**
   * Antes siempre llovía al completar la primera vuelta: el evento era
   * predecible. Ahora cada carrera sortea si llueve, en qué vuelta (de la 1
   * a la penúltima) y cuánto dura.
   */
  planRain(totalLaps = TOTAL_LAPS) {
    this.rainWillHappen = this.random() < RAIN_CHANCE;
    this.rainLap = 1 + Math.floor(this.random() * Math.max(1, totalLaps - 1));
    this.rainDurationMs = Math.round(RAIN_DURATION_MS * (1 - RAIN_DURATION_JITTER + this.random() * 2 * RAIN_DURATION_JITTER));
  }

  /**
   * `startWet`: si en la región está lloviendo de verdad (clima real), la
   * carrera arranca con la pista mojada y sigue así hasta el final.
   */
  reset(startWet = false, totalLaps = TOTAL_LAPS) {
    this.rainActive = startWet;
    this.rainEndsAt = startWet ? Infinity : null;
    this.rainTriggered = startWet;
    this.planRain(totalLaps);
  }

  /** Se invoca cuando el Game Engine reporta que un jugador completó una vuelta. */
  onLapCompleted(lap, now) {
    if (this.rainTriggered || !this.rainWillHappen || lap < this.rainLap) return null;
    this.rainTriggered = true;
    this.rainActive = true;
    this.rainEndsAt = now + this.rainDurationMs;
    return { type: 'rain_start', durationMs: this.rainDurationMs };
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
