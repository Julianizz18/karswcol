import { PICKUP_RADIUS, POWERUPS } from './gameplayConfig.js';

// Catálogo de pistas (HU02/HU05). Cada pista es un circuito elíptico con su
// propia geometría (tamaño, forma, ancho de carretera y número de puntos de
// control), lo que en la práctica cambia la dificultad y el ritmo de la
// vuelta, además de una identidad visual propia inspirada en una región de
// Colombia. La generación de checkpoints/objetos/parrilla de salida es
// genérica (buildTrack) para que agregar una pista nueva no implique
// duplicar lógica de físicas.

const CANVAS = { width: 900, height: 560 };
const CENTER = { x: CANVAS.width / 2, y: CANVAS.height / 2 };

function pointOnEllipse(cx, cy, rx, ry, angle) {
  return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
}

function buildTrack(cfg) {
  const { id, name, region, description, rx, ry, roadWidth, checkpointCount, palette } = cfg;
  const cx = CENTER.x;
  const cy = CENTER.y;
  const startAngle = -Math.PI / 2; // arriba del óvalo: ahí vive la línea de meta
  const checkpointRadius = roadWidth / 2 + 12;

  const checkpoints = Array.from({ length: checkpointCount }, (_, i) => {
    const angle = startAngle + i * ((Math.PI * 2) / checkpointCount);
    return { ...pointOnEllipse(cx, cy, rx, ry, angle), angle };
  });

  const pickups = Array.from({ length: checkpointCount }, (_, i) => {
    const angle = startAngle + (i + 0.5) * ((Math.PI * 2) / checkpointCount);
    const powerup = POWERUPS[i % POWERUPS.length];
    return { id: `pu${i}`, ...pointOnEllipse(cx, cy, rx, ry, angle), powerupId: powerup.id, name: powerup.name, emoji: powerup.emoji };
  });

  // En el ángulo de inicio la tangente de la elipse siempre apunta en +x,
  // así que la parrilla de salida se genera igual para cualquier pista:
  // filas hacia atrás de la meta (tangente) y carriles a los lados (normal).
  const start = pointOnEllipse(cx, cy, rx, ry, startAngle);
  const startPositions = Array.from({ length: 8 }, (_, i) => {
    const row = Math.floor(i / 2);
    const lane = i % 2 === 0 ? -18 : 18;
    return { x: start.x - (25 + row * 30), y: start.y + lane, angle: 0 };
  });

  return {
    id,
    name,
    region,
    description,
    width: CANVAS.width,
    height: CANVAS.height,
    center: { x: cx, y: cy },
    rx,
    ry,
    roadWidth,
    checkpointRadius,
    pickupRadius: PICKUP_RADIUS,
    palette,
    checkpoints,
    pickups,
    startPositions
  };
}

export const TRACKS = [
  buildTrack({
    id: 'caribe',
    name: 'Costa de Cartagena',
    region: 'Región Caribe',
    description: 'Óvalo amplio junto al mar, ideal para tomar impulso en las rectas.',
    rx: 340,
    ry: 200,
    roadWidth: 92,
    checkpointCount: 4,
    palette: { sky: ['#0b3d55', '#1489a8', '#f2c14e'], grass: '#d9c07a', road: '#3a3f47', accent: '#f2c14e' }
  }),
  buildTrack({
    id: 'andes',
    name: 'Altiplano de Bogotá',
    region: 'Región Andina',
    description: 'Circuito cerrado y frío en las montañas, con más curvas técnicas.',
    rx: 260,
    ry: 260,
    roadWidth: 80,
    checkpointCount: 5,
    palette: { sky: ['#1c2b45', '#3a5a78', '#8fb3c9'], grass: '#274a34', road: '#40454d', accent: '#8fd0ff' }
  }),
  buildTrack({
    id: 'cafetero',
    name: 'Eje Cafetero',
    region: 'Región Andina — zona cafetera',
    description: 'Lomas suaves entre cafetales, ancho cómodo para pelear posiciones.',
    rx: 320,
    ry: 180,
    roadWidth: 86,
    checkpointCount: 4,
    palette: { sky: ['#274423', '#4c7a3f', '#cfe6a8'], grass: '#3c6b2f', road: '#3a3f47', accent: '#c98a3a' }
  }),
  buildTrack({
    id: 'llanos',
    name: 'Llanos Orientales',
    region: 'Región Orinoquía',
    description: 'Óvalo largo y plano bajo un atardecer llanero, para ir a fondo.',
    rx: 380,
    ry: 150,
    roadWidth: 100,
    checkpointCount: 4,
    palette: { sky: ['#3a1f14', '#a2531f', '#f2b13d'], grass: '#8a7331', road: '#3a3f47', accent: '#f2b13d' }
  }),
  buildTrack({
    id: 'amazonia',
    name: 'Selva Amazónica',
    region: 'Región Amazonía',
    description: 'Circuito cerrado y técnico entre la selva, con más puntos de control.',
    rx: 230,
    ry: 230,
    roadWidth: 72,
    checkpointCount: 6,
    palette: { sky: ['#08210f', '#12401f', '#2f6b2a'], grass: '#0f3d1c', road: '#33251c', accent: '#7ee08a' }
  })
];

export function getTrackById(id) {
  return TRACKS.find(t => t.id === id) || TRACKS[0];
}
