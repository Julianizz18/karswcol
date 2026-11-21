import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, closeAllClients, waitFor, joinLobby, tick } from './client/harness.js';
import { TRACKS } from '../src/game-engine/trackCatalog.js';

// Carrera en el cliente: cuenta regresiva, HUD, avisos, controles, pausa,
// resultados y votación para volver al lobby (app.js, race.js, hud.js).

afterEach(closeAllClients);

// La pista tal como viaja por la red (sin las propiedades solo del servidor).
const track = JSON.parse(JSON.stringify(TRACKS[0]));
const weather = { condition: 'lluvia', tempC: 24, isDay: false, city: 'Cartagena', source: 'real', timeOfDay: 'noche' };

function player(overrides = {}) {
  return {
    id: '1', name: 'Johan', color: '#FCD116', x: track.startLine.x, y: track.startLine.y, angle: 0,
    speed: 3, lap: 1, finished: false, boosted: false, skidding: false, aquaplaning: false, crashed: false, isBot: false,
    ...overrides
  };
}

const PICKUP_KINDS = ['tinto', 'arepa', 'aguapanela', 'lechona', 'tamal', 'bunuelo', 'desconocido'];

async function startRace(c, { wetStart = false } = {}) {
  const ws = await joinLobby(c);
  ws.receive({ type: 'countdown', seconds: 3 });
  ws.receive({ type: 'countdown', seconds: 0 });
  ws.receive({ type: 'race_start', totalLaps: 3, track, weather, wetStart, difficulty: 'medio' });
  await waitFor(() => c.activeScreen() === 'screen-race');
  return ws;
}

function toast(c) {
  return c.$('#toast').textContent;
}

test('la cuenta regresiva enciende el semáforo y al llegar a cero dice ¡Ya!', async () => {
  const c = createClient();
  const ws = await joinLobby(c);
  ws.receive({ type: 'countdown', seconds: 2 });
  assert.equal(c.document.querySelectorAll('#countdown .semaforo i.on').length, 2);
  assert.equal(c.$('#countdown .countdown-value').textContent, '2');
  ws.receive({ type: 'countdown', seconds: 0 });
  assert.equal(c.$('#countdown .countdown-value').textContent, '¡Ya!');
  assert.ok(c.$('#countdown .semaforo').classList.contains('go'));
});

test('al arrancar muestra la pista, el clima y la vista de carrera', async () => {
  const c = createClient();
  await startRace(c, { wetStart: true });
  assert.equal(c.$('#hud-track').textContent, track.name);
  await waitFor(() => /lloviendo en Cartagena/.test(toast(c)), 2000);
});

test('el estado actualiza vueltas, clima y velocímetro, y dibuja todos los objetos', async () => {
  const c = createClient();
  const ws = await startRace(c);
  const pickups = PICKUP_KINDS.map((kind, i) => ({ id: `p${i}`, x: track.startLine.x + i * 20, y: track.startLine.y, available: true, kind, name: kind }));
  ws.receive({
    type: 'state', t: 1000, rainActive: true, puddles: [{ x: track.startLine.x, y: track.startLine.y, r: 20, depth: 0.5 }],
    players: [player({ lap: 2, boosted: true, skidding: true }), player({ id: 'bot-1', name: 'Bot', isBot: true, color: '#2ECC71', speed: -1 })],
    pickups
  });
  assert.equal(c.$('#hud-lap').textContent, 'Vuelta 2/3');
  assert.equal(c.$('#hud-weather').textContent, '🌧️ ¡Aguacero!');
  await tick(50); // varios cuadros del velocímetro y del canvas 2D
  const calls = c.$('#race-canvas').getContext('2d').calls;
  assert.ok(calls.some(([fn]) => fn === 'roundRect'), 'dibuja el pocillo y el tamal');
  assert.ok(calls.some(([fn]) => fn === 'ellipse'), 'dibuja la lechona y el café');
  assert.ok(!calls.some(([fn, text]) => fn === 'fillText' && /🫓|🫔/.test(text)), 'sin emojis de objetos');
});

test('avisos de choque y aquaplaning, una sola vez cada uno', async () => {
  const c = createClient();
  const ws = await startRace(c);
  ws.receive({ type: 'state', t: 0, rainActive: false, puddles: [], players: [player({ crashed: true })], pickups: [] });
  assert.match(toast(c), /Al muro/);
  ws.receive({ type: 'state', t: 50, rainActive: false, puddles: [], players: [player({ aquaplaning: true })], pickups: [] });
  assert.match(toast(c), /Aquaplaning/);
});

test('eventos de carrera: objeto, lluvia, vuelta con tiempo, desconexión', async () => {
  const c = createClient();
  const ws = await startRace(c);
  ws.receive({ type: 'event', kind: 'pickup_claimed', by: 'Sara', itemName: 'Arepa', emoji: '🫓' });
  assert.equal(toast(c), '⚡ Sara tomó una arepa');
  ws.receive({ type: 'event', kind: 'pickup_claimed', by: 'Sara', itemName: 'Tamal' });
  assert.equal(toast(c), '⚡ Sara tomó un tamal');
  ws.receive({ type: 'event', kind: 'pickup_claimed', by: 'Sara' });
  assert.equal(toast(c), '⚡ Sara tomó un objeto');
  ws.receive({ type: 'event', kind: 'rain_start', durationMs: 20000 });
  assert.match(toast(c), /Aguacero/);
  ws.receive({ type: 'event', kind: 'rain_end' });
  ws.receive({ type: 'event', kind: 'lap_completed', playerId: '1', lap: 1, lapTimeMs: 83456 });
  assert.equal(toast(c), '¡Vuelta 1/3 completada! · 1:23.46');
  ws.receive({ type: 'event', kind: 'lap_completed', playerId: '1', lap: 3, lapTimeMs: 59999 });
  assert.equal(toast(c), '¡Última vuelta completada! · 1:00.00 🏁');
  ws.receive({ type: 'event', kind: 'player_disconnected', name: 'Julian', graceMs: 30000 });
  assert.equal(toast(c), '📡 Julian se desconectó: tiene 30 s para volver');
});

test('las teclas mandan input solo cuando cambian y al perder el foco se sueltan', async () => {
  const c = createClient();
  const ws = await startRace(c);
  const key = (type, code) => c.window.dispatchEvent(new c.window.KeyboardEvent(type, { code, bubbles: true }));
  key('keydown', 'KeyW');
  key('keydown', 'KeyW'); // repetición del teclado: no manda otra vez
  key('keydown', 'ArrowLeft');
  assert.deepEqual(ws.sentOfType('input').map(m => m.input), [
    { up: true, down: false, left: false, right: false },
    { up: true, down: false, left: true, right: false }
  ]);
  key('keyup', 'ArrowLeft');
  assert.deepEqual(ws.sentOfType('input').at(-1).input, { up: true, down: false, left: false, right: false });
  c.window.dispatchEvent(new c.window.Event('blur'));
  assert.deepEqual(ws.sentOfType('input').at(-1).input, { up: false, down: false, left: false, right: false });
  const count = ws.sentOfType('input').length;
  c.window.dispatchEvent(new c.window.Event('blur'));
  assert.equal(ws.sentOfType('input').length, count, 'sin teclas presionadas no manda nada');
  key('keydown', 'KeyC');
  assert.match(toast(c), /Vista desde arriba|Cámara trasera/);
});

test('los botones táctiles alimentan el mismo input', async () => {
  const c = createClient();
  const ws = await startRace(c);
  const gas = c.document.querySelector('#touch-controls [data-key="up"]');
  gas.dispatchEvent(new c.window.Event('pointerdown', { bubbles: true, cancelable: true }));
  assert.equal(ws.sentOfType('input').at(-1).input.up, true);
  gas.dispatchEvent(new c.window.Event('pointerup', { bubbles: true }));
  assert.equal(ws.sentOfType('input').at(-1).input.up, false);
});

test('pausa: Esc la pide, el menú dice cuántas quedan y se puede abandonar o reanudar', async () => {
  const c = createClient();
  const ws = await startRace(c);
  c.window.dispatchEvent(new c.window.KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
  assert.equal(ws.sentOfType('toggle_pause').length, 1);
  ws.receive({ type: 'pause', paused: true, by: 'Johan', byId: '1' });
  assert.equal(c.$('#pause-overlay').hidden, false);
  ws.receive({ type: 'event', kind: 'pause_count', byId: '1', remaining: 2 });
  assert.equal(c.$('#pause-by').textContent, 'Pausaste la carrera · te quedan 2 pausas');
  ws.receive({ type: 'event', kind: 'pause_count', byId: '1', remaining: 1 });
  assert.match(c.$('#pause-by').textContent, /te queda 1 pausa/);
  c.$('#btn-quit-race').click();
  assert.equal(c.$('#pause-confirm').hidden, false);
  c.window.dispatchEvent(new c.window.KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
  assert.equal(c.$('#pause-confirm').hidden, true, 'Esc en la confirmación solo cancela');
  c.$('#btn-quit-race').click();
  c.$('#btn-quit-cancel').click();
  assert.equal(c.$('#pause-actions').hidden, false);
  c.$('#btn-resume').click();
  assert.equal(ws.sentOfType('toggle_pause').length, 2);
  ws.receive({ type: 'pause', paused: false, by: 'Johan', byId: '1' });
  assert.equal(c.$('#pause-overlay').hidden, true);
  assert.match(toast(c), /Carrera reanudada/);
  ws.receive({ type: 'pause', paused: true, by: 'Sara', byId: '2' });
  assert.equal(c.$('#pause-by').textContent, 'Sara pausó la carrera');
  ws.receive({ type: 'pause', paused: false, by: 'Sara', byId: '2' });
  assert.match(toast(c), /Sara reanudó/);
  ws.receive({ type: 'event', kind: 'pause_denied', byId: '1', max: 3 });
  assert.equal(toast(c), '⏸ Ya usaste tus 3 pausas de esta carrera');
  c.$('#btn-pause').click();
  c.$('#btn-quit-race').click();
  c.$('#btn-quit-confirm').click();
  assert.equal(ws.sentOfType('leave').length, 1, 'avisa que abandona');
  ws.receive({ type: 'left' });
  await waitFor(() => c.navigations() > 0);
});

test('resultados: posiciones, mejor vuelta, no terminó y cuenta regresiva', async () => {
  const c = createClient();
  const ws = await startRace(c);
  ws.receive({
    type: 'results',
    returnInMs: 20000,
    ranking: [
      { position: 1, id: '1', name: 'Johan', finishTimeMs: 185230, lap: 3, bestLapMs: 59870 },
      { position: 2, id: '2', name: 'Sara', finishTimeMs: null, lap: 1, bestLapMs: 70000 },
      { position: 3, id: '3', name: 'Julian', finishTimeMs: null, lap: 2, bestLapMs: null }
    ]
  });
  await waitFor(() => c.activeScreen() === 'screen-results');
  assert.equal(c.$('#results-title').textContent, 'Ganaste');
  const rows = [...c.document.querySelectorAll('#results-list li')].map(li => li.textContent);
  assert.match(rows[0], /185\.23 s/);
  assert.match(rows[0], /Mejor vuelta 0:59\.87/);
  assert.match(rows[0], /Tú/);
  assert.match(rows[1], /No terminó · 1 vuelta$/);
  assert.match(rows[2], /No terminó · 2 vueltas$/);
  assert.equal(c.$('#results-return').textContent, 'Volviendo al lobby en 20 s');
});

test('resultados: llegar segundo y no terminar cambian el título', async () => {
  const c = createClient();
  const ws = await startRace(c);
  ws.receive({ type: 'results', ranking: [{ position: 1, id: '2', name: 'Sara', finishTimeMs: 1000 }, { position: 2, id: '1', name: 'Johan', finishTimeMs: 2000 }] });
  assert.equal(c.$('#results-title').textContent, 'Llegaste 2.º');
  ws.receive({ type: 'results', ranking: [{ position: 1, id: '1', name: 'Johan', finishTimeMs: null, lap: 0 }] });
  assert.equal(c.$('#results-title').textContent, 'Resultados');
});

test('volver al lobby es un voto: muestra el avance y cambia de pantalla con room_reset', async () => {
  const c = createClient();
  const ws = await startRace(c);
  ws.receive({ type: 'results', returnInMs: 20000, ranking: [{ position: 1, id: '1', name: 'Johan', finishTimeMs: 1000 }] });
  await waitFor(() => c.activeScreen() === 'screen-results');
  c.$('#btn-back-lobby').click();
  assert.equal(ws.sentOfType('restart').length, 1);
  assert.equal(c.$('#btn-back-lobby').disabled, true);
  assert.equal(c.activeScreen(), 'screen-results', 'no se va solo');
  ws.receive({ type: 'event', kind: 'lobby_votes', votes: 1, total: 2 });
  assert.equal(c.$('#btn-back-lobby').textContent, 'Esperando a los demás (1/2)…');
  ws.receive({ type: 'room_reset' });
  await waitFor(() => c.activeScreen() === 'screen-lobby');
  assert.equal(c.$('#btn-back-lobby').disabled, false);
  assert.equal(c.$('#results-return').textContent, '');
  assert.equal(c.$('#btn-ready').disabled, false);
});

test('al volver a mitad de carrera (rejoined) entra directo a la carrera', async () => {
  const c = createClient();
  const ws = await joinLobby(c);
  ws.receive({ type: 'joined', id: '1', rejoined: true });
  ws.receive({ type: 'race_start', totalLaps: 3, track, weather: null, wetStart: false, rejoined: true });
  await waitFor(() => c.activeScreen() === 'screen-race');
  ws.receive({ type: 'pause', paused: true, by: 'Sara', byId: '2' });
  assert.equal(c.$('#pause-overlay').hidden, false);
});

test('el cóndor: salida, última vuelta y rescates con su aviso', async () => {
  const calls = [];
  const race3d = { supported: true, qualityMode: 'auto', setQualityMode() {}, setTrack() {}, update() {}, condor: (mode, data) => calls.push([mode, data]) };
  const c = createClient({ race3d });
  const ws = await startRace(c);
  ws.receive({ type: 'event', kind: 'lap_completed', playerId: '1', lap: 2, lapTimeMs: 60000 });
  ws.receive({ type: 'event', kind: 'condor_rescue', playerId: '1', name: 'Johan', x: 10, y: 20 });
  assert.equal(toast(c), '🦅 El cóndor te devolvió a la pista');
  ws.receive({ type: 'event', kind: 'condor_rescue', playerId: '2', name: 'Sara', x: 5, y: 6 });
  assert.equal(toast(c), '🦅 El cóndor rescató a Sara');
  // Los objetos vienen del realm de jsdom: se comparan por contenido.
  assert.equal(JSON.stringify(calls), JSON.stringify([['start', undefined], ['lastLap', undefined], ['rescue', { x: 10, y: 20 }], ['rescue', { x: 5, y: 6 }]]));
});
