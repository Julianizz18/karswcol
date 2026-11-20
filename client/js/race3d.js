// Cámara de carrera en 3D (Three.js). Construye la pista como geometría real
// (carretera, bordillos, muros, arco de meta, árboles, montañas) a partir de
// los mismos parámetros de elipse que usa el servidor para las colisiones, y
// sigue al vehículo propio desde atrás. La niebla oculta lo lejano, así que
// la pista se va descubriendo a medida que se avanza.
//
// Igual que el renderer 2D, no calcula física: solo dibuja lo que confirma
// el servidor. Como el servidor envía estados cada 50 ms, aquí se
// interpolan las posiciones para que el movimiento se vea fluido a 60 fps.
//
// Mapeo de coordenadas: el punto (x, y) del mundo 2D del servidor es
// (x, altura, y) en 3D, y un ángulo θ apunta hacia (cos θ, 0, sin θ).
import * as THREE from '../vendor/three.module.min.js';

const INTERP_DELAY_MS = 70;   // un poco más que un tick del servidor (50 ms)
const CAM_BACK = 40;
const CAM_HEIGHT = 15;
const LOOK_AHEAD = 40;
const BASE_FOV = 62;
const MAX_SPEED = 7;          // gameplayConfig.js, solo para efectos visuales
const VEHICLE_WIDTH = 26;
const CURB_WIDTH = 7;
const WALL_HEIGHT = 3.2;

// Vegetación por región: tipo de árbol, cantidad y colores.
const SCENERY = {
  caribe: { kind: 'palm', count: 130, canopy: '#3f8f3a', trunk: '#8a6a43' },
  andes: { kind: 'pine', count: 260, canopy: '#1f4a35', trunk: '#4a3626' },
  cafetero: { kind: 'round', count: 320, canopy: '#2f6a2a', trunk: '#5a3e26' },
  llanos: { kind: 'round', count: 90, canopy: '#5d7a2a', trunk: '#5a4428' },
  amazonia: { kind: 'round', count: 420, canopy: '#1d5a26', trunk: '#3d2b1c' }
};

const canvas = document.getElementById('race-canvas-3d');
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(canvas.width, canvas.height, false);
  // Sombras del sol (solo se proyectan con cielo despejado o parcial, ver Clima).
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
} catch (err) {
  console.warn('WebGL no disponible, se usará la vista 2D.', err);
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(BASE_FOV, canvas.width / canvas.height, 1, 4000);
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();

let currentTrack = null;
let currentWeather = null;
let currentLook = null;     // ver weatherLook()
let atmosphere = null;      // nubes, sol/luna, estrellas, relámpagos
let sceneLights = {};
let roadMaterial = null;
let puddleGroup = null;
const puddleMeshes = new Map();
let wetness = 0;            // 0 = pista seca, 1 = empapada (se suaviza en el tiempo)
let trackGroup = null;
let skyMesh = null;
let rain = null;
let selfId = null;
let snapshots = [];
const vehicles = new Map(); // id -> { group, kind, ... }
const pickupModels = new Map(); // id -> grupo 3D del objeto recogible
const cam = { angle: null, initialized: false, tilt: 0, prevSelfAngle: null };
let rafHandle = null;
let lastFrame = 0;
let viewSize = { w: 0, h: 0 };
let baseFov = BASE_FOV;

/**
 * Ajusta la resolución del render al tamaño real del canvas en pantalla
 * (cambia con la ventana, el zoom o al girar el celular). En pantallas
 * angostas abre el FOV vertical para conservar la visión hacia los lados.
 */
function syncSize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h || (w === viewSize.w && h === viewSize.h)) return;
  viewSize = { w, h };
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const minHorizontal = 2 * Math.atan(Math.tan((BASE_FOV * Math.PI) / 360) * 1.55);
  const neededVertical = (2 * Math.atan(Math.tan(minHorizontal / 2) / camera.aspect) * 180) / Math.PI;
  baseFov = Math.min(100, Math.max(BASE_FOV, neededVertical));
  camera.fov = baseFov;
  camera.updateProjectionMatrix();
}

// ---------- Utilidades ----------

function angleDiff(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

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

function loadTexture(src, onLoad) {
  if (textureCache.has(src)) {
    const tex = textureCache.get(src);
    if (tex.image && tex.image.width) onLoad && onLoad(tex);
    else tex.userData.callbacks.push(onLoad);
    return tex;
  }
  const tex = textureLoader.load(src, t => t.userData.callbacks.forEach(cb => cb && cb(t)));
  tex.userData.callbacks = [onLoad];
  tex.userData.shared = true; // compartida entre vehículos: no se libera al cambiar de pista
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textureCache.set(src, tex);
  return tex;
}

function canvasTexture(width, height, draw, { repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  draw(c.getContext('2d'), width, height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function shade(hex, amount) {
  const color = new THREE.Color(hex);
  return amount >= 0 ? color.lerp(new THREE.Color('#ffffff'), amount) : color.lerp(new THREE.Color('#000000'), -amount);
}

// ---------- Geometría de la pista ----------
// El servidor manda la línea central del trazado (track.centerline). Todo
// lo que rodea la pista se construye desplazándose hacia los lados de esa
// línea, con el mismo medio ancho que el servidor usa para los muros
// (gameEngine.confineToRoad), así lo que se ve coincide con las colisiones.

/** Puntos, normales (hacia la derecha del sentido de carrera) y distancia acumulada. */
function trackPath(track) {
  if (track._path3d) return track._path3d;
  const pts = track.centerline;
  const n = pts.length;
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const nx = new Float32Array(n);
  const nz = new Float32Array(n);
  const s = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) {
    x[i] = pts[i][0];
    z[i] = pts[i][1];
  }
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    const t = Math.atan2(z[b] - z[a], x[b] - x[a]);
    nx[i] = -Math.sin(t);
    nz[i] = Math.cos(t);
    s[i + 1] = s[i] + Math.hypot(x[(i + 1) % n] - x[i], z[(i + 1) % n] - z[i]);
  }
  const path = { x, z, nx, nz, s, n };
  Object.defineProperty(track, '_path3d', { value: path, enumerable: false });
  return path;
}

/** Punto desplazado lateralmente desde la muestra i (negativo = izquierda). */
function offsetPoint(path, i, lateral) {
  const k = ((i % path.n) + path.n) % path.n;
  return new THREE.Vector3(path.x[k] + path.nx[k] * lateral, 0, path.z[k] + path.nz[k] * lateral);
}

/**
 * Cinta a lo largo de toda la vuelta entre dos desplazamientos laterales
 * (offIn, offOut), o un muro vertical si se pasa `wallHeight`. La
 * coordenada v avanza con la distancia recorrida dividida por `vScale`,
 * para que las texturas se repitan sin estirarse.
 */
function ribbonGeometry(track, offIn, offOut, { y = 0, vScale = 40, wallHeight = 0 } = {}) {
  const path = trackPath(track);
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= path.n; i++) {
    const pIn = offsetPoint(path, i, offIn);
    if (wallHeight) {
      positions.push(pIn.x, y, pIn.z, pIn.x, y + wallHeight, pIn.z);
    } else {
      const pOut = offsetPoint(path, i, offOut);
      positions.push(pIn.x, y, pIn.z, pOut.x, y, pOut.z);
    }
    const v = path.s[i] / vScale;
    uvs.push(0, v, 1, v);
    if (i < path.n) {
      const j = i * 2;
      indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Cuadrícula para saber rápido si un punto está cerca de la pista. */
function nearTrackTester(track, cell = 64) {
  const path = trackPath(track);
  const grid = new Map();
  const key = (cx, cz) => cx * 100003 + cz;
  for (let i = 0; i < path.n; i++) {
    const k = key(Math.floor(path.x[i] / cell), Math.floor(path.z[i] / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  return (x, z, radius) => {
    const r = Math.ceil(radius / cell);
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const list = grid.get(key(cx + dx, cz + dz));
        if (!list) continue;
        for (const i of list) {
          if ((path.x[i] - x) ** 2 + (path.z[i] - z) ** 2 < radius * radius) return true;
        }
      }
    }
    return false;
  };
}

function boundsCenter(track) {
  const b = track.bounds;
  return { x: (b.minX + b.maxX) / 2, z: (b.minY + b.maxY) / 2, size: Math.max(b.maxX - b.minX, b.maxY - b.minY) };
}

// ---------- Texturas procedurales ----------

function asphaltTexture(roadColor) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = roadColor;
    g.fillRect(0, 0, w, h);
    const rand = seededRandom('asfalto');
    for (let i = 0; i < 2600; i++) {
      const light = rand() > 0.5;
      g.fillStyle = light ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
      g.fillRect(rand() * w, rand() * h, 2, 2);
    }
    // Línea central discontinua y líneas de borde.
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(w / 2 - 3, 0, 6, h * 0.5);
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(6, 0, 5, h);
    g.fillRect(w - 11, 0, 5, h);
  }, { repeat: true });
}

function grassTexture(grassColor) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = grassColor;
    g.fillRect(0, 0, w, h);
    const rand = seededRandom('pasto');
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.06)';
      g.fillRect(rand() * w, rand() * h, 1 + rand() * 3, 1 + rand() * 3);
    }
  }, { repeat: true });
}

function stripeTexture(colorA, colorB) {
  return canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = colorA;
    g.fillRect(0, 0, w, h / 2);
    g.fillStyle = colorB;
    g.fillRect(0, h / 2, w, h / 2);
  }, { repeat: true });
}

// Línea de meta: 2 columnas a lo largo del sentido de carrera y 16 filas a lo ancho.
function checkerTexture() {
  return canvasTexture(32, 256, (g, w, h) => {
    const cell = w / 2;
    for (let col = 0; col < 2; col++) {
      for (let row = 0; row < h / cell; row++) {
        g.fillStyle = (col + row) % 2 ? '#111' : '#f4f4f4';
        g.fillRect(col * cell, row * cell, cell, cell);
      }
    }
  });
}

/** Pancarta de los arcos: el texto se achica solo si no cabe (nombres largos). */
function bannerTexture(text, { bg = '#0d1526', fg = '#ffffff', stripe = '#FCD116' } = {}) {
  return canvasTexture(1024, 96, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = stripe;
    g.fillRect(0, 0, w, 8);
    g.fillRect(0, h - 8, w, 8);
    g.fillStyle = fg;
    let size = 58;
    g.font = `bold ${size}px Bungee, "Segoe UI", sans-serif`;
    while (g.measureText(text).width > w - 60 && size > 20) {
      size -= 2;
      g.font = `bold ${size}px Bungee, "Segoe UI", sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  });
}

// Letreros del equipo (Squad Gato Dumas), con los colores de la bandera.
const TEAM_BANNERS = [
  { text: 'SARA ARTEAGA', bg: '#FCD116', fg: '#0d1526', stripe: '#003893' },
  { text: 'SEBASTIAN BELTRAN', bg: '#003893', fg: '#ffffff', stripe: '#FCD116' },
  { text: 'JULIAN TINJACA', bg: '#CE1126', fg: '#ffffff', stripe: '#FCD116' }
];

function labelTexture(text) {
  return canvasTexture(256, 64, (g, w, h) => {
    g.font = '600 30px Rubik, "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const width = Math.min(w - 8, g.measureText(text).width + 28);
    g.fillStyle = 'rgba(7,12,23,0.7)';
    g.beginPath();
    g.roundRect((w - width) / 2, 8, width, h - 16, 18);
    g.fill();
    g.fillStyle = '#fff';
    g.fillText(text, w / 2, h / 2 + 1, w - 20);
  });
}

const glowTexture = canvasTexture(64, 64, (g, w, h) => {
  const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
});
glowTexture.userData.shared = true;

// ---------- Construcción de la escena ----------

function disposeGroup(group) {
  group.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => {
        if (m.userData.shared) return; // material de mat(), lo siguen usando otros modelos
        if (m.map && !m.map.userData.shared) m.map.dispose();
        m.dispose();
      });
    }
  });
}

function buildSky(topColor, horizonColor) {
  const horizon = new THREE.Color(horizonColor);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(topColor) }, bottom: { value: horizon } },
    vertexShader: `varying vec3 vWorld;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vWorld;
      void main() { float h = normalize(vWorld - cameraPosition).y; gl_FragColor = vec4(mix(bottom, top, smoothstep(0.0, 0.45, h)), 1.0);
      #include <colorspace_fragment>
      }`
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 24, 12), material);
  sky.renderOrder = -1;
  return { sky, horizon };
}

function buildMountains(track, pal, horizon, rand) {
  const group = new THREE.Group();
  const color = new THREE.Color(pal.sky[0]).lerp(horizon, 0.45);
  const material = new THREE.MeshBasicMaterial({ color, fog: false });
  const geometry = new THREE.ConeGeometry(1, 1, 5);
  const count = 56;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const m = new THREE.Matrix4();
  const c = boundsCenter(track);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand() * 0.1;
    const dist = c.size / 2 + 1300 + rand() * 500;
    const height = (track.id === 'llanos' || track.id === 'caribe' ? 90 : 220) + rand() * 260;
    const width = 260 + rand() * 260;
    m.compose(
      new THREE.Vector3(c.x + Math.cos(a) * dist, height / 2 - 20, c.z + Math.sin(a) * dist),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI),
      new THREE.Vector3(width, height, width)
    );
    mesh.setMatrixAt(i, m);
  }
  group.add(mesh);
  return group;
}

function buildTrees(track, rand) {
  const cfg = SCENERY[track.id] || SCENERY.cafetero;
  // Las pistas tipo F1 cubren más terreno que los óvalos: más árboles.
  const count = cfg.count * 2;
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.7, 1.1, 1, 6);
  trunkGeo.translate(0, 0.5, 0);
  const canopyGeo = cfg.kind === 'pine' ? new THREE.ConeGeometry(1, 1, 7) : new THREE.IcosahedronGeometry(1, 0);
  const trunkMat = new THREE.MeshLambertMaterial({ color: cfg.trunk });
  const canopyMat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const baseColor = new THREE.Color(cfg.canopy);
  const b = track.bounds;
  const margin = 450;
  const clearance = track.roadWidth / 2 + CURB_WIDTH + 14;
  const nearTrack = nearTrackTester(track);
  const start = track.startLine;

  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 30) {
    attempts++;
    const x = b.minX - margin + rand() * (b.maxX - b.minX + margin * 2);
    const z = b.minY - margin + rand() * (b.maxY - b.minY + margin * 2);
    if (nearTrack(x, z, clearance)) continue;
    // Despejar el arco de meta.
    if (Math.hypot(x - start.x, z - start.y) < track.roadWidth + 20) continue;

    const size = 0.75 + rand() * 0.6;
    let trunkH;
    let canopyPos;
    let canopyScale;
    if (cfg.kind === 'palm') {
      trunkH = 16 * size;
      canopyPos = trunkH;
      canopyScale = new THREE.Vector3(7 * size, 1.8 * size, 7 * size);
    } else if (cfg.kind === 'pine') {
      trunkH = 4 * size;
      canopyPos = trunkH + 8 * size;
      canopyScale = new THREE.Vector3(5.5 * size, 18 * size, 5.5 * size);
    } else {
      trunkH = 5 * size;
      canopyPos = trunkH + 4.5 * size;
      canopyScale = new THREE.Vector3(6.5 * size, 6 * size, 6.5 * size);
    }
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(size, trunkH, size));
    trunks.setMatrixAt(placed, m);
    m.compose(new THREE.Vector3(x, canopyPos, z), q, canopyScale);
    canopies.setMatrixAt(placed, m);
    canopies.setColorAt(placed, baseColor.clone().offsetHSL((rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.12));
    placed++;
  }
  trunks.count = placed;
  canopies.count = placed;
  trunks.castShadow = true;
  canopies.castShadow = true;
  group.add(trunks, canopies);
  return group;
}

// ---------- Elementos típicos de cada región ----------
// Cada pista suma objetos de su región alrededor del trazado. Un elemento
// se arma con varias piezas (geometrías ya desplazadas a su lugar dentro del
// objeto) y cada pieza es un InstancedMesh: cientos de objetos cuestan unas
// pocas llamadas de dibujo.

/**
 * Reparte `count` objetos fuera de la carretera, entre `minGap` y `maxGap`
 * unidades del borde (cerca de la pista, donde se ven desde el kart).
 */
function scatterProps(track, rand, { count, parts, minGap = 18, maxGap = 160, minSize = 0.8, maxSize = 1.3 }) {
  const group = new THREE.Group();
  const meshes = parts.map(({ geometry, color, material }) => {
    const mesh = new THREE.InstancedMesh(geometry, material || new THREE.MeshLambertMaterial({ color, flatShading: true }), count);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  });
  const path = trackPath(track);
  const nearTrack = nearTrackTester(track);
  const start = track.startLine;
  const edge = track.roadWidth / 2 + CURB_WIDTH;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 40 && path.n) {
    attempts++;
    // Un punto de la línea central y un desplazamiento perpendicular a la
    // carretera, a la izquierda o a la derecha.
    const i = Math.floor(rand() * path.n);
    const side = rand() < 0.5 ? -1 : 1;
    const dist = edge + minGap + rand() * (maxGap - minGap);
    const x = path.x[i] + path.nx[i] * side * dist;
    const z = path.z[i] + path.nz[i] * side * dist;
    // Otra parte del trazado puede pasar cerca (curvas cerradas, horquillas).
    if (nearTrack(x, z, edge + minGap)) continue;
    if (Math.hypot(x - start.x, z - start.y) < track.roadWidth + 30) continue;

    const size = minSize + rand() * (maxSize - minSize);
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(size, size, size));
    meshes.forEach(mesh => mesh.setMatrixAt(placed, m));
    placed++;
  }
  meshes.forEach(mesh => { mesh.count = placed; });
  return group;
}

/** Geometría ya ubicada dentro del objeto: (x, y, z) es el centro de la pieza. */
function piece(geometry, x, y, z) {
  geometry.translate(x, y, z);
  return geometry;
}

// Costa de Cartagena: sombrillas de playa de rayas.
function caribeProps(track, rand) {
  const group = new THREE.Group();
  [['#e63946', '#f1faee'], ['#1d6fa5', '#f1faee'], ['#f2c14e', '#e76f51']].forEach(([a, b]) => {
    group.add(scatterProps(track, rand, {
      count: 14,
      parts: [
        { geometry: piece(new THREE.CylinderGeometry(0.35, 0.35, 11, 6), 0, 5.5, 0), color: '#d9d4c7' },
        { geometry: piece(new THREE.ConeGeometry(8, 3, 8, 1, true), 0, 11.5, 0), color: a, material: new THREE.MeshLambertMaterial({ color: a, flatShading: true, side: THREE.DoubleSide }) },
        { geometry: piece(new THREE.ConeGeometry(8.05, 3, 8, 1, true, 0, Math.PI / 4), 0, 11.5, 0), color: b, material: new THREE.MeshLambertMaterial({ color: b, flatShading: true, side: THREE.DoubleSide }) },
        { geometry: piece(new THREE.BoxGeometry(6, 0.8, 3), 3.5, 0.6, 3), color: '#f4f1e8' } // toalla / asiento
      ]
    }));
  });
  return group;
}

// Altiplano de Bogotá: frailejones del páramo (tronco grueso y roseta
// de hojas plateadas, algunos con flor amarilla).
function andesProps(track, rand) {
  const rosette = new THREE.IcosahedronGeometry(2.4, 0);
  rosette.scale(1, 0.55, 1);
  return scatterProps(track, rand, {
    count: 70,
    minSize: 0.7,
    maxSize: 1.5,
    parts: [
      { geometry: piece(new THREE.CylinderGeometry(0.9, 1.2, 6, 7), 0, 3, 0), color: '#6f5f4a' },
      { geometry: piece(rosette, 0, 6.6, 0), color: '#a9b88a' },
      { geometry: piece(new THREE.CylinderGeometry(0.12, 0.12, 2.2, 4), 0.6, 8, 0), color: '#7d8a5a' },
      { geometry: piece(new THREE.IcosahedronGeometry(0.5, 0), 0.6, 9.2, 0), color: '#f2c84b' }
    ]
  });
}

// Eje Cafetero: matas de café cargadas de granos rojos (cerezas).
function cafeteroProps(track, rand) {
  const bush = new THREE.IcosahedronGeometry(2.6, 1);
  bush.scale(1, 1.35, 1);
  const cherries = [[1.9, 3.4, 1], [-1.6, 4.2, 1.3], [0.4, 5.6, -1.7], [-1.2, 2.6, -1.8], [1.4, 5, -0.6]];
  return scatterProps(track, rand, {
    count: 110,
    minGap: 14,
    maxGap: 120,
    parts: [
      { geometry: piece(new THREE.CylinderGeometry(0.35, 0.45, 1.6, 5), 0, 0.8, 0), color: '#5a3e26' },
      { geometry: piece(bush, 0, 4, 0), color: '#2d6a2a' },
      ...cherries.map(([x, y, z]) => ({ geometry: piece(new THREE.IcosahedronGeometry(0.45, 0), x, y, z), color: '#c0262d' }))
    ]
  });
}

// Llanos Orientales: ganado pastando en la sabana.
function llanosProps(track, rand) {
  const legs = [[2.6, 1.1], [2.6, -1.1], [-2.6, 1.1], [-2.6, -1.1]];
  return scatterProps(track, rand, {
    count: 45,
    minGap: 30,
    maxGap: 220,
    minSize: 0.9,
    maxSize: 1.15,
    parts: [
      { geometry: piece(new THREE.BoxGeometry(8, 3.8, 3.6), 0, 4.6, 0), color: '#f1ede4' },
      { geometry: piece(new THREE.BoxGeometry(2.6, 3.9, 3.7), -1.2, 4.6, 0), color: '#222222' }, // mancha
      { geometry: piece(new THREE.BoxGeometry(2.6, 2.4, 2.4), 5, 4.2, 0), color: '#f1ede4' },  // cabeza, pastando
      { geometry: piece(new THREE.BoxGeometry(0.9, 1.2, 2), 6.4, 3.6, 0), color: '#d9a6a0' },  // hocico
      { geometry: piece(new THREE.BoxGeometry(0.4, 0.4, 4), 4.6, 5.6, 0), color: '#e8dcc0' },  // cachos
      ...legs.map(([x, z]) => ({ geometry: piece(new THREE.BoxGeometry(0.9, 2.8, 0.9), x, 1.4, z), color: '#e6e0d4' }))
    ]
  });
}

const REGIONAL_PROPS = {
  caribe: caribeProps,
  andes: andesProps,
  cafetero: cafeteroProps,
  llanos: llanosProps
};

function buildRegionalProps(track, rand) {
  const builder = REGIONAL_PROPS[track.id];
  return builder ? builder(track, rand) : null;
}

/** Postes a ambos lados de la pista en el punto (x, y) con rumbo `angle`. */
function sidePoints(track, x, y, angle, lateral) {
  const nx = -Math.sin(angle);
  const nz = Math.cos(angle);
  return [-1, 1].map(side => new THREE.Vector3(x + nx * lateral * side, 0, y + nz * lateral * side));
}

/**
 * Arco sobre la pista en (x, y): dos postes y una pancarta. `front` es la
 * cara que ven los pilotos al acercarse; `back`, la que ven al alejarse.
 */
function buildGantry(track, x, y, angle, front, back) {
  const group = new THREE.Group();
  const [pIn, pOut] = sidePoints(track, x, y, angle, track.roadWidth / 2 + CURB_WIDTH + 3);
  const span = pIn.distanceTo(pOut);
  const mid = pIn.clone().add(pOut).multiplyScalar(0.5);
  const dir = Math.atan2(pOut.z - pIn.z, pOut.x - pIn.x);
  const postMat = new THREE.MeshLambertMaterial({ color: '#e8e8e8' });
  const postGeo = new THREE.BoxGeometry(3, 26, 3);
  [pIn, pOut].forEach(p => {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(p.x, 13, p.z);
    post.castShadow = true;
    group.add(post);
  });
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(span + 3, 7, 1.5),
    [postMat, postMat, postMat, postMat,
      new THREE.MeshBasicMaterial({ map: front }),
      new THREE.MeshBasicMaterial({ map: back })]
  );
  banner.position.set(mid.x, 25, mid.z);
  banner.rotation.y = -dir;
  banner.castShadow = true;
  group.add(banner);
  return group;
}

/** Índice de la línea central más recto cerca de `around` (para ubicar letreros). */
function straightestNear(track, around, window = 30) {
  const path = trackPath(track);
  const n = path.n;
  const heading = i => {
    const a = ((i - 2) % n + n) % n;
    const b = ((i + 2) % n + n) % n;
    return Math.atan2(path.z[b] - path.z[a], path.x[b] - path.x[a]);
  };
  let best = around;
  let bestTurn = Infinity;
  for (let k = around - window; k <= around + window; k++) {
    let turn = 0;
    for (let d = -6; d <= 6; d += 3) turn += Math.abs(angleDiff(heading(k + d + 3), heading(k + d)));
    if (turn < bestTurn) {
      bestTurn = turn;
      best = ((k % n) + n) % n;
    }
  }
  return best;
}

/** Los tres arcos con los nombres del equipo, repartidos a lo largo de la vuelta. */
function buildTeamBanners(track) {
  const group = new THREE.Group();
  const path = trackPath(track);
  TEAM_BANNERS.forEach((banner, k) => {
    const i = straightestNear(track, Math.round(((k + 1) * path.n) / (TEAM_BANNERS.length + 1)));
    const j = (i + 1) % path.n;
    const angle = Math.atan2(path.z[j] - path.z[i], path.x[j] - path.x[i]);
    const tex = bannerTexture(banner.text, banner);
    group.add(buildGantry(track, path.x[i], path.z[i], angle, tex, tex));
  });
  return group;
}

function buildStartArch(track, pal) {
  const { x, y, angle } = track.startLine;
  const group = buildGantry(track, x, y, angle,
    bannerTexture('KARSWCOL', { stripe: pal.accent }),
    bannerTexture('META', { stripe: pal.accent }));

  // Línea de meta a cuadros sobre la carretera.
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(10, track.roadWidth).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: checkerTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  );
  line.position.set(x, 0.09, y);
  line.rotation.y = -angle;
  group.add(line);
  return group;
}

function buildCheckpointGates(track, pal) {
  const group = new THREE.Group();
  const flagMat = new THREE.MeshBasicMaterial({ color: pal.accent });
  const poleMat = new THREE.MeshLambertMaterial({ color: '#dddddd' });
  const poleGeo = new THREE.CylinderGeometry(0.5, 0.5, 14, 6);
  const flagGeo = new THREE.BoxGeometry(6, 4, 0.3);
  // El último punto de control es la meta: ahí ya está el arco.
  track.checkpoints.slice(0, -1).forEach(cp => {
    sidePoints(track, cp.x, cp.y, cp.angle, track.roadWidth / 2 + CURB_WIDTH + 3).forEach(p => {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(p.x, 7, p.z);
      const flag = new THREE.Mesh(flagGeo, flagMat);
      flag.position.set(p.x, 12, p.z);
      flag.rotation.y = -cp.angle;
      group.add(pole, flag);
    });
  });
  return group;
}

// ---------- Clima ----------
// El servidor manda el clima real y actual de la región de la pista
// (Open-Meteo) o, sin internet, su clima típico. Cada condición define cielo,
// luz, niebla, nubes, lluvia y si el sol proyecta sombras; de noche todo se
// oscurece, aparecen la luna y las estrellas y la pista se ilumina con postes,
// como una carrera nocturna.

const WEATHER_LOOKS = {
  despejado: { sky: ['#2b78d0', '#bfe1fb'], sun: 3.1, sunColor: '#fff1d6', hemi: 1.25, fogNear: 120, fogFar: 950, clouds: 7, cloudColor: '#ffffff', shadows: true, rain: 0 },
  parcial: { sky: ['#3a82cc', '#cbdfee'], sun: 2.6, sunColor: '#fff4e0', hemi: 1.4, fogNear: 110, fogFar: 820, clouds: 26, cloudColor: '#f3f5f7', shadows: true, rain: 0 },
  nublado: { sky: ['#77838e', '#b6bfc7'], sun: 0.9, sunColor: '#e6ebf0', hemi: 1.85, fogNear: 90, fogFar: 620, clouds: 42, cloudColor: '#9aa3ab', shadows: false, rain: 0 },
  niebla: { sky: ['#9aa4ac', '#c3c9ce'], sun: 0.6, sunColor: '#e6ebf0', hemi: 1.9, fogNear: 15, fogFar: 240, clouds: 0, cloudColor: '#c3c9ce', shadows: false, rain: 0 },
  llovizna: { sky: ['#626d77', '#949ea6'], sun: 0.6, sunColor: '#dde3ea', hemi: 1.65, fogNear: 70, fogFar: 470, clouds: 42, cloudColor: '#7b848c', shadows: false, rain: 0.45 },
  lluvia: { sky: ['#4a555f', '#7d8891'], sun: 0.45, sunColor: '#d5dce4', hemi: 1.45, fogNear: 60, fogFar: 380, clouds: 46, cloudColor: '#5e676f', shadows: false, rain: 1 },
  tormenta: { sky: ['#272e36', '#525c66'], sun: 0.25, sunColor: '#c9d2dc', hemi: 1.15, fogNear: 50, fogFar: 320, clouds: 50, cloudColor: '#3c444c', shadows: false, rain: 1, lightning: true }
};

/** Combina la condición con el momento del día. */
function weatherLook(weather) {
  const info = weather || { condition: 'despejado', isDay: true };
  const base = WEATHER_LOOKS[info.condition] || WEATHER_LOOKS.despejado;
  const look = { ...base, condition: info.condition, isDay: info.isDay !== false };
  if (!look.isDay) {
    const darkness = base.shadows ? 0 : 0.35; // con nubes la noche es aún más cerrada
    look.sky = [
      new THREE.Color('#040917').lerp(new THREE.Color(base.sky[0]), 0.08).getStyle(),
      new THREE.Color('#1a2747').lerp(new THREE.Color('#0d1422'), darkness).getStyle()
    ];
    look.sun = 0.55;               // luz de luna
    look.sunColor = '#9fb6ff';
    look.hemi = base.hemi * 0.5;
    look.ambient = 0.55;           // reflejo de los postes de luz sobre la pista
    look.cloudColor = new THREE.Color(base.cloudColor).multiplyScalar(0.28).getStyle();
    look.shadows = false;
    look.stars = base.clouds < 30;
    look.fogFar = Math.min(base.fogFar, 700);
  }
  return look;
}

function cloudTexture() {
  return canvasTexture(256, 128, (g, w, h) => {
    const puff = (x, y, r) => {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.6, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    };
    [[70, 76, 46], [120, 60, 56], [176, 74, 44], [100, 86, 40], [150, 88, 42]].forEach(([x, y, r]) => puff(x, y, r));
  });
}

/** Nubes, estrellas y el disco del sol o la luna. Se mueven con la cámara. */
function buildAtmosphere(track, look, rand) {
  const group = new THREE.Group();
  const center = boundsCenter(track);
  const atmo = { group, sunSprite: null, sunDir: null, lightningAt: 0, flash: 0 };

  // Dirección del sol (o la luna): alta y desde un lado propio de cada pista.
  const azimuth = rand() * Math.PI * 2;
  const elevation = look.isDay ? 0.85 : 0.7;
  atmo.sunDir = new THREE.Vector3(Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.sin(azimuth) * Math.cos(elevation));

  const showDisc = look.isDay ? look.shadows : look.condition !== 'niebla' && look.clouds < 45;
  if (showDisc) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: look.isDay ? '#fff6dc' : '#dfe8ff',
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    }));
    const size = look.isDay ? 520 : 200;
    sprite.scale.set(size, size, 1);
    sprite.renderOrder = -1;
    atmo.sunSprite = sprite;
    group.add(sprite);
  }

  if (look.clouds) {
    const tex = cloudTexture();
    for (let i = 0; i < look.clouds; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: look.cloudColor, transparent: true, depthWrite: false, fog: false, opacity: 0.85 }));
      const a = rand() * Math.PI * 2;
      const r = 300 + rand() * (center.size * 0.9 + 900);
      const w = 380 + rand() * 520;
      sprite.position.set(center.x + Math.cos(a) * r, 420 + rand() * 260, center.z + Math.sin(a) * r);
      sprite.scale.set(w, w * 0.45, 1);
      group.add(sprite);
    }
  }

  if (look.stars) {
    const count = 700;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const e = 0.12 + rand() * 1.4;
      positions.set([Math.cos(a) * Math.cos(e) * 2800, Math.sin(e) * 2800, Math.sin(a) * Math.cos(e) * 2800], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const stars = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
    stars.userData.followCamera = true;
    atmo.stars = stars;
    group.add(stars);
  }
  return atmo;
}

/** De noche: postes de luz a lo largo de la pista, alternando lados. */
function buildFloodlights(track) {
  const group = new THREE.Group();
  const path = trackPath(track);
  const poleMat = new THREE.MeshLambertMaterial({ color: '#8d949c' });
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fff6d8' });
  const poleGeo = new THREE.CylinderGeometry(0.6, 0.8, 30, 6);
  const lampGeo = new THREE.BoxGeometry(5, 1.4, 3);
  const glowMat = new THREE.SpriteMaterial({ map: glowTexture, color: '#ffe9b0', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85 });
  const poolMat = new THREE.MeshBasicMaterial({ map: glowTexture, color: '#ffe4a0', transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
  const poolGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  const every = Math.max(10, Math.round(150 / (path.s[path.n] / path.n)));
  for (let i = 0, k = 0; i < path.n; i += every, k++) {
    const side = k % 2 === 0 ? 1 : -1;
    const base = offsetPoint(path, i, side * (track.roadWidth / 2 + CURB_WIDTH + 10));
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(base.x, 15, base.z);
    const head = offsetPoint(path, i, side * (track.roadWidth / 2 + CURB_WIDTH + 2));
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(head.x, 30, head.z);
    const glow = new THREE.Sprite(glowMat);
    glow.position.set(head.x, 29, head.z);
    glow.scale.set(22, 22, 1);
    // Charco de luz sobre el asfalto (sin luces reales: barato para la GPU).
    const pool = new THREE.Mesh(poolGeo, poolMat);
    const spot = offsetPoint(path, i, side * track.roadWidth * 0.15);
    pool.position.set(spot.x, 0.12, spot.z);
    pool.scale.set(track.roadWidth * 0.75, 1, track.roadWidth * 0.75);
    pool.renderOrder = 1;
    group.add(pole, lamp, glow, pool);
  }
  return group;
}

/** Sigue al jugador con la luz del sol (sombras nítidas cerca) y anima tormentas. */
function updateAtmosphere(target, dt, now) {
  if (!atmosphere) return;
  const { sunDir } = atmosphere;
  if (sceneLights.sun && target) {
    sceneLights.sun.position.set(target.x + sunDir.x * 400, sunDir.y * 400, target.y + sunDir.z * 400);
    sceneLights.sun.target.position.set(target.x, 0, target.y);
  }
  if (atmosphere.sunSprite) atmosphere.sunSprite.position.copy(camera.position).addScaledVector(sunDir, 2400);
  if (atmosphere.stars) atmosphere.stars.position.copy(camera.position);
  if (currentLook.lightning) {
    if (now > atmosphere.lightningAt) {
      atmosphere.flash = 1;
      atmosphere.lightningAt = now + 5000 + Math.random() * 9000;
    }
    atmosphere.flash = Math.max(0, atmosphere.flash - dt * 6);
    sceneLights.hemi.intensity = currentLook.hemi + atmosphere.flash * 4;
  }
}

function buildTrack(track) {
  const pal = track.palette;
  const rand = seededRandom(track.id);
  const group = new THREE.Group();
  const center = boundsCenter(track);

  const look = currentLook;
  const { sky, horizon } = buildSky(look.sky[0], look.sky[1]);
  skyMesh = sky;
  scene.add(sky);
  scene.fog = new THREE.Fog(horizon, look.fogNear, look.fogFar);
  scene.background = horizon;
  scene.userData.horizon = horizon;

  const hemi = new THREE.HemisphereLight(shade(look.sky[1], 0.5), new THREE.Color(pal.grass), look.hemi);
  const sun = new THREE.DirectionalLight(look.sunColor, look.sun);
  sun.castShadow = look.shadows;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -170, right: 170, top: 170, bottom: -170, near: 50, far: 900 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  group.add(hemi, sun, sun.target);
  sceneLights = { hemi, sun };
  if (look.ambient) group.add(new THREE.AmbientLight('#ffe9c4', look.ambient));

  const grassTex = grassTexture(pal.grass);
  grassTex.repeat.set(200, 200);
  // Capas casi a la misma altura (pasto, asfalto, bordillos, meta): se
  // dibujan en orden y con polygonOffset para que nunca se tapen entre sí
  // por falta de precisión de profundidad (z-fighting).
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(10000, 10000),
    new THREE.MeshLambertMaterial({ map: grassTex, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 })
  );
  ground.renderOrder = -1;
  ground.receiveShadow = true;
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(center.x, 0, center.z);
  group.add(ground);

  const half = track.roadWidth / 2;
  const roadTex = asphaltTexture(pal.road);
  const road = new THREE.Mesh(
    ribbonGeometry(track, -half, half, { y: 0.05, vScale: 34 }),
    new THREE.MeshPhongMaterial({ map: roadTex, specular: '#000000', shininess: 45, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
  );
  road.receiveShadow = true;
  roadMaterial = road.material;
  group.add(road);

  const curbMat = new THREE.MeshLambertMaterial({ map: stripeTexture('#d7262e', '#f4f4f4') });
  group.add(
    new THREE.Mesh(ribbonGeometry(track, -half - CURB_WIDTH, -half, { y: 0.08, vScale: 9 }), curbMat),
    new THREE.Mesh(ribbonGeometry(track, half, half + CURB_WIDTH, { y: 0.08, vScale: 9 }), curbMat)
  );

  const wallMat = new THREE.MeshLambertMaterial({ map: stripeTexture(pal.accent, '#f4f4f4'), side: THREE.DoubleSide });
  group.add(
    new THREE.Mesh(ribbonGeometry(track, -half - CURB_WIDTH, 0, { wallHeight: WALL_HEIGHT, vScale: 6 }), wallMat),
    new THREE.Mesh(ribbonGeometry(track, half + CURB_WIDTH, 0, { wallHeight: WALL_HEIGHT, vScale: 6 }), wallMat)
  );

  group.add(buildStartArch(track, pal));
  group.add(buildTeamBanners(track));
  puddleGroup = new THREE.Group();
  group.add(puddleGroup);
  group.add(buildCheckpointGates(track, pal));
  group.add(buildTrees(track, rand));
  group.add(buildMountains(track, pal, horizon, rand));
  // Semilla propia: agregar elementos regionales no mueve árboles, montañas ni nubes.
  const regionalProps = buildRegionalProps(track, seededRandom(`${track.id}-props`));
  if (regionalProps) group.add(regionalProps);
  if (!look.isDay) group.add(buildFloodlights(track));
  atmosphere = buildAtmosphere(track, look, rand);
  group.add(atmosphere.group);
  return group;
}

function setTrack(track, weather) {
  if (!renderer) return;
  currentWeather = weather || null;
  currentLook = weatherLook(weather);
  if (trackGroup) {
    scene.remove(trackGroup);
    disposeGroup(trackGroup);
  }
  if (skyMesh) {
    scene.remove(skyMesh);
    disposeGroup(skyMesh);
  }
  vehicles.forEach(v => {
    scene.remove(v.group);
    disposeGroup(v.group);
  });
  vehicles.clear();
  pickupModels.forEach(m => {
    scene.remove(m);
    disposeGroup(m);
  });
  pickupModels.clear();
  clearPickupBursts();
  puddleMeshes.clear();
  wetness = 0;
  snapshots = [];
  cam.initialized = false;
  cam.prevSelfAngle = null;
  camera.userData.snapped = false;

  currentTrack = track;
  trackGroup = buildTrack(track);
  buildMinimap(track);
  scene.add(trackGroup);
}

// ---------- Vehículos y objetos ----------

// Modelos low-poly para los vehículos que aún no tienen vista trasera. Se
// construyen mirando hacia +x (igual que los sprites cenitales), así la
// rotación según el ángulo del servidor es la misma: rotation.y = -ángulo.
const modelMaterials = new Map();
function mat(color) {
  if (!modelMaterials.has(color)) {
    const material = new THREE.MeshLambertMaterial({ color, flatShading: true });
    material.userData.shared = true; // lo usan varios modelos: disposeGroup no lo destruye
    modelMaterials.set(color, material);
  }
  return modelMaterials.get(color);
}

function box(group, color, [l, h, w], [x, y, z]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(l, h, w), mat(color));
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

function wheels(group, positions, radius = 1.8, width = 1.4) {
  const geometry = new THREE.CylinderGeometry(radius, radius, width, 12);
  geometry.rotateX(Math.PI / 2);
  positions.forEach(([x, z]) => {
    const wheel = new THREE.Mesh(geometry, mat('#151515'));
    wheel.position.set(x, radius, z);
    group.add(wheel);
  });
}

// ---------- Avión de Avianca ----------
// Modelado a partir del diseño del equipo (img/kart-avion-avianca.png vista
// cenital y AvionVistaTrasera.png): fuselaje blanco, alas en flecha grises
// con winglets rojos, turbinas rojas, cola roja con el chevrón blanco y el
// logo "avianca" recortado directamente del sprite original.
const AVIANCA_RED = '#d6121f';
const AVIANCA_WHITE = '#eceef1';
const AVIANCA_WING = '#c9ccd1';
const AVIANCA_SPRITE = 'img/kart-avion-avianca.png';
const AVIANCA_LOGO_CROP = [1160, 394, 346, 84]; // x, y, ancho, alto dentro del sprite

// Logo recortado del sprite con el fondo blanco del fuselaje vuelto
// transparente, para que no se vea como un recuadro pegado.
let aviancaLogo = null;
function loadAviancaLogo(onReady) {
  if (aviancaLogo) return aviancaLogo.ready ? onReady(aviancaLogo.canvas) : aviancaLogo.waiting.push(onReady);
  aviancaLogo = { ready: false, canvas: document.createElement('canvas'), waiting: [onReady] };
  const img = new Image();
  img.onload = () => {
    const [sx, sy, sw, sh] = AVIANCA_LOGO_CROP;
    const c = aviancaLogo.canvas;
    c.width = sw;
    c.height = sh;
    const g = c.getContext('2d');
    g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const data = g.getImageData(0, 0, sw, sh);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const [r, gr, b] = [px[i], px[i + 1], px[i + 2]];
      const grayish = Math.max(r, gr, b) - Math.min(r, gr, b) < 40;
      if (grayish && r > 150) px[i + 3] = 0;
    }
    g.putImageData(data, 0, 0);
    aviancaLogo.ready = true;
    aviancaLogo.waiting.forEach(cb => cb(c));
  };
  img.src = AVIANCA_SPRITE;
}

// Costado del fuselaje: ventanillas, puertas y el logo del diseño original.
// `noseOnLeft`: en el costado izquierdo la nariz queda a la izquierda de la
// textura, así el logo va siempre adelante y se lee normal en ambos lados.
const aviancaSideTextures = {};
function aviancaSide(noseOnLeft) {
  if (aviancaSideTextures[noseOnLeft]) return aviancaSideTextures[noseOnLeft];
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const g = c.getContext('2d');
  // Coordenada x medida desde la cola, se refleja si la nariz va a la izquierda.
  const fx = (x, w = 0) => (noseOnLeft ? c.width - x - w : x);
  const texture = new THREE.CanvasTexture(c);
  const draw = logo => {
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#1d2733';
    for (let x = 120; x < 700; x += 17) g.fillRect(fx(x, 9), 58, 9, 13);   // ventanillas
    g.strokeStyle = 'rgba(40,50,60,0.6)';
    g.lineWidth = 3;
    [90, 450, 720].forEach(x => g.strokeRect(fx(x, 18), 40, 18, 52));      // puertas
    if (logo) {
      const dh = 66;
      const dw = (logo.width * dh) / logo.height;
      g.drawImage(logo, fx(c.width - 40 - dw, dw), 26, dw, dh);
    }
    texture.needsUpdate = true;
  };
  draw(null);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.userData.shared = true;
  loadAviancaLogo(draw);
  aviancaSideTextures[noseOnLeft] = texture;
  return texture;
}

let aviancaFinTexture = null;
// Chevrón blanco de la cola (como en la vista trasera del diseño).
function aviancaFin() {
  if (aviancaFinTexture) return aviancaFinTexture;
  aviancaFinTexture = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = AVIANCA_RED;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(w * 0.5, h * 0.22);
    g.lineTo(w * 0.78, h * 0.78);
    g.lineTo(w * 0.62, h * 0.78);
    g.lineTo(w * 0.5, h * 0.5);
    g.lineTo(w * 0.38, h * 0.78);
    g.lineTo(w * 0.22, h * 0.78);
    g.closePath();
    g.fill();
  });
  aviancaFinTexture.userData.shared = true;
  return aviancaFinTexture;
}

/** Placa plana (alas, estabilizadores, deriva) a partir de un contorno 2D. */
function planform(points, thickness, color) {
  const shape = new THREE.Shape(points.map(([a, b]) => new THREE.Vector2(a, b)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geometry.translate(0, 0, -thickness / 2);
  return new THREE.Mesh(geometry, typeof color === 'string' ? mat(color) : color);
}

function buildAviancaPlane(model) {
  const R = 2.7;                 // radio del fuselaje
  const Y = 5.2;                 // altura del eje del fuselaje (sobre el tren de aterrizaje)
  const smooth = color => new THREE.MeshLambertMaterial({ color });

  // Fuselaje: cilindro + nariz elipsoidal + cono de cola rojo.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 26, 20).rotateZ(Math.PI / 2), smooth(AVIANCA_WHITE));
  body.position.set(1, Y, 0);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(R, 20, 14), smooth(AVIANCA_WHITE));
  nose.scale.set(2.1, 1, 1);
  nose.position.set(14, Y, 0);
  // Parabrisas: franja oscura que sigue la curva de la nariz.
  const cockpit = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.86, R * 0.86, 1.6, 20, 1, true, -Math.PI * 0.32, Math.PI * 0.64).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: '#1d2733', side: THREE.DoubleSide })
  );
  cockpit.position.set(17.2, Y, 0);
  cockpit.rotation.z = -0.34; // pendiente de la nariz en ese punto
  const tail = new THREE.Mesh(new THREE.ConeGeometry(R, 9, 20).rotateZ(Math.PI / 2), smooth(AVIANCA_RED));
  tail.scale.set(1, 0.85, 1);
  tail.position.set(-16.5, Y + 0.45, 0);
  const tailBand = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.005, R * 1.005, 4, 20).rotateZ(Math.PI / 2), smooth(AVIANCA_RED));
  tailBand.position.set(-10, Y, 0);
  model.add(body, nose, cockpit, tail, tailBand);

  // Costados: ventanillas y logo "avianca" del diseño original.
  [1, -1].forEach(side => {
    const sideMat = new THREE.MeshLambertMaterial({ map: aviancaSide(side < 0), transparent: true, depthWrite: false });
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(24, 3), sideMat);
    decal.position.set(2, Y + 0.4, side * (R + 0.03));
    if (side < 0) decal.rotation.y = Math.PI;
    model.add(decal);
  });

  // Alas en flecha con winglets rojos (contorno: x hacia adelante, y hacia la punta).
  const wingShape = [[4, 0], [-4, 0], [-11, 17], [-8.2, 17]];
  [1, -1].forEach(side => {
    const wing = planform(wingShape.map(([x, y]) => [x, y * side]), 0.6, AVIANCA_WING);
    wing.rotation.x = Math.PI / 2;
    wing.rotation.order = 'XYZ';
    wing.position.set(0, Y - 1.4, side * R * 0.6);
    // Diedro: las alas suben levemente hacia la punta.
    const holder = new THREE.Group();
    holder.rotation.x = side * -0.06;
    holder.add(wing);
    model.add(holder);

    const winglet = planform([[0, 0], [-2.4, 0], [-3.2, 2.6], [-2.1, 2.6]], 0.35, AVIANCA_RED);
    winglet.position.set(-8, Y - 1.4 + 0.4, side * (17 + R * 0.6));
    winglet.rotation.x = side * -0.25;
    holder.add(winglet);

    // Turbina roja colgada del ala, con toma oscura adelante y escape gris atrás.
    const engine = new THREE.Group();
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.2, 5.5, 16).rotateZ(Math.PI / 2), smooth('#e8333a'));
    const intake = new THREE.Mesh(new THREE.CircleGeometry(1.25, 16).rotateY(Math.PI / 2), mat('#202326'));
    intake.position.x = 2.76;
    const exhaust = new THREE.Mesh(new THREE.CircleGeometry(0.95, 16).rotateY(-Math.PI / 2), mat('#5b6168'));
    exhaust.position.x = -2.76;
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.4, 0.5), mat(AVIANCA_WING));
    pylon.position.set(-0.6, 1.4, 0);
    engine.add(nacelle, intake, exhaust, pylon);
    engine.position.set(0.2, Y - 3.2, side * 7.2);
    holder.add(engine);

    // Luces de navegación: roja a la izquierda, verde a la derecha.
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: side > 0 ? '#2bff6a' : '#ff2a2a' }));
    nav.position.set(-9.6, Y - 1.1, side * (17 + R * 0.6));
    holder.add(nav);
  });

  // Estabilizadores horizontales.
  const stabShape = [[-12.5, 0], [-16.5, 0], [-19.5, 7], [-17.8, 7]];
  [1, -1].forEach(side => {
    const stab = planform(stabShape.map(([x, y]) => [x, y * side]), 0.4, AVIANCA_WING);
    stab.rotation.x = Math.PI / 2;
    stab.position.set(0, Y + 0.8, side * R * 0.5);
    model.add(stab);
  });

  // Deriva (cola vertical) roja con el chevrón blanco a ambos lados.
  const finMaterials = [new THREE.MeshLambertMaterial({ map: aviancaFin() }), mat(AVIANCA_RED)];
  const fin = planform([[-11, 0], [-17.5, 0], [-20.2, 10.5], [-17.3, 10.5]], 0.6, finMaterials);
  // ExtrudeGeometry: grupo 0 = caras frontal/trasera (con textura), grupo 1 = bordes.
  const finUV = fin.geometry.attributes.uv;
  for (let i = 0; i < finUV.count; i++) {
    finUV.setXY(i, (finUV.getX(i) + 20.2) / 9.2, finUV.getY(i) / 10.5);
  }
  fin.position.set(0, Y + R * 0.75, 0);
  model.add(fin);
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  strobe.position.set(-19.9, Y + R * 0.75 + 10.4, 0);
  model.add(strobe);

  // Tren de aterrizaje.
  const gear = (x, z) => {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 2.6, 6), mat('#9aa0a6'));
    strut.position.set(x, 2.3, z);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.9, 12).rotateX(Math.PI / 2), mat('#151515'));
    wheel.position.set(x, 1, z);
    model.add(strut, wheel);
  };
  gear(11.5, 0);
  gear(-2.5, 2.4);
  gear(-2.5, -2.4);

  return 16; // altura hasta la punta de la cola
}

// Luces traseras (siempre encendidas: son lo que más se ve desde la cámara).
function taillights(group, x, y, z) {
  const light = new THREE.MeshBasicMaterial({ color: '#ff2a2a' });
  [z, -z].forEach(side => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 2), light);
    mesh.position.set(x, y, side);
    group.add(mesh);
  });
}

function buildVehicleModel(color) {
  const model = new THREE.Group();
  model.rotation.order = 'YXZ'; // girar (y) y luego balancear sobre su propio eje
  const glass = '#1d2733';
  let height;
  let bank = 0.35; // cuánto se inclina al girar (el avión se ladea más)
  switch (color) {
    case '#CE1126': { // Bus de TransMilenio
      box(model, '#c8102e', [32, 8, 9.5], [0, 6, 0]);
      box(model, glass, [27, 2.6, 9.7], [-1.5, 7.6, 0]);
      box(model, glass, [0.3, 3.4, 8], [16, 7.2, 0]);           // parabrisas
      box(model, '#f4f4f4', [32, 0.6, 9], [0, 10.3, 0]);        // techo
      box(model, '#f4f4f4', [32, 0.5, 9.8], [0, 4.4, 0]);       // franja
      box(model, '#7a0a1c', [0.6, 8, 9.6], [0, 6, 0]);          // articulación
      box(model, glass, [0.3, 3, 8], [-16.1, 7.4, 0]);          // vidrio trasero
      taillights(model, -16.15, 3.4, 3.6);
      wheels(model, [[11, 4.6], [11, -4.6], [-2, 4.6], [-2, -4.6], [-11, 4.6], [-11, -4.6]]);
      height = 11;
      break;
    }
    case '#FCD116': { // Taxi
      box(model, '#f6c50e', [20, 3.6, 9.5], [0, 3.2, 0]);
      box(model, '#f6c50e', [10, 3.4, 8.6], [-1.5, 6.6, 0]);
      box(model, glass, [10.2, 2.2, 8.8], [-1.5, 6.8, 0]);
      box(model, '#f6c50e', [10.4, 0.6, 8.6], [-1.5, 8.5, 0]);
      box(model, '#111111', [3, 1.2, 3.6], [-1.5, 9.4, 0]);       // aviso TAXI
      box(model, '#fff6d0', [0.3, 1, 2], [10, 3.6, 3]);           // farolas
      box(model, '#fff6d0', [0.3, 1, 2], [10, 3.6, -3]);
      box(model, glass, [0.3, 2, 7.6], [-6.6, 6.8, 0]);           // vidrio trasero
      taillights(model, -10.1, 3.6, 3.4);
      wheels(model, [[6.5, 4.6], [6.5, -4.6], [-6.5, 4.6], [-6.5, -4.6]], 1.7);
      height = 10;
      break;
    }
    case '#2ECC71': { // Metro de Medellín
      box(model, '#e9eef2', [36, 9, 9.5], [0, 6.2, 0]);
      box(model, '#1f8f4e', [36, 1.6, 9.7], [0, 3.6, 0]);
      box(model, glass, [32, 2.8, 9.7], [-1, 7.6, 0]);
      box(model, glass, [0.3, 4, 8], [18, 7.4, 0]);
      box(model, '#1f8f4e', [0.6, 9, 9.6], [0, 6.2, 0]);
      box(model, '#9aa3ab', [36, 0.6, 7], [0, 11, 0]);
      box(model, glass, [0.3, 4, 8], [-18.1, 7.4, 0]);
      taillights(model, -18.15, 3.6, 3.4);
      wheels(model, [[13, 4.2], [13, -4.2], [-13, 4.2], [-13, -4.2]], 1.6, 1);
      height = 12;
      break;
    }
    case '#95A5A6': { // Burro
      const fur = '#7d6a5a';
      box(model, fur, [13, 6, 6], [0, 9, 0]);
      [[4.5, 2], [4.5, -2], [-4.5, 2], [-4.5, -2]].forEach(([x, z]) => box(model, '#5c4d41', [1.6, 6.5, 1.6], [x, 3.2, z]));
      const neck = box(model, fur, [3, 6, 3], [7.3, 12, 0]);
      neck.rotation.z = -0.6;
      box(model, fur, [5, 3, 3.2], [10, 14.2, 0]);
      box(model, '#4a3d33', [1.6, 1.8, 2.6], [12.6, 13.6, 0]);    // hocico
      box(model, fur, [0.8, 3, 0.8], [8.6, 17, 1]);               // orejas
      box(model, fur, [0.8, 3, 0.8], [8.6, 17, -1]);
      const tail = box(model, '#4a3d33', [0.7, 4, 0.7], [-7, 9, 0]);
      tail.rotation.z = 0.5;
      box(model, '#c0392b', [6, 0.8, 6.4], [-0.5, 12.3, 0]);       // montura
      height = 18;
      break;
    }
    case '#ECF0F1': { // Avión de Avianca
      height = buildAviancaPlane(model);
      bank = 1;
      break;
    }
    default: { // Kart genérico
      box(model, color, [16, 3, 9], [0, 2.8, 0]);
      box(model, '#222222', [5, 3, 5], [-2, 5.5, 0]);
      wheels(model, [[5, 4.8], [5, -4.8], [-5, 4.8], [-5, -4.8]], 1.6);
      height = 8;
    }
  }
  // Largo real del modelo: la cámara se aleja más detrás de los vehículos largos.
  const length = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).x;
  return { model, height, length, bank };
}

function createVehicle(p, isSelf) {
  const group = new THREE.Group();
  const color = vehicleColorFor(p);
  const rear = REAR_VEHICLE_IMAGES[color];
  const vehicle = { group, color, rear: !!rear, height: 8, length: 0, body: null, label: null, glow: null };

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 20),
    new THREE.MeshBasicMaterial({ map: glowTexture, color: '#000000', transparent: true, opacity: 0.45, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.12;
  shadow.scale.set(VEHICLE_WIDTH * 0.42, VEHICLE_WIDTH * 0.3, 1);
  group.add(shadow);

  if (rear) {
    // Vista trasera como sprite: siempre mira a la cámara, anclado abajo.
    const material = new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.2 });
    const sprite = new THREE.Sprite(material);
    sprite.center.set(0.5, 0);
    sprite.visible = false;
    loadTexture(rear.src, tex => {
      const [sx, sy, sw, sh] = rear.crop;
      const w = tex.image.width;
      const h = tex.image.height;
      const map = tex.clone();
      map.userData = {};
      map.repeat.set(sw / w, sh / h);
      map.offset.set(sx / w, 1 - (sy + sh) / h);
      map.needsUpdate = true;
      material.map = map;
      material.needsUpdate = true;
      const height = VEHICLE_WIDTH * (sh / sw);
      sprite.scale.set(VEHICLE_WIDTH, height, 1);
      vehicle.height = height;
      sprite.visible = true;
    });
    vehicle.body = sprite;
    group.add(sprite);
  } else {
    // Sin vista trasera: modelo 3D low-poly del vehículo.
    const { model, height, length, bank } = buildVehicleModel(color);
    vehicle.body = model;
    vehicle.height = height;
    vehicle.length = length;
    vehicle.bank = bank;
    group.add(model);
  }

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color: '#FCD116', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8
  }));
  glow.scale.set(VEHICLE_WIDTH * 1.2, VEHICLE_WIDTH * 0.7, 1);
  glow.position.y = 4;
  glow.visible = false;
  vehicle.glow = glow;
  group.add(glow);

  if (!isSelf) {
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(p.isBot ? `🤖 ${p.name}` : p.name), transparent: true, depthWrite: false }));
    label.scale.set(16, 4, 1);
    label.center.set(0.5, 0);
    vehicle.label = label;
    group.add(label);
  }

  group.traverse(obj => {
    if (obj.isMesh) obj.castShadow = true;
  });
  scene.add(group);
  return vehicle;
}

function updateVehicle(v, p, isSelf, time) {
  v.group.position.set(p.x, 0, p.y);
  if (v.rear) {
    const bounce = Math.sin(time / 45) * 0.12 * Math.min(1, Math.abs(p.speed) / MAX_SPEED);
    v.body.position.y = 0.3 + bounce;
    v.body.material.rotation = isSelf ? cam.tilt : 0;
  } else {
    v.body.rotation.y = -p.angle;
    // Pequeño rebote al andar y balanceo al girar (solo el propio).
    v.body.position.y = Math.abs(Math.sin(time / 70)) * 0.25 * Math.min(1, Math.abs(p.speed) / MAX_SPEED);
    v.body.rotation.x = isSelf ? -cam.tilt * v.bank : 0;
  }
  v.glow.visible = !!p.boosted;
  if (v.glow.visible) v.glow.material.opacity = 0.55 + Math.sin(time / 60) * 0.25;
  if (v.label) {
    v.label.position.y = v.height + 3;
    // Un rival pegado a la cámara taparía media pantalla con su nombre.
    v.label.visible = camera.position.distanceTo(v.group.position) > 45;
  }
}

// ---------- Objetos recogibles en 3D ----------
// Cada objeto de la cocina colombiana tiene su propio modelo low-poly (mismo
// estilo flatShading que los vehículos), flota y gira sobre un aro de luz
// del color del objeto para que se vea de lejos.
const PICKUP_GLOW = {
  tinto: '#ffb347', arepa: '#ffe08a', aguapanela: '#ffc35c',
  lechona: '#ff8a65', tamal: '#8be07a', bunuelo: '#ffd25e'
};

function pickupPart(group, geometry, color, [x, y, z] = [0, 0, 0], [rx, ry, rz] = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, mat(color));
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  group.add(mesh);
  return mesh;
}

function buildPickupModel(kind) {
  const item = new THREE.Group();
  switch (kind) {
    case 'tinto': { // pocillo de tinto sobre su plato
      pickupPart(item, new THREE.CylinderGeometry(3.2, 3.2, 0.4, 16), '#f4efe6', [0, 0.2, 0]);
      pickupPart(item, new THREE.CylinderGeometry(2.2, 1.6, 3.4, 14), '#f7f3ec', [0, 2.1, 0]);
      pickupPart(item, new THREE.CylinderGeometry(2.0, 2.0, 0.2, 14), '#3b2010', [0, 3.6, 0]);
      pickupPart(item, new THREE.TorusGeometry(0.9, 0.3, 6, 12), '#f7f3ec', [2.4, 2.2, 0]);
      break;
    }
    case 'arepa': { // arepa asada de pie, con marcas de parrilla
      pickupPart(item, new THREE.CylinderGeometry(3.2, 3.2, 1.2, 14), '#e8c37a', [0, 3.2, 0], [Math.PI / 2, 0, 0]);
      for (const dy of [-1.2, 0, 1.2]) {
        pickupPart(item, new THREE.BoxGeometry(4.6, 0.35, 0.2), '#8a5a22', [0, 3.2 + dy, 0.65]);
        pickupPart(item, new THREE.BoxGeometry(4.6, 0.35, 0.2), '#8a5a22', [0, 3.2 + dy, -0.65]);
      }
      break;
    }
    case 'aguapanela': { // vaso de aguapanela con limón
      const glass = new THREE.Mesh(
        new THREE.CylinderGeometry(1.9, 1.5, 4.6, 14),
        new THREE.MeshLambertMaterial({ color: '#e6f4ff', transparent: true, opacity: 0.35, depthWrite: false })
      );
      glass.position.y = 2.3;
      item.add(glass);
      pickupPart(item, new THREE.CylinderGeometry(1.75, 1.45, 3.6, 14), '#c4782a', [0, 1.9, 0]);
      pickupPart(item, new THREE.CylinderGeometry(1.1, 1.1, 0.3, 10), '#b6d93b', [1.7, 4.5, 0], [0, 0, Math.PI / 2.4]);
      break;
    }
    case 'lechona': { // lechoncito tolimense
      const body = pickupPart(item, new THREE.IcosahedronGeometry(2.4, 1), '#c9763d', [0, 3, 0]);
      body.scale.set(1.45, 1, 1);
      pickupPart(item, new THREE.CylinderGeometry(0.8, 0.9, 1, 10), '#e09a6b', [3.6, 3, 0], [0, 0, Math.PI / 2]);
      pickupPart(item, new THREE.ConeGeometry(0.6, 1.3, 4), '#a65a2a', [2.2, 5.2, 1]);
      pickupPart(item, new THREE.ConeGeometry(0.6, 1.3, 4), '#a65a2a', [2.2, 5.2, -1]);
      for (const [x, z] of [[1.8, 1.2], [1.8, -1.2], [-1.8, 1.2], [-1.8, -1.2]]) {
        pickupPart(item, new THREE.CylinderGeometry(0.45, 0.45, 1.4, 6), '#a65a2a', [x, 0.9, z]);
      }
      break;
    }
    case 'tamal': { // tamal envuelto en hoja de plátano y amarrado
      pickupPart(item, new THREE.BoxGeometry(5, 2.6, 4), '#3f7d2c', [0, 1.6, 0]);
      pickupPart(item, new THREE.BoxGeometry(4.2, 0.4, 3.2), '#5b9e3c', [0, 3.05, 0]);
      pickupPart(item, new THREE.BoxGeometry(0.35, 2.8, 4.2), '#e7d7a8', [1.2, 1.6, 0]);
      pickupPart(item, new THREE.BoxGeometry(0.35, 2.8, 4.2), '#e7d7a8', [-1.2, 1.6, 0]);
      pickupPart(item, new THREE.BoxGeometry(5.2, 2.8, 0.35), '#e7d7a8', [0, 1.6, 0]);
      break;
    }
    case 'bunuelo': { // buñuelo dorado
      pickupPart(item, new THREE.IcosahedronGeometry(2.6, 1), '#d99a3c', [0, 2.8, 0]);
      pickupPart(item, new THREE.IcosahedronGeometry(1.1, 0), '#e8b25a', [1.2, 4.4, 0.8]);
      break;
    }
    default: { // objeto desconocido: estrella dorada
      pickupPart(item, new THREE.OctahedronGeometry(2.6, 0), '#FCD116', [0, 3, 0]);
    }
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.6, 4.6, 24),
    new THREE.MeshBasicMaterial({ color: PICKUP_GLOW[kind] || '#FCD116', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.3;

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: PICKUP_GLOW[kind] || '#FCD116', transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.set(14, 14, 1);
  glow.position.y = 5;

  const group = new THREE.Group();
  group.add(ring, glow, item);
  group.userData = { item, ring, phase: Math.random() * Math.PI * 2, color: PICKUP_GLOW[kind] || '#FCD116', available: true, appearedAt: 0 };
  return group;
}

// Destello al recoger un objeto: un brillo de su color que se expande y se
// desvanece en medio segundo.
const PICKUP_BURST_MS = 450;
const PICKUP_APPEAR_MS = 350;
const pickupBursts = [];

function spawnPickupBurst(position, color, time) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  sprite.position.set(position.x, 5, position.z);
  scene.add(sprite);
  pickupBursts.push({ sprite, born: time });
}

function updatePickupBursts(time) {
  for (let i = pickupBursts.length - 1; i >= 0; i--) {
    const { sprite, born } = pickupBursts[i];
    const t = (time - born) / PICKUP_BURST_MS;
    if (t >= 1) {
      scene.remove(sprite);
      sprite.material.dispose();
      pickupBursts.splice(i, 1);
      continue;
    }
    const size = 8 + t * 30;
    sprite.scale.set(size, size, 1);
    sprite.material.opacity = 0.9 * (1 - t);
  }
}

function clearPickupBursts() {
  pickupBursts.forEach(({ sprite }) => {
    scene.remove(sprite);
    sprite.material.dispose();
  });
  pickupBursts.length = 0;
}

function updatePickups(pickups, time) {
  const seen = new Set();
  pickups.forEach(pu => {
    seen.add(pu.id);
    let model = pickupModels.get(pu.id);
    if (!model) {
      model = buildPickupModel(pu.kind);
      model.position.set(pu.x, 0, pu.y);
      model.userData.available = !!pu.available; // sin destello al aparecer ya recogido
      pickupModels.set(pu.id, model);
      scene.add(model);
    }
    const data = model.userData;
    const available = !!pu.available;
    if (data.available && !available) spawnPickupBurst(model.position, data.color, time);
    if (!data.available && available) data.appearedAt = time; // reaparece creciendo
    data.available = available;
    model.visible = available;

    const grow = Math.min(1, (time - data.appearedAt) / PICKUP_APPEAR_MS);
    const scale = 1 - (1 - grow) ** 3; // ease-out
    model.scale.setScalar(Math.max(scale, 0.001));
    data.item.position.y = 2 + Math.sin(time / 300 + data.phase) * 1;
    data.item.rotation.y = time / 700 + data.phase;
    data.ring.material.opacity = 0.5 + Math.sin(time / 220 + data.phase) * 0.2;
  });
  pickupModels.forEach((model, id) => { if (!seen.has(id)) model.visible = false; });
  updatePickupBursts(time);
}

// ---------- Lluvia ----------

function ensureRain() {
  if (rain) return rain;
  const count = 900;
  const positions = new Float32Array(count * 6);
  const drops = Array.from({ length: count }, () => ({ x: (Math.random() - 0.5) * 300, y: Math.random() * 90, z: (Math.random() - 0.5) * 300, speed: 90 + Math.random() * 60 }));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#b4d2ff', transparent: true, opacity: 0.55 }));
  lines.frustumCulled = false;
  scene.add(lines);
  rain = { lines, drops, positions };
  return rain;
}

function updateRain(intensity, dt) {
  if (!intensity) {
    if (rain) rain.lines.visible = false;
    return;
  }
  const r = ensureRain();
  r.lines.visible = true;
  r.lines.geometry.setDrawRange(0, Math.round(r.drops.length * Math.min(1, intensity)) * 2);
  const origin = camera.position;
  r.drops.forEach((d, i) => {
    d.y -= d.speed * dt;
    if (d.y < 0) {
      d.y = 90;
      d.x = (Math.random() - 0.5) * 300;
      d.z = (Math.random() - 0.5) * 300;
    }
    const x = origin.x + d.x;
    const z = origin.z + d.z;
    r.positions.set([x, d.y, z, x - 0.6, d.y + 3.5, z], i * 6);
  });
  r.lines.geometry.attributes.position.needsUpdate = true;
}

// ---------- Pista mojada, charcos y salpicaduras ----------
// El servidor decide dónde hay charcos y cuánta agua tienen (aquaplaning);
// aquí solo se dibujan: asfalto oscuro y brillante cuando llueve, charcos que
// reflejan la luz con ondas de lluvia, y agua que levantan los vehículos.

let rippleTex = null;
function rippleTexture() {
  if (rippleTex) return rippleTex;
  rippleTex = canvasTexture(256, 256, (g, w, h) => {
    const rand = seededRandom('ondas');
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 18; i++) {
      g.lineWidth = 1 + rand() * 1.5;
      g.beginPath();
      g.arc(30 + rand() * (w - 60), 30 + rand() * (h - 60), 5 + rand() * 22, 0, Math.PI * 2);
      g.stroke();
    }
  });
  rippleTex.userData.shared = true;
  return rippleTex;
}

function createPuddleMesh() {
  const geometry = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({
    color: '#4c6075', specular: '#dbe9ff', shininess: 120, transparent: true, opacity: 0.8,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
  }));
  const ripples = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    map: rippleTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
  }));
  ripples.position.y = 0.02;
  const holder = new THREE.Group();
  holder.add(water, ripples);
  holder.userData.ripples = ripples;
  return holder;
}

function updatePuddles(puddles, raining, dt) {
  const seen = new Set();
  puddles.forEach(pd => {
    seen.add(pd.id);
    let mesh = puddleMeshes.get(pd.id);
    if (!mesh) {
      mesh = createPuddleMesh();
      mesh.position.set(pd.x, 0.14, pd.y);
      mesh.rotation.y = -pd.angle;
      puddleMeshes.set(pd.id, mesh);
      puddleGroup.add(mesh);
    }
    // El nivel llega a 20 Hz: se suaviza para que el charco crezca sin saltos.
    const level = (mesh.userData.level ?? 0) + (pd.level - (mesh.userData.level ?? 0)) * Math.min(1, dt * 6);
    mesh.userData.level = level;
    mesh.visible = level > 0.02;
    mesh.scale.set(pd.radius * pd.stretch * level, 1, pd.radius * level);
    const ripples = mesh.userData.ripples;
    ripples.material.opacity += ((raining ? 0.6 : 0) - ripples.material.opacity) * Math.min(1, dt * 2);
    ripples.rotation.y += dt * 0.9;
  });
  puddleMeshes.forEach((mesh, id) => {
    if (!seen.has(id)) mesh.visible = false;
  });
}

// Salpicaduras: un grupo fijo de sprites que se reciclan.
const SPRAY_SIZE = 90;
const spray = { items: [], next: 0 };
function sprayPool() {
  if (spray.items.length) return spray.items;
  for (let i = 0; i < SPRAY_SIZE; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: '#e3eef8', transparent: true, depthWrite: false, opacity: 0 }));
    sprite.visible = false;
    scene.add(sprite);
    spray.items.push({ sprite, life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, size: 1 });
  }
  return spray.items;
}

function emitSpray(p, strength) {
  const items = sprayPool();
  const back = -Math.cos(p.angle);
  const backZ = -Math.sin(p.angle);
  const item = items[spray.next];
  spray.next = (spray.next + 1) % items.length;
  const side = (Math.random() - 0.5) * 10;
  item.sprite.position.set(p.x + back * 9 - backZ * side, 1.2, p.y + backZ * 9 + back * side);
  const speed = Math.abs(p.speed) * 6;
  item.vx = back * speed * (0.3 + Math.random() * 0.4) + (Math.random() - 0.5) * 8;
  item.vz = backZ * speed * (0.3 + Math.random() * 0.4) + (Math.random() - 0.5) * 8;
  item.vy = 6 + Math.random() * 10 * strength;
  item.maxLife = item.life = 0.35 + Math.random() * 0.35 * strength;
  item.size = 4 + strength * 6;
  item.sprite.visible = true;
}

function updateSpray(players, dt) {
  players.forEach(p => {
    const fast = Math.abs(p.speed) > 2;
    if (p.aquaplaning) {
      for (let k = 0; k < 3; k++) emitSpray(p, 1.6);
    } else if (fast && wetness > 0.4 && Math.random() < wetness * 0.7) {
      emitSpray(p, 0.6);
    }
  });
  spray.items.forEach(item => {
    if (item.life <= 0) return;
    item.life -= dt;
    if (item.life <= 0) {
      item.sprite.visible = false;
      return;
    }
    item.vy -= 30 * dt;
    item.sprite.position.x += item.vx * dt;
    item.sprite.position.y = Math.max(0.3, item.sprite.position.y + item.vy * dt);
    item.sprite.position.z += item.vz * dt;
    const t = item.life / item.maxLife;
    item.sprite.material.opacity = 0.55 * t;
    const size = item.size * (1.6 - t * 0.6);
    item.sprite.scale.set(size, size, 1);
  });
}

function updateWetTrack(state, dt) {
  const raining = !!state.rainActive;
  // Se moja rápido con la lluvia y se seca despacio.
  wetness += ((raining ? 1 : 0) - wetness) * (1 - Math.exp(-dt * (raining ? 0.9 : 0.25)));
  if (roadMaterial) {
    roadMaterial.color.setScalar(1 - 0.32 * wetness);
    roadMaterial.specular.setScalar(0.38 * wetness);
  }
  if (puddleGroup) updatePuddles(state.puddles || [], raining, dt);
  updateSpray(state.players, dt);
}

// ---------- Minimapa ----------
// Silueta de la pista con la posición de cada vehículo, para anticipar las
// curvas en la cámara 3D. La pista se pre-dibuja una vez por circuito.

const minimap = document.getElementById('minimap');
const minimapCtx = minimap.getContext('2d');
let minimapBase = null;
let minimapView = null;

function buildMinimap(track) {
  const b = track.bounds;
  const margin = 16;
  const scale = Math.min((minimap.width - margin * 2) / (b.maxX - b.minX), (minimap.height - margin * 2) / (b.maxY - b.minY));
  minimapView = {
    scale,
    x: minimap.width / 2 - ((b.minX + b.maxX) / 2) * scale,
    y: minimap.height / 2 - ((b.minY + b.maxY) / 2) * scale
  };
  minimapBase = document.createElement('canvas');
  minimapBase.width = minimap.width;
  minimapBase.height = minimap.height;
  const g = minimapBase.getContext('2d');
  g.setTransform(scale, 0, 0, scale, minimapView.x, minimapView.y);
  g.lineJoin = 'round';
  const trace = () => {
    g.beginPath();
    track.centerline.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  };
  trace();
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 9 / scale;
  g.stroke();
  trace();
  g.strokeStyle = '#2b313b';
  g.lineWidth = 5 / scale;
  g.stroke();
  const { x, y, angle } = track.startLine;
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.fillStyle = track.palette.accent;
  g.fillRect(-2 / scale, -7 / scale, 4 / scale, 14 / scale);
  g.restore();
}

function drawMinimap(players) {
  if (!minimapBase) return;
  minimapCtx.clearRect(0, 0, minimap.width, minimap.height);
  minimapCtx.drawImage(minimapBase, 0, 0);
  const { scale, x: ox, y: oy } = minimapView;
  // Primero los rivales y al final el propio, para que quede encima.
  [...players].sort((a, b) => (a.id === selfId) - (b.id === selfId)).forEach(p => {
    const isSelf = p.id === selfId;
    minimapCtx.beginPath();
    minimapCtx.arc(p.x * scale + ox, p.y * scale + oy, isSelf ? 6 : 4, 0, Math.PI * 2);
    minimapCtx.fillStyle = isSelf ? '#ffffff' : vehicleColorFor(p);
    minimapCtx.fill();
    minimapCtx.lineWidth = 2;
    minimapCtx.strokeStyle = isSelf ? '#d6121f' : 'rgba(0,0,0,0.6)';
    minimapCtx.stroke();
  });
}

// ---------- Interpolación y bucle de dibujo ----------

function sampleState(renderTime) {
  const n = snapshots.length;
  if (!n) return null;
  if (n === 1 || renderTime >= snapshots[n - 1].t) return snapshots[n - 1];
  for (let i = n - 1; i > 0; i--) {
    const a = snapshots[i - 1];
    const b = snapshots[i];
    if (renderTime >= a.t) {
      const k = (renderTime - a.t) / Math.max(1, b.t - a.t);
      const players = b.players.map(pb => {
        const pa = a.players.find(x => x.id === pb.id);
        if (!pa) return pb;
        return {
          ...pb,
          x: pa.x + (pb.x - pa.x) * k,
          y: pa.y + (pb.y - pa.y) * k,
          angle: pa.angle + angleDiff(pb.angle, pa.angle) * k,
          speed: pa.speed + (pb.speed - pa.speed) * k
        };
      });
      return { players, pickups: b.pickups, rainActive: b.rainActive, puddles: b.puddles };
    }
  }
  return snapshots[0];
}

function frame(now) {
  rafHandle = null;
  if (!isVisible()) return;
  rafHandle = requestAnimationFrame(frame);
  syncSize();

  const dt = Math.min(0.1, lastFrame ? (now - lastFrame) / 1000 : 0.016);
  lastFrame = now;
  const state = sampleState(now - INTERP_DELAY_MS);
  if (!state) return;
  const me = state.players.find(p => p.id === selfId);

  // Vehículos: crear/actualizar/quitar según el estado.
  const seen = new Set();
  state.players.forEach(p => {
    seen.add(p.id);
    let v = vehicles.get(p.id);
    if (!v) {
      v = createVehicle(p, p.id === selfId);
      vehicles.set(p.id, v);
    }
    updateVehicle(v, p, p.id === selfId, now);
  });
  vehicles.forEach((v, id) => {
    if (!seen.has(id)) {
      scene.remove(v.group);
      disposeGroup(v.group);
      vehicles.delete(id);
    }
  });
  updatePickups(state.pickups || [], now);

  if (me) {
    // Cámara de persecución suavizada.
    if (!cam.initialized) {
      cam.angle = me.angle;
      cam.initialized = true;
    }
    cam.angle += angleDiff(me.angle, cam.angle) * (1 - Math.exp(-dt * 7));
    const fx = Math.cos(cam.angle);
    const fz = Math.sin(cam.angle);
    const selfVehicle = vehicles.get(me.id);
    const back = CAM_BACK + (selfVehicle ? selfVehicle.length * 0.55 : 0);
    const height = CAM_HEIGHT + (selfVehicle ? selfVehicle.height * 0.45 : 0);
    const desired = new THREE.Vector3(me.x - fx * back, height, me.y - fz * back);
    if (camera.userData.snapped) camera.position.lerp(desired, 1 - Math.exp(-dt * 12));
    else {
      camera.position.copy(desired);
      camera.userData.snapped = true;
    }
    camera.lookAt(me.x + fx * LOOK_AHEAD, 3, me.y + fz * LOOK_AHEAD);

    // Inclinación al girar y FOV según velocidad: sensación de rapidez.
    if (cam.prevSelfAngle !== null && dt > 0) {
      const turnRate = angleDiff(me.angle, cam.prevSelfAngle) / dt;
      const target = Math.max(-0.3, Math.min(0.3, -turnRate * 0.12));
      cam.tilt += (target - cam.tilt) * (1 - Math.exp(-dt * 8));
    }
    cam.prevSelfAngle = me.angle;
    const speedRatio = Math.min(1.7, Math.abs(me.speed) / MAX_SPEED);
    const fov = baseFov + speedRatio * 7 + (me.boosted ? 5 : 0);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 5));
      camera.updateProjectionMatrix();
    }
  }

  if (skyMesh) skyMesh.position.copy(camera.position);
  const look = currentLook || weatherLook(null);
  if (scene.fog) {
    // El evento de lluvia de la carrera cierra la niebla sobre el clima real.
    const target = state.rainActive ? Math.min(look.fogFar, 320) : look.fogFar;
    scene.fog.far += (target - scene.fog.far) * (1 - Math.exp(-dt * 2));
  }
  updateRain(state.rainActive ? Math.max(1, look.rain) : look.rain, dt);
  updateAtmosphere(me, dt, now);
  updateWetTrack(state, dt);
  renderer.render(scene, camera);
  drawMinimap(state.players);
}

function isVisible() {
  return !canvas.hidden && document.getElementById('screen-race').classList.contains('active');
}

function update(players, id, pickups, rainActive, puddles = []) {
  if (!renderer) return;
  selfId = id;
  snapshots.push({ t: performance.now(), players, pickups, rainActive, puddles });
  if (snapshots.length > 4) snapshots.shift();
  if (!rafHandle && isVisible()) {
    lastFrame = 0;
    rafHandle = requestAnimationFrame(frame);
  }
}

window.Race3D = {
  supported: !!renderer,
  setTrack,
  update,
  get track() { return currentTrack; },
  get weather() { return currentWeather; }
};
window.dispatchEvent(new Event('race3d-ready'));
