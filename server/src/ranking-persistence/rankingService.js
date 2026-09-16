// Ranking and Persistence Service (HU05, componente de la sección 4.1).
// Calcula el resultado final de una carrera y lo persiste.
//
// Alcance actual del curso: la persistencia es en memoria (arreglo de
// carreras jugadas en este proceso). El contrato de `persistRace` es el
// punto de extensión donde, en el siguiente sprint, se conecta PostgreSQL
// (sección 4.2 de la propuesta) sin tener que tocar quién calcula el ranking.

export class RankingService {
  constructor() {
    this.history = [];
  }

  buildRanking(players) {
    return [...players]
      .sort((a, b) => (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity))
      .map((p, idx) => ({
        position: idx + 1,
        id: p.id,
        name: p.name,
        finishTimeMs: p.finishTime
      }));
  }

  persistRace(ranking) {
    // TODO(sprint siguiente): reemplazar por INSERT en PostgreSQL (tabla de
    // historial de partidas + ranking, ver sección 4.2 de la propuesta).
    this.history.push({ finishedAt: Date.now(), ranking });
  }
}
