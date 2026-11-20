// Perfiles de dificultad para los bots. Es una configuración global de sala
// (la elige el anfitrión de la sala en el lobby y aplica por igual a todos los
// bots), no un ajuste por bot individual.

export const DIFFICULTIES = {
  facil: { label: 'Fácil', throttleChance: 0.6, steerNoise: 0.4, cornerSpeed: 0.85 },
  medio: { label: 'Medio', throttleChance: 0.82, steerNoise: 0.18, cornerSpeed: 0.95 },
  dificil: { label: 'Difícil', throttleChance: 1, steerNoise: 0.04, cornerSpeed: 1 }
};

export const DEFAULT_DIFFICULTY = 'medio';

export function getDifficulty(id) {
  return DIFFICULTIES[id] || DIFFICULTIES[DEFAULT_DIFFICULTY];
}
