// Prueba de humo: 1 jugador y 1 visitante durante 30 s.
// Sirve para validar que el entorno y los scripts funcionan antes de
// lanzar pruebas más pesadas. Debe pasar siempre.
import { browse, play, THRESHOLDS } from './lib/karswcol.js';
import { sleep } from 'k6';

export const options = {
  scenarios: {
    jugador: { executor: 'per-vu-iterations', exec: 'jugador', vus: 1, iterations: 1, maxDuration: '1m' },
    visitante: { executor: 'constant-vus', exec: 'visitante', vus: 1, duration: '30s' }
  },
  thresholds: THRESHOLDS
};

export function jugador() {
  play(30);
}

export function visitante() {
  browse();
  sleep(1);
}
