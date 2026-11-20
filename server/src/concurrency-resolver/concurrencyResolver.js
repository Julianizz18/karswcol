import { PICKUP_RESPAWN_MS } from '../game-engine/gameplayConfig.js';

// Concurrency Resolver (HU03/HU04, componente dedicado en la sección 4.1).
// Resuelve conflictos cuando dos o más jugadores compiten por el mismo
// recurso compartido (un objeto recogible con identidad colombiana: tinto,
// arepa, aguapanela...). La regla adoptada en la sección 5.1 de la
// propuesta es: dentro de un mismo ciclo de servidor, los reclamos se
// resuelven en el orden exacto en que los jugadores fueron iterados (que
// corresponde al orden de llegada al servidor); el primero en tomar el
// recurso lo marca como no disponible dentro de una sección crítica corta
// (una sola asignación síncrona), y los reclamos posteriores en el mismo
// tick simplemente no encuentran el recurso disponible.

// La reaparición de cada objeto se guarda como un instante del reloj de
// carrera (respawnAt) en vez de un setTimeout: así respeta la pausa (el
// reloj de carrera no avanza mientras está pausada) y no quedan timers
// acumulados durante la carrera.

export class ConcurrencyResolver {
  constructor() {
    this.pickups = [];
    this.radius = 26;
  }

  reset(track) {
    this.radius = track.pickupRadius;
    this.pickups = track.pickups.map(p => ({ ...p, respawnAt: 0 }));
  }

  /**
   * Intenta reclamar objetos cercanos a un jugador. Debe llamarse una vez por
   * jugador y por tick, siempre en el mismo orden de iteración, para que la
   * resolución de conflictos sea determinista. `now` es el reloj de carrera.
   */
  tryClaim(player, gameEngine, now) {
    for (const pickup of this.pickups) {
      if (pickup.respawnAt > now) continue;
      const dx = player.x - pickup.x;
      const dy = player.y - pickup.y;
      if (dx * dx + dy * dy > this.radius * this.radius) continue;

      // Sección crítica: una sola asignación síncrona: nadie más puede ver
      // este recurso disponible después de esta línea en el tick actual.
      pickup.respawnAt = now + PICKUP_RESPAWN_MS;
      gameEngine.applyBoost(player, now);

      return { type: 'pickup_claimed', pickupId: pickup.id, by: player.name, itemName: pickup.name, emoji: pickup.emoji };
    }
    return null;
  }

  serialize(now) {
    return this.pickups.map(pu => ({ id: pu.id, x: pu.x, y: pu.y, available: pu.respawnAt <= now, emoji: pu.emoji, name: pu.name }));
  }

  clear() {
    this.pickups = [];
  }
}
