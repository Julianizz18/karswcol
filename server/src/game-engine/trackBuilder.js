import { PICKUP_RADIUS, POWERUPS, TURN_SPEED, GRIP } from './gameplayConfig.js';

// Constructor de pistas. Un circuito se describe como en un trazado real de
// Fórmula 1: una secuencia de rectas (S) y curvas a la derecha (R) o a la
// izquierda (L) con radio y ángulo propios. A partir de eso se genera la
// línea central muestreada cada PATH_SPACING unidades, que usan:
//   - el Game Engine para confinar los karts a la carretera (muros),
//   - los bots para seguir el trazado y frenar antes de cada curva,
//   - los clientes (2D y 3D) para dibujar exactamente la misma pista.
// Puntos de control, objetos y parrilla de salida se derivan de la línea
// central, así que agregar una pista es solo describir su trazado
// (ver trackCatalog.js).

export const PATH_SPACING = 4;     // separación entre muestras de la línea central
export const CURB_WIDTH = 7;       // bordillo a cada lado (solo visual, fuera de la zona jugable)
const MIN_STRAIGHT = 40;           // largo mínimo de una recta tras cerrar el circuito
const ADJUSTABLE_STRAIGHT = 50;    // solo las rectas largas se ajustan al cerrar (no las de chicanas)
const BRAKE_PER_UNIT = 0.07;       // cuánto puede bajar la velocidad por unidad recorrida al frenar

// ---------- Lenguaje de diseño ----------
// Convención: el eje y crece hacia abajo (como en pantalla). Una curva a la
// derecha (R) aumenta el ángulo de rumbo; a la izquierda (L) lo disminuye.
export const S = len => ({ type: 'S', len });
export const R = (radius, deg) => ({ type: 'A', radius, deg });
export const L = (radius, deg) => ({ type: 'A', radius, deg: deg === 'auto' ? 'auto' : -deg });
const toRad = deg => (deg * Math.PI) / 180;

/** Recorre los segmentos y devuelve el punto final y el rumbo con el que empieza cada recta. */
export function walk(segments) {
  let x = 0;
  let y = 0;
  let heading = 0;
  const straights = [];
  segments.forEach((seg, i) => {
    if (seg.type === 'S') {
      straights.push({ index: i, dx: Math.cos(heading), dy: Math.sin(heading) });
      x += Math.cos(heading) * seg.len;
      y += Math.sin(heading) * seg.len;
    } else {
      const phi = toRad(seg.deg);
      const side = Math.sign(phi);
      const cx = x + side * seg.radius * -Math.sin(heading);
      const cy = y + side * seg.radius * Math.cos(heading);
      heading += phi;
      x = cx + side * seg.radius * Math.sin(heading);
      y = cy - side * seg.radius * Math.cos(heading);
    }
  });
  return { x, y, heading, straights };
}

/**
 * Cierra el circuito de forma exacta:
 *  1. El rumbo: la curva marcada 'auto' toma el ángulo que falta para
 *     completar ±360° (sentido horario o antihorario).
 *  2. La posición: el error de cierre se reparte entre todas las rectas,
 *     en proporción a su largo (ajuste de norma mínima ponderada), así el
 *     trazado se deforma lo menos posible y las rectas largas absorben más.
 */
function closeCircuit(design, clockwise) {
  const segments = design.map(s => ({ ...s }));
  const target = clockwise ? 360 : -360;
  const fixed = segments.filter(s => s.type === 'A' && s.deg !== 'auto').reduce((sum, s) => sum + s.deg, 0);
  const auto = segments.find(s => s.deg === 'auto');
  if (auto) auto.deg = target - fixed;
  const total = segments.filter(s => s.type === 'A').reduce((sum, s) => sum + s.deg, 0);
  if (Math.abs(total - target) > 1e-6) throw new Error(`El trazado gira ${total}°, debe girar ${target}°`);

  const walked = walk(segments);
  const { x, y } = walked;
  const straights = walked.straights.filter(st => segments[st.index].len >= ADJUSTABLE_STRAIGHT);
  // Δ = -W·Dᵀ·(D·W·Dᵀ)⁻¹·E, con D = direcciones de las rectas, W = sus largos, E = error.
  let a = 0;
  let b = 0;
  let c = 0;
  straights.forEach(st => {
    const w = segments[st.index].len;
    a += w * st.dx * st.dx;
    b += w * st.dx * st.dy;
    c += w * st.dy * st.dy;
  });
  const det = a * c - b * b;
  if (Math.abs(det) < 1e-6) throw new Error('No se pudo cerrar el circuito: todas las rectas son paralelas');
  const lx = (c * -x - b * -y) / det;
  const ly = (a * -y - b * -x) / det;
  straights.forEach(st => {
    const seg = segments[st.index];
    seg.len += seg.len * (st.dx * lx + st.dy * ly);
  });
  const short = straights.map(st => segments[st.index]).find(seg => seg.len < MIN_STRAIGHT);
  if (short) {
    throw new Error(`No se pudo cerrar el circuito (error de ${Math.hypot(x, y).toFixed(0)} u): una recta quedaría de ${short.len.toFixed(0)} u`);
  }
  return segments;
}

/** Muestrea la línea central cerrada (sin repetir el punto final). */
function sampleCenterline(segments) {
  const xs = [];
  const ys = [];
  let x = 0;
  let y = 0;
  let heading = 0;
  segments.forEach(seg => {
    if (seg.type === 'S') {
      const n = Math.max(1, Math.round(seg.len / PATH_SPACING));
      for (let i = 0; i < n; i++) {
        xs.push(x + Math.cos(heading) * (seg.len * i) / n);
        ys.push(y + Math.sin(heading) * (seg.len * i) / n);
      }
      x += Math.cos(heading) * seg.len;
      y += Math.sin(heading) * seg.len;
    } else {
      const phi = toRad(seg.deg);
      const side = Math.sign(phi);
      const cx = x + side * seg.radius * -Math.sin(heading);
      const cy = y + side * seg.radius * Math.cos(heading);
      const n = Math.max(1, Math.round((seg.radius * Math.abs(phi)) / PATH_SPACING));
      for (let i = 0; i < n; i++) {
        const h = heading + (phi * i) / n;
        xs.push(cx + side * seg.radius * Math.sin(h));
        ys.push(cy - side * seg.radius * Math.cos(h));
      }
      heading += phi;
      x = cx + side * seg.radius * Math.sin(heading);
      y = cy - side * seg.radius * Math.cos(heading);
    }
  });
  return { xs, ys };
}

function angleDiff(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

export function buildTrack(cfg) {
  const { id, name, region, description, inspiration, roadWidth, palette, clockwise = true } = cfg;
  const segments = closeCircuit(cfg.design, clockwise);
  if (segments[0].type !== 'S') throw new Error(`${id}: el diseño debe empezar en la recta principal`);
  const raw = sampleCenterline(segments);

  // La línea de meta queda a 2/3 de la recta principal: la parrilla cabe detrás.
  const startOffset = Math.round((segments[0].len * 0.66) / PATH_SPACING);
  const n = raw.xs.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = raw.xs[(i + startOffset) % n];
    y[i] = raw.ys[(i + startOffset) % n];
  }

  // Rumbo, normal (hacia la derecha del sentido de carrera) y distancia acumulada.
  const tangent = new Float64Array(n);
  const nx = new Float64Array(n);
  const ny = new Float64Array(n);
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    tangent[i] = Math.atan2(y[b] - y[a], x[b] - x[a]);
    nx[i] = -Math.sin(tangent[i]);
    ny[i] = Math.cos(tangent[i]);
    if (i > 0) s[i] = s[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
  }
  const length = s[n - 1] + Math.hypot(x[0] - x[n - 1], y[0] - y[n - 1]);
  const indexAt = dist => {
    const d = ((dist % length) + length) % length;
    return Math.min(n - 1, Math.round((d / length) * n));
  };

  // Velocidad recomendada en cada punto (para los bots). Para seguir un
  // radio r a velocidad v hace falta girar v / r por tick, y el motor permite
  // como máximo min(TURN_SPEED, GRIP / v): eso da v ≤ min(TURN_SPEED·r, √(GRIP·r)).
  // Luego se propaga hacia atrás para empezar a frenar antes de cada curva.
  const allowed = new Float64Array(n);
  const W = 4;
  for (let i = 0; i < n; i++) {
    const turn = Math.abs(angleDiff(tangent[(i + W) % n], tangent[(i - W + n) % n]));
    const radius = turn < 1e-4 ? Infinity : (2 * W * PATH_SPACING) / turn;
    const usable = radius + roadWidth * 0.2; // aprovechando parte del ancho de la pista
    allowed[i] = Math.min(99, TURN_SPEED * usable, Math.sqrt(GRIP * usable));
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      allowed[i] = Math.min(allowed[i], allowed[(i + 1) % n] + BRAKE_PER_UNIT * PATH_SPACING);
    }
  }

  const point = (i, lateral = 0) => ({ x: x[i] + nx[i] * lateral, y: y[i] + ny[i] * lateral });

  // Puntos de control repartidos por la vuelta; el último es la línea de meta,
  // así la vuelta cuenta al cruzarla (no antes).
  const checkpointCount = cfg.checkpoints;
  const checkpoints = Array.from({ length: checkpointCount }, (_, i) => {
    const idx = indexAt((length * (i + 1)) / checkpointCount);
    return { ...point(idx), angle: tangent[idx], idx };
  });

  const pickupCount = cfg.pickups || 6;
  const pickups = Array.from({ length: pickupCount }, (_, i) => {
    const idx = indexAt((length * (i + 0.5)) / pickupCount);
    const powerup = POWERUPS[i % POWERUPS.length];
    const lateral = (i % 2 === 0 ? -1 : 1) * roadWidth * 0.2;
    return { id: `pu${i}`, ...point(idx, lateral), powerupId: powerup.id, name: powerup.name, emoji: powerup.emoji };
  });

  // Parrilla de salida en dos columnas, detrás de la meta.
  const startPositions = Array.from({ length: 8 }, (_, i) => {
    const row = Math.floor(i / 2);
    const idx = indexAt(-(36 + row * 36 + (i % 2) * 14));
    const lane = (i % 2 === 0 ? -1 : 1) * roadWidth * 0.22;
    return { ...point(idx, lane), angle: tangent[idx], idx };
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, x[i]);
    minY = Math.min(minY, y[i]);
    maxX = Math.max(maxX, x[i]);
    maxY = Math.max(maxY, y[i]);
  }
  const bounds = { minX, minY, maxX, maxY };

  // Línea central liviana para los clientes (cada 2 muestras = 8 unidades).
  const centerline = [];
  for (let i = 0; i < n; i += 2) centerline.push([Math.round(x[i] * 10) / 10, Math.round(y[i] * 10) / 10]);

  // Silueta normalizada (0..1) para la vista previa del lobby.
  const size = Math.max(maxX - minX, maxY - minY);
  const outline = [];
  const step = Math.max(1, Math.floor(n / 90));
  for (let i = 0; i < n; i += step) {
    outline.push([
      Math.round(((x[i] - minX) / size) * 1000) / 1000,
      Math.round(((y[i] - minY) / size) * 1000) / 1000
    ]);
  }

  const track = {
    id,
    name,
    region,
    description,
    inspiration,
    roadWidth,
    curbWidth: CURB_WIDTH,
    checkpointRadius: roadWidth / 2 + 12,
    pickupRadius: PICKUP_RADIUS,
    palette,
    length: Math.round(length),
    bounds,
    startLine: { ...point(0), angle: tangent[0] },
    centerline,
    outline,
    checkpoints,
    pickups,
    startPositions
  };
  // Datos densos solo para el servidor: no enumerables, así no viajan en el JSON a los clientes.
  Object.defineProperty(track, 'path', { value: { x, y, nx, ny, tangent, s, allowed, length, count: n }, enumerable: false });
  return track;
}
