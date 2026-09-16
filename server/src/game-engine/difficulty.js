// Perfiles de dificultad para los bots. Es una configuración global de sala
// (la elige cualquier jugador en el lobby y aplica por igual a todos los
// bots), no un ajuste por bot individual.

export const DIFFICULTIES = {
  facil: { label: 'Fácil', throttleChance: 0.6, steerNoise: 0.4 },
  medio: { label: 'Medio', throttleChance: 0.82, steerNoise: 0.18 },
  dificil: { label: 'Difícil', throttleChance: 1, steerNoise: 0.04 }
};

export const DEFAULT_DIFFICULTY = 'medio';

export function getDifficulty(id) {
  return DIFFICULTIES[id] || DIFFICULTIES[DEFAULT_DIFFICULTY];
}
