import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { CLIENT_DIR } from './client/harness.js';
import { TRACKS } from '../src/game-engine/trackCatalog.js';

// Vista 3D (race3d.js) con Three.js real y un renderer falso: jsdom no tiene
// WebGL, pero toda la construcción de la escena (pista, vegetación,
// elementos regionales, vehículos, objetos, lluvia, charcos) y el bucle de
// dibujo sí se ejecutan y se verifican.

let dom;
let Race3D;
const renderer = { renders: 0, pixelRatio: null, shadowMap: {}, setPixelRatio(r) { this.pixelRatio = r; }, setSize() {}, render() { this.renders++; } };

function fakeContext2D(canvas) {
  const gradient = { addColorStop() {} };
  const base = {
    canvas,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: t => ({ width: String(t).length * 8 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
  };
  return new Proxy(base, {
    get: (obj, prop) => (prop in obj ? obj[prop] : () => {}),
    set: (obj, prop, value) => { obj[prop] = value; return true; }
  });
}

const tick = ms => new Promise(resolve => setTimeout(resolve, ms));

before(async () => {
  const html = fs.readFileSync(path.join(CLIENT_DIR, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  dom = new JSDOM(html, { url: 'http://localhost:3000/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!this.__ctx) this.__ctx = fakeContext2D(this);
    return this.__ctx;
  };
  window.__KARSWCOL_TEST_RENDERER__ = () => renderer;
  // race.js se carga antes que race3d.js en el navegador y le da estos globales.
  const ctx = dom.getInternalVMContext();
  const raceJs = path.join(CLIENT_DIR, 'js', 'race.js');
  vm.runInContext(fs.readFileSync(raceJs, 'utf8'), ctx, { filename: raceJs });
  const fromRace = vm.runInContext('({ vehicleColorFor, REAR_VEHICLE_IMAGES })', ctx);
  window.localStorage.setItem('karswcol.quality', 'media');
  // race3d.js es un módulo del navegador: usa estos globales directamente.
  Object.assign(globalThis, {
    ...fromRace,
    window,
    document: window.document,
    localStorage: window.localStorage,
    Event: window.Event,
    Image: window.Image,
    HTMLCanvasElement: window.HTMLCanvasElement,
    requestAnimationFrame: cb => window.requestAnimationFrame(cb),
    cancelAnimationFrame: id => window.cancelAnimationFrame(id)
  });
  let ready = false;
  window.addEventListener('race3d-ready', () => { ready = true; });
  await import(pathToFileURL(path.join(CLIENT_DIR, 'js', 'race3d.js')).href);
  Race3D = window.Race3D;
  assert.ok(ready, 'avisa que la vista 3D está lista');
  // Pantalla de carrera visible con el canvas 3D.
  window.document.getElementById('screen-race').classList.add('active');
  window.document.getElementById('race-canvas-3d').hidden = false;
});

after(() => dom.window.close());

const roundTrip = t => JSON.parse(JSON.stringify(t));

function kart(id, color, x, y, extra = {}) {
  return { id, name: `P${id}`, color, x, y, angle: 0.3, speed: 4, lap: 1, finished: false, boosted: false, skidding: false, aquaplaning: false, crashed: false, isBot: false, ...extra };
}

test('recupera la calidad guardada y permite cambiarla', () => {
  assert.equal(Race3D.supported, true);
  assert.equal(Race3D.qualityMode, 'media');
  assert.equal(Race3D.quality, 'media');
  assert.equal(renderer.pixelRatio, 1, 'media: 1.25 limitado por devicePixelRatio 1');
  Race3D.setQualityMode('baja');
  assert.equal(Race3D.quality, 'baja');
  assert.equal(dom.window.localStorage.getItem('karswcol.quality'), 'baja');
  Race3D.setQualityMode('ultra'); // no existe: se ignora
  assert.equal(Race3D.quality, 'baja');
  Race3D.setQualityMode('auto');
  assert.equal(Race3D.qualityMode, 'auto');
  assert.equal(Race3D.quality, 'alta');
});

const WEATHERS = [
  null,
  { condition: 'despejado', tempC: 31, isDay: true, city: 'Cartagena', source: 'real', cloudCover: 5 },
  { condition: 'nublado', tempC: 14, isDay: false, city: 'Bogotá', source: 'real', cloudCover: 90 },
  { condition: 'lluvia', tempC: 20, isDay: true, city: 'Manizales', source: 'real', windKmh: 20 },
  { condition: 'tormenta', tempC: 26, isDay: false, city: 'Villavicencio', source: 'real' },
  { condition: 'niebla', tempC: 9, isDay: true, city: 'Bogotá', source: 'real' },
  { condition: 'llovizna', tempC: 27, isDay: true, city: 'Leticia', source: 'tipico' },
  { condition: 'parcial', tempC: 22, isDay: false, city: 'Manizales', source: 'real' }
];

test('construye las cinco pistas con distintos climas, de día y de noche', () => {
  TRACKS.forEach((t, i) => {
    const weather = WEATHERS[i % WEATHERS.length];
    Race3D.setTrack(roundTrip(t), weather);
    assert.equal(Race3D.track.id, t.id);
    assert.equal(Race3D.weather, weather);
  });
  for (const weather of WEATHERS) Race3D.setTrack(roundTrip(TRACKS[0]), weather);
});

test('el bucle dibuja karts, objetos en 3D, lluvia y charcos', async () => {
  const track = roundTrip(TRACKS[3]);
  Race3D.setTrack(track, WEATHERS[3]);
  const { x, y } = track.startLine;
  const colors = ['#CE1126', '#FCD116', '#95A5A6', '#ECF0F1', '#2ECC71'];
  const pickups = ['tinto', 'arepa', 'aguapanela', 'lechona', 'tamal', 'bunuelo', 'otro']
    .map((kind, i) => ({ id: `p${i}`, x: x + 30 * i, y, available: true, kind }));
  const puddles = [{ x, y: y + 20, r: 18, depth: 0.8 }, { x: x + 40, y, r: 12, depth: 0.3 }];
  const before = renderer.renders;

  for (let step = 0; step < 12; step++) {
    const players = colors.map((c, i) => kart(String(i + 1), c, x + step * 6 + i * 10, y + i * 4, {
      skidding: step % 3 === 0,
      aquaplaning: step > 6,
      boosted: i === 0 && step > 3,
      crashed: i === 1 && step === 5,
      speed: i === 2 ? -2 : 4 + step * 0.3
    }));
    players.push(kart('bot-1', '#2ECC71', x - 40, y, { isBot: true }));
    // En la mitad alguien recoge dos objetos (destello) y luego reaparecen.
    const avail = pickups.map(p => ({ ...p, available: !(step >= 4 && step < 8 && (p.id === 'p1' || p.id === 'p4')) }));
    Race3D.update(players, '1', avail, step > 2, step > 2 ? puddles : []);
    await tick(20);
  }
  // Un kart se va: su modelo se quita.
  Race3D.update([kart('1', colors[0], x, y)], '1', [], false, []);
  await tick(60);
  assert.ok(renderer.renders > before + 5, `dibujó ${renderer.renders - before} cuadros`);
  assert.equal(Race3D.active, true);
});

test('al ocultar la pantalla de carrera deja de dibujar', async () => {
  const doc = dom.window.document;
  doc.getElementById('screen-race').classList.remove('active');
  assert.equal(Race3D.active, false);
  await tick(50);
  const frozen = renderer.renders;
  Race3D.update([kart('1', '#CE1126', 0, 0)], '1', [], false, []);
  await tick(50);
  assert.equal(renderer.renders, frozen);
  doc.getElementById('screen-race').classList.add('active');
});

test('el cóndor da la salida, avisa la última vuelta y baja a rescatar', async () => {
  const track = roundTrip(TRACKS[2]);
  Race3D.setTrack(track, null);
  const { x, y } = track.startLine;
  const players = [kart('1', '#FCD116', x, y)];
  const before = renderer.renders;
  Race3D.condor('start');
  for (let i = 0; i < 6; i++) { Race3D.update(players, '1', [], false, []); await tick(40); }
  Race3D.condor('lastLap');
  for (let i = 0; i < 4; i++) { Race3D.update(players, '1', [], false, []); await tick(40); }
  Race3D.condor('rescue', { x: x + 50, y });
  for (let i = 0; i < 4; i++) { Race3D.update(players, '1', [], false, []); await tick(40); }
  Race3D.condor('no-existe'); // se ignora
  assert.ok(renderer.renders > before + 5);
});
