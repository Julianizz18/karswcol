// Parámetros de juego compartidos por todas las pistas. La geometría propia
// de cada pista vive en trackCatalog.js — aquí solo lo que es igual para
// cualquier circuito (física, timings de objetos y de eventos).

export const TICK_MS = 50; // ciclo de actualización fijo del servidor (sección 5.1)
export const TURN_SPEED = 0.06;
export const ACCEL = 0.12;
export const FRICTION = 0.982;
export const MAX_SPEED = 7;
// Muros: un roce leve (entrar menos de WALL_IMPACT_DEPTH en el muro) quita
// un poco de velocidad; un golpe de verdad deja el kart casi detenido.
export const WALL_GRAZE_DAMPING = 0.97;
export const WALL_IMPACT_DEPTH = 1.2;
export const WALL_IMPACT_DAMPING = 0.3;
export const WALL_IMPACT_MAX_SPEED = 1;
// Tras un golpe el kart queda "aturdido" (trompo): no acelera durante estos ticks.
export const CRASH_STUN_TICKS = 12;
// Frenos más fuertes que el acelerador: frenar tarde antes de una curva es posible.
export const BRAKE = 0.42;
// Agarre de los neumáticos: la aceleración lateral (velocidad × cambio de
// dirección por tick) no puede superar GRIP. El kart gira con TURN_SPEED,
// pero su trayectoria solo cambia GRIP / velocidad por tick: tomar una curva
// cerrada muy rápido hace que se deslice hacia afuera. Hay que frenar.
export const GRIP = 0.12;
// Derrape: ángulo entre hacia dónde apunta el kart y hacia dónde se mueve.
// Ir de lado frena (fricción lateral) y desde SKID_SLIP_ANGLE se marca como derrape.
export const SKID_SLIP_ANGLE = 0.12;
export const SKID_SCRUB = 0.004;      // pérdida de velocidad por tick y por radián de derrape
export const SKID_MAX_SCRUB = 0.006;

export const TOTAL_LAPS = 3;
// Fin de carrera (HU05): tras llegar el primero, los demás tienen este margen
// para terminar; y ninguna carrera dura más que el límite absoluto.
export const FINISH_GRACE_MS = 30000;
export const RACE_TIME_LIMIT_MS = 7 * 60 * 1000; // hay que frenar en curva: vueltas más lentas
export const PICKUP_RADIUS = 26;
export const PICKUP_RESPAWN_MS = 6000;
export const BOOST_DURATION_MS = 2500;
export const BOOST_MULTIPLIER = 1.35;

export const RAIN_DURATION_MS = 25000;
export const RAIN_SPEED_FACTOR = 0.9;
export const RAIN_GRIP_FACTOR = 0.72; // pista mojada: bastante menos agarre en curva
// Condiciones del clima real que hacen arrancar la carrera con la pista mojada.
export const WET_CONDITIONS = ['llovizna', 'lluvia', 'tormenta'];

// Charcos (ver puddles.js): se llenan mientras llueve y se secan después.
export const PUDDLE_COUNT = 12;
export const PUDDLE_MIN_RADIUS = 14;
export const PUDDLE_MAX_RADIUS = 26;
export const PUDDLE_FILL_MS = 6000;
export const PUDDLE_DRY_MS = 9000;
// Aquaplaning: sobre un charco queda solo esta fracción del agarre y el agua frena un poco.
export const PUDDLE_GRIP_FACTOR = 0.3;
export const PUDDLE_DRAG = 0.99;
export const AQUAPLANING_MIN_SPEED = 1.5;

// Cuántos participantes debe tener la carrera como mínimo cuando se activa
// "completar con bots" (se rellena con bots hasta llegar a este número,
// nunca se quitan jugadores reales de más).
export const BOT_FILL_TARGET = 6;

export const BOT_COLORS = ['#8E44AD', '#E67E22', '#2ECC71', '#EC407A', '#00A99D', '#95A5A6'];

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
