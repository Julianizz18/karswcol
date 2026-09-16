// Parámetros de juego compartidos por todas las pistas. La geometría propia
// de cada pista vive en trackCatalog.js — aquí solo lo que es igual para
// cualquier circuito (física, timings de objetos y de eventos).

export const TICK_MS = 50; // ciclo de actualización fijo del servidor (sección 5.1)
export const TURN_SPEED = 0.06;
export const ACCEL = 0.18;
export const FRICTION = 0.965;
export const MAX_SPEED = 5.2;
export const WALL_BOUNCE_DAMPING = 0.75; // pierde velocidad al rozar el borde de la pista

export const TOTAL_LAPS = 3;
export const PICKUP_RADIUS = 26;
export const PICKUP_RESPAWN_MS = 6000;
export const BOOST_DURATION_MS = 2500;
export const BOOST_MULTIPLIER = 1.7;

export const RAIN_DURATION_MS = 10000;
export const RAIN_SPEED_FACTOR = 0.6;

// Objetos recogibles con identidad colombiana (HU03). El efecto de juego es
// el mismo para todos (boost de velocidad); lo que cambia es la
// presentación, para que recoger uno se sienta como parte del tema del
// juego y no como un ítem genérico.
export const POWERUPS = [
  { id: 'tinto', name: 'Tinto', emoji: '☕' },
  { id: 'arepa', name: 'Arepa', emoji: '🫓' },
  { id: 'aguapanela', name: 'Aguapanela', emoji: '🥤' },
  { id: 'lechona', name: 'Lechona', emoji: '🍖' },
  { id: 'tamal', name: 'Tamal', emoji: '🫔' },
  { id: 'bunuelo', name: 'Buñuelo', emoji: '🥯' }
];
