import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, closeAllClients, waitFor, joinLobby, tick } from './client/harness.js';
import { TRACKS } from '../src/game-engine/trackCatalog.js';

// Velocímetro (hud.js): marchas, rpm, reversa y avisos según el estado del kart.

afterEach(closeAllClients);

const track = JSON.parse(JSON.stringify(TRACKS[2]));

async function inRace() {
  const c = createClient();
  const ws = await joinLobby(c);
  ws.receive({ type: 'race_start', totalLaps: 3, track, weather: { condition: 'niebla', tempC: 12, isDay: true, city: 'Manizales', source: 'tipico' } });
  await waitFor(() => c.activeScreen() === 'screen-race');
  const ctx = c.$('#gauge-canvas').getContext('2d');
  const texts = () => ctx.calls.filter(([fn]) => fn === 'fillText').map(([, t]) => String(t));
  return { c, ws, ctx, texts };
}

function state(ws, me, rainActive = false) {
  ws.receive({ type: 'state', t: 0, rainActive, puddles: [], pickups: [], players: [{ id: '1', name: 'Johan', color: '#FCD116', x: 0, y: 0, angle: 0, lap: 0, ...me }] });
}

test('detenido muestra neutro y al acelerar sube de marcha', async () => {
  const { ws, ctx, texts } = await inRace();
  state(ws, { speed: 0 });
  await tick(60);
  assert.ok(texts().includes('N'), 'neutro');
  ctx.calls.length = 0;
  state(ws, { speed: 6.5 }); // ~290 km/h
  await tick(400);
  assert.ok(texts().some(t => /^[4-6]$/.test(t)), 'marcha alta');
  assert.ok(texts().some(t => /^\d{3}$/.test(t)), 'velocidad de tres cifras');
});

test('en reversa muestra R', async () => {
  const { ws, ctx, texts } = await inRace();
  ctx.calls.length = 0;
  state(ws, { speed: -1 });
  await tick(200);
  assert.ok(texts().includes('R'));
});

test('turbo, derrape, lluvia y aquaplaning se señalan en el tablero', async () => {
  const { ws, ctx, texts } = await inRace();
  ctx.calls.length = 0;
  state(ws, { speed: 8.6, boosted: true, skidding: true, aquaplaning: true }, true);
  await tick(500); // incluye el limitador en la última marcha
  const all = texts().join(' ');
  assert.match(all, /TURBO|BOOST|NITRO/i);
  assert.ok(ctx.calls.length > 50, 'dibuja varios cuadros');
});

test('Hud.reset deja el tablero en cero', async () => {
  const { c, ws, ctx, texts } = await inRace();
  state(ws, { speed: 5 });
  await tick(100);
  c.eval('Hud.reset()');
  ctx.calls.length = 0;
  state(ws, { speed: 0 });
  await tick(80);
  assert.ok(texts().includes('N'));
  assert.equal(c.eval('Hud.SPEED_TO_KMH'), 45);
});
