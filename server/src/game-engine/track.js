// Definición compartida de la pista: un óvalo con 4 puntos de control.
// El punto de control 0 es también la línea de meta (salida/llegada).
// Se recorre en orden 0 -> 1 -> 2 -> 3 -> 0 para completar una vuelta.

export const TRACK = {
  width: 900,
  height: 560,
  totalLaps: 3,
  checkpointRadius: 55,
  checkpoints: [
    { x: 450, y: 90 },  // 0: meta (arriba, centro)
    { x: 800, y: 280 }, // 1: derecha
    { x: 450, y: 470 }, // 2: abajo, centro
    { x: 100, y: 280 }  // 3: izquierda
  ],
  startPositions: [
    { x: 420, y: 130, angle: 0 },
    { x: 420, y: 160, angle: 0 },
    { x: 480, y: 130, angle: 0 },
    { x: 480, y: 160, angle: 0 },
    { x: 420, y: 190, angle: 0 },
    { x: 480, y: 190, angle: 0 },
    { x: 420, y: 220, angle: 0 },
    { x: 480, y: 220, angle: 0 }
  ],
  // Objetos recogibles: boost de velocidad temporal (HU03).
  pickupRadius: 28,
  pickupRespawnMs: 6000,
  boostDurationMs: 2500,
  boostMultiplier: 1.7,
  pickups: [
    { id: 'pu0', x: 630, y: 180 },
    { id: 'pu1', x: 630, y: 380 },
    { id: 'pu2', x: 270, y: 380 },
    { id: 'pu3', x: 270, y: 180 }
  ],
  // Evento dinámico de lluvia (HU04): se dispara cuando alguien completa la vuelta 1.
  rainDurationMs: 10000,
  rainSpeedFactor: 0.6
};
