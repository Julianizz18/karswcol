// Matchmaking Service (HU01, componente "Matchmaking Service" de la vista de
// aplicación, sección 4.1 de la propuesta).
// Responsabilidad única: agrupar jugadores en una sala y decidir cuándo el
// grupo está listo para pasar a carrera. No conoce física ni reglas de juego.

export const ROOM_CAPACITY = 8;
export const MIN_PLAYERS_TO_START = 1; // relajado para pruebas locales; el objetivo de diseño es 4-8

export class MatchmakingService {
  constructor() {
    this.players = new Map(); // id -> { id, name, color, ready }
  }

  hasCapacity() {
    return this.players.size < ROOM_CAPACITY;
  }

  join(id, name, color, avatar = '') {
    this.players.set(id, { id, name, color, avatar, ready: false });
  }

  leave(id) {
    this.players.delete(id);
  }

  setReady(id) {
    const p = this.players.get(id);
    if (p) p.ready = true;
  }

  list() {
    return [...this.players.values()];
  }

  isEmpty() {
    return this.players.size === 0;
  }

  allReadyToStart() {
    const players = this.list();
    return players.length >= MIN_PLAYERS_TO_START && players.every(p => p.ready);
  }

  resetReadiness() {
    for (const p of this.players.values()) p.ready = false;
  }
}
