// Prueba de resistencia (soak): carga moderada y constante durante mucho
// tiempo (por defecto 20 VUs por 30 min) para detectar fugas de memoria,
// timers que no se limpian o degradación con carreras repetidas.
// En Grafana, la memoria y el heap deben quedar planos, no subir en rampa.
import { browse, play, envNumber, THRESHOLDS } from './lib/karswcol.js';
import { sleep } from 'k6';

const VUS = envNumber('VUS', 20);
const DURATION = __ENV.DURATION || '30m';

export const options = {
  scenarios: {
    jugadores: { executor: 'constant-vus', exec: 'jugador', vus: VUS, duration: DURATION, gracefulStop: '70s' },
    visitantes: { executor: 'constant-vus', exec: 'visitante', vus: 2, duration: DURATION }
  },
  thresholds: THRESHOLDS
};

export function jugador() {
  play(120);
}

export function visitante() {
  browse();
  sleep(2);
}
