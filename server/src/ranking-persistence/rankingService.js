// Ranking and Persistence Service (HU05, componente de la sección 4.1).
// Calcula el resultado final de una carrera y lo persiste.
//
// Alcance actual del curso: la persistencia es en memoria (arreglo de
// carreras jugadas en este proceso). El contrato de `persistRace` es el
// punto de extensión donde, en el siguiente sprint, se conecta PostgreSQL
// (sección 4.2 de la propuesta) sin tener que tocar quién calcula el ranking.

function compareResults(a, b) {
  const aDone = a.finishTime != null;
  const bDone = b.finishTime != null;
  if (aDone && bDone) return a.finishTime - b.finishTime;
  if (aDone !== bDone) return aDone ? -1 : 1;
  return (b.lap ?? 0) - (a.lap ?? 0) || (b.nextCheckpoint ?? 0) - (a.nextCheckpoint ?? 0);
}

export class RankingService {
  constructor() {
    this.history = [];
  }

  /**
   * Primero los que terminaron, por tiempo. Después los que no terminaron,
   * por avance: más vueltas y, a igual vuelta, más puntos de control. Antes
   * todos los que no terminaban empataban y quedaban en orden arbitrario.
   */
  buildRanking(players) {
    return [...players]
      .sort(compareResults)
      .map((p, idx) => ({
        position: idx + 1,
        id: p.id,
        name: p.name,
        finishTimeMs: p.finishTime,
        lap: p.lap ?? 0,
        bestLapMs: p.bestLapMs ?? null
      }));
  }

  persistRace(ranking) {
    // TODO(sprint siguiente): reemplazar por INSERT en PostgreSQL (tabla de
    // historial de partidas + ranking, ver sección 4.2 de la propuesta).
    this.history.push({ finishedAt: Date.now(), ranking });
  }
}
