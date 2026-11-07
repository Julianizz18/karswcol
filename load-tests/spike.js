// Prueba de pico: de 5 a PEAK_VUS conexiones (por defecto 200) en 10 s,
// como cuando el profe comparte el enlace en clase. Mide si el servidor
// aguanta la avalancha de handshakes y si se recupera al bajar.
import { play, envNumber, THRESHOLDS } from './lib/karswcol.js';

const PEAK = envNumber('PEAK_VUS', 200);

export const options = {
  scenarios: {
    pico: {
      executor: 'ramping-vus',
      exec: 'jugador',
      startVUs: 5,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '10s', target: PEAK },
        { duration: '1m', target: PEAK },
        { duration: '10s', target: 5 },
        { duration: '1m', target: 5 },
        { duration: '10s', target: 0 }
      ],
      gracefulRampDown: '40s'
    }
  },
  thresholds: THRESHOLDS
};

export function jugador() {
  play(30);
}
