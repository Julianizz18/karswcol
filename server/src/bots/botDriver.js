import { getDifficulty } from '../game-engine/difficulty.js';

// Bot Driver: genera el mismo tipo de input que mandaría un jugador humano
// (left/right/up/down) para completar el hueco de una sala sin suficientes
// jugadores reales. No toca física ni estado de carrera directamente — solo
// produce la intención de movimiento; el Game Engine la aplica exactamente
// igual que la de un jugador humano, así que un bot no tiene ninguna
// ventaja ni regla especial.
//
// La navegación reutiliza los puntos de control de la pista activa como
// ruta: el bot siempre dirige hacia `track.checkpoints[p.nextCheckpoint]`,
// así que funciona igual en cualquiera de las 5 pistas sin configuración
// adicional por circuito.

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export const BOT_NAMES = [
  'Bot Currulao', 'Bot Vallenato', 'Bot Cumbia', 'Bot Mapalé',
  'Bot Champeta', 'Bot Carranga', 'Bot Joropo', 'Bot Guasca'
];

export function computeBotInput(p, track, difficultyId) {
  const diff = getDifficulty(difficultyId);
  const target = track.checkpoints[p.nextCheckpoint];
  const desiredAngle = Math.atan2(target.y - p.y, target.x - p.x);
  const delta = normalizeAngle(desiredAngle - p.angle + (Math.random() - 0.5) * diff.steerNoise);

  return {
    left: delta < -0.06,
    right: delta > 0.06,
    up: Math.random() < diff.throttleChance,
    down: false
  };
}
