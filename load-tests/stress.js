// Prueba de estrés: sube por escalones hasta MAX_VUS conexiones (por defecto
// 400) para encontrar el punto de quiebre: el momento en que el tick del
// servidor deja de cumplir los 50 ms y el gap entre estados se dispara.
// Se espera que algunos umbrales fallen; lo importante es en qué escalón.
// Compara la hora del quiebre con el dashboard "KARSWCOL — Pruebas de carga".
import { browse, play, envNumber, THRESHOLDS } from './lib/karswcol.js';

const MAX = envNumber('MAX_VUS', 400);
const step = n => Math.round((MAX * n) / 4);

export const options = {
  scenarios: {
    jugadores: {
      executor: 'ramping-vus',
      exec: 'jugador',
      startVUs: 0,
      stages: [
        { duration: '1m', target: step(1) },
        { duration: '2m', target: step(1) },
        { duration: '1m', target: step(2) },
        { duration: '2m', target: step(2) },
        { duration: '1m', target: step(3) },
        { duration: '2m', target: step(3) },
        { duration: '1m', target: step(4) },
        { duration: '2m', target: step(4) },
        { duration: '1m', target: 0 }
      ],
      gracefulRampDown: '70s'
    },
    visitantes: {
      executor: 'ramping-arrival-rate',
      exec: 'visitante',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 200,
      stages: [
        { duration: '6m', target: 20 },
        { duration: '7m', target: 50 },
        { duration: '1m', target: 0 }
      ]
    }
  },
  thresholds: THRESHOLDS
};

export function jugador() {
  play(60);
}

export function visitante() {
  browse();
}
