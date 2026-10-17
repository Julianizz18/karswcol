import { PATH_SPACING } from './trackBuilder.js';
import {
  PUDDLE_COUNT, PUDDLE_MIN_RADIUS, PUDDLE_MAX_RADIUS, PUDDLE_FILL_MS, PUDDLE_DRY_MS
} from './gameplayConfig.js';

// Charcos sobre la pista (HU04, lluvia). Mientras llueve se van llenando y
// cuando para se secan poco a poco. Pisar uno provoca aquaplaning: el kart
// casi pierde el agarre (ver PUDDLE_GRIP_FACTOR) y se va de lado. Las
// posiciones son fijas por pista (semilla = id), así son iguales para todos
// los jugadores y en cada carrera; se reparten por toda la vuelta y con
// preferencia por las zonas de frenado antes de curva, donde más duelen.

function seededRandom(seedText) {
  let seed = 0;
  for (let i = 0; i < seedText.length; i++) seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0;
  return () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class PuddleField {
  constructor(track) {
    const rand = seededRandom(`charcos-${track.id}`);
    const { x, y, nx, ny, allowed, count } = track.path;
    const spacing = Math.floor(count / PUDDLE_COUNT);
    const half = track.roadWidth / 2;
    this.puddles = Array.from({ length: PUDDLE_COUNT }, (_, k) => {
      // Dentro de cada tramo se busca el punto de frenado más exigente.
      let best = k * spacing + Math.floor(rand() * spacing);
      for (let tries = 0; tries < 6; tries++) {
        const i = k * spacing + Math.floor(rand() * spacing);
        if (allowed[i] < allowed[best]) best = i;
      }
      // La parrilla de salida queda seca.
      if (best < Math.round(60 / PATH_SPACING) || best > count - Math.round(220 / PATH_SPACING)) best = k * spacing + Math.floor(spacing / 2);
      const radius = PUDDLE_MIN_RADIUS + rand() * (PUDDLE_MAX_RADIUS - PUDDLE_MIN_RADIUS);
      const lateral = (rand() * 2 - 1) * Math.max(0, half - radius * 0.6);
      return {
        id: `ch${k}`,
        x: x[best] + nx[best] * lateral,
        y: y[best] + ny[best] * lateral,
        radius,
        stretch: 1 + rand() * 0.8,          // los charcos no son círculos perfectos
        angle: Math.atan2(ny[best], nx[best]) + (rand() - 0.5),
        level: 0
      };
    });
  }

  /** Llena o seca los charcos según si la pista está mojada. */
  update(dtMs, wet) {
    const delta = wet ? dtMs / PUDDLE_FILL_MS : -dtMs / PUDDLE_DRY_MS;
    for (const p of this.puddles) p.level = Math.max(0, Math.min(1, p.level + delta));
  }

  /** Charco bajo el punto (x, y), o null. Su tamaño efectivo crece con el nivel de agua. */
  puddleAt(x, y) {
    for (const p of this.puddles) {
      if (p.level < 0.15) continue;
      // Elipse rotada: se pasa el punto al sistema del charco.
      const dx = x - p.x;
      const dy = y - p.y;
      const c = Math.cos(-p.angle);
      const s = Math.sin(-p.angle);
      const lx = (dx * c - dy * s) / p.stretch;
      const ly = dx * s + dy * c;
      const r = p.radius * p.level;
      if (lx * lx + ly * ly <= r * r) return p;
    }
    return null;
  }

  get anyWater() {
    return this.puddles.some(p => p.level > 0);
  }

  serialize() {
    return this.puddles.map(p => ({
      id: p.id,
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      radius: p.radius,
      stretch: p.stretch,
      angle: p.angle,
      level: Math.round(p.level * 100) / 100
    }));
  }
}
