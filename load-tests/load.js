// Prueba de carga: tráfico esperado en un día normal.
// Sube hasta VUS conexiones WebSocket simultáneas (por defecto 40: 8
// pilotos + espectadores), las mantiene HOLD y baja. En paralelo, visitantes
// cargan la página a RPS peticiones por segundo.
//
//   k6 run -e LOAD_TEST_TOKEN=... load.js
//   k6 run -e LOAD_TEST_TOKEN=... -e VUS=60 -e HOLD=10m load.js
import { browse, play, envNumber, durationSeconds, THRESHOLDS } from './lib/karswcol.js';

const VUS = envNumber('VUS', 40);
const HOLD = __ENV.HOLD || '5m';

export const options = {
  scenarios: {
    jugadores: {
      executor: 'ramping-vus',
      exec: 'jugador',
      startVUs: 0,
      stages: [
        { duration: '1m', target: VUS },
        { duration: HOLD, target: VUS },
        { duration: '30s', target: 0 }
      ],
      gracefulRampDown: '70s'
    },
    visitantes: {
      executor: 'constant-arrival-rate',
      exec: 'visitante',
      rate: envNumber('RPS', 5),
      timeUnit: '1s',
      duration: `${60 + durationSeconds(HOLD) + 30}s`, // lo mismo que dura la rampa de jugadores
      preAllocatedVUs: 10,
      maxVUs: 50
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
