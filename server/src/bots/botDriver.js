import { getDifficulty } from '../game-engine/difficulty.js';
import { PATH_SPACING } from '../game-engine/trackBuilder.js';

// Bot Driver: genera el mismo tipo de input que mandaría un jugador humano
// (left/right/up/down) para completar el hueco de una sala sin suficientes
// jugadores reales. No toca física ni estado de carrera directamente — solo
// produce la intención de movimiento; el Game Engine la aplica exactamente
// igual que la de un jugador humano, así que un bot no tiene ninguna
// ventaja ni regla especial.
//
// La navegación sigue la línea central de la pista activa: el bot apunta a
// un punto más adelante en el trazado (más lejos cuanto más rápido va) y
// frena cuando su velocidad supera la recomendada para la curva que viene
// (track.path.allowed, calculada al construir la pista). Así funciona en
// cualquier circuito —horquillas, chicanas, eses— sin configuración propia.

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export const BOT_NAMES = [
  'Bot Currulao', 'Bot Vallenato', 'Bot Cumbia', 'Bot Mapalé',
  'Bot Champeta', 'Bot Carranga', 'Bot Joropo', 'Bot Guasca'
];

export function computeBotInput(p, track, difficultyId, gripFactor = 1) {
  const diff = getDifficulty(difficultyId);
  const path = track.path;
  const i = p.trackIdx ?? 0;
  const lookahead = Math.round((30 + Math.abs(p.speed) * 9) / PATH_SPACING);
  const j = (i + lookahead) % path.count;
  // Cada bot va por su propio carril (p.botLane) para no formar una fila india.
  const lane = p.botLane || 0;
  const targetX = path.x[j] + path.nx[j] * lane;
  const targetY = path.y[j] + path.ny[j] * lane;
  const desiredAngle = Math.atan2(targetY - p.y, targetX - p.x);
  const delta = normalizeAngle(desiredAngle - p.angle + (Math.random() - 0.5) * diff.steerNoise);

  // Con lluvia hay menos agarre: la velocidad de curva escala con √agarre.
  const safeSpeed = path.allowed[i] * diff.cornerSpeed * Math.sqrt(gripFactor);
  const tooFast = p.speed > safeSpeed;

  return {
    left: delta < -0.05,
    right: delta > 0.05,
    up: !tooFast && Math.random() < diff.throttleChance,
    down: p.speed > safeSpeed + 0.4
  };
}
