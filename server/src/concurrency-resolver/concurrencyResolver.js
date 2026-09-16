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

export class ConcurrencyResolver {
  constructor() {
    this.pickups = [];
    this.timers = [];
    this.radius = 26;
  }

  reset(track) {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.radius = track.pickupRadius;
    this.pickups = track.pickups.map(p => ({ ...p, available: true }));
  }

  /**
   * Intenta reclamar objetos cercanos a un jugador. Debe llamarse una vez por
   * jugador y por tick, siempre en el mismo orden de iteración, para que la
   * resolución de conflictos sea determinista.
   */
  tryClaim(player, gameEngine, now) {
    for (const pickup of this.pickups) {
      if (!pickup.available) continue;
      const dx = player.x - pickup.x;
      const dy = player.y - pickup.y;
      if (Math.sqrt(dx * dx + dy * dy) > this.radius) continue;

      // Sección crítica: una sola asignación síncrona: nadie más puede leer
      // "available: true" para este recurso después de esta línea en el tick actual.
      pickup.available = false;
      gameEngine.applyBoost(player, now);

      const timer = setTimeout(() => {
        pickup.available = true;
      }, PICKUP_RESPAWN_MS);
      this.timers.push(timer);

      return { type: 'pickup_claimed', pickupId: pickup.id, by: player.name, itemName: pickup.name, emoji: pickup.emoji };
    }
    return null;
  }

  serialize() {
    return this.pickups.map(pu => ({ id: pu.id, x: pu.x, y: pu.y, available: pu.available, emoji: pu.emoji, name: pu.name }));
  }

  clear() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.pickups = [];
  }
}
