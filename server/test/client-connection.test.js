import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, closeAllClients, waitFor, joinLobby } from './client/harness.js';
import { TRACKS } from '../src/game-engine/trackCatalog.js';

const track = JSON.parse(JSON.stringify(TRACKS[1]));

// Conexión: reconexión automática, sesión cerrada, exceso de mensajes
// (app.js, network.js), y periféricos: gamepad y contador de FPS.

afterEach(closeAllClients);

test('si se cae la conexión reconecta sola y vuelve a entrar a la sala', async () => {
  const c = createClient();
  const first = await joinLobby(c);
  first.close(1006);
  assert.equal(c.$('#conn-banner').hidden, false);
  assert.match(c.$('#conn-banner').textContent, /Reconectando… \(intento 1\)/);
  await waitFor(() => c.sockets.length === 2 && c.socket.readyState === 1, 4000);
  await waitFor(() => c.socket.sentOfType('join').length === 1);
  assert.deepEqual(c.socket.sentOfType('join')[0], first.sentOfType('join')[0], 'mismo nombre y vehículo');
  assert.equal(c.$('#conn-banner').hidden, true);
  assert.equal(c.$('#toast').textContent, '📶 Conexión recuperada');
});

test('si el primer intento falla, espera más y lo vuelve a intentar', async () => {
  const c = createClient();
  const first = await joinLobby(c);
  c.failNextConnections(1);
  first.close(1006);
  await waitFor(() => /intento 2/.test(c.$('#conn-banner').textContent), 4000);
  await waitFor(() => c.sockets.length === 3 && c.socket.readyState === 1, 6000);
  await waitFor(() => c.$('#conn-banner').hidden);
});

test('si el servidor cierra por sesión inválida (4401) vuelve al login', async () => {
  const c = createClient();
  const ws = await joinLobby(c);
  ws.close(4401);
  await waitFor(() => c.navigations() > 0);
  assert.equal(c.sockets.length, 1, 'no intenta reconectar');
});

test('si el servidor cierra por exceso de mensajes (1008) ofrece recargar', async () => {
  const c = createClient();
  const ws = await joinLobby(c);
  ws.close(1008);
  assert.match(c.$('#conn-banner').textContent, /exceso de mensajes/);
  const reload = c.$('#conn-banner button');
  assert.equal(reload.textContent, 'Recargar');
  reload.click();
  await waitFor(() => c.navigations() > 0);
});

test('si no se puede conectar al entrar, lo dice', async () => {
  const c = createClient();
  await waitFor(() => c.activeScreen() === 'screen-menu');
  c.failNextConnections(1);
  c.$('#name-input').value = 'Johan';
  c.$('#btn-enter-lobby').click();
  await waitFor(() => c.$('#join-error').textContent === 'No se pudo conectar al servidor.');
});

test('el gamepad se detecta en el lobby y maneja el kart en carrera', async () => {
  const button = pressed => ({ pressed, value: pressed ? 1 : 0 });
  const pad = { id: 'Xbox Controller', index: 0, axes: [0, 0], buttons: Array.from({ length: 16 }, () => button(false)) };
  const gamepads = [pad];
  const c = createClient({ gamepads });
  const ws = await joinLobby(c);
  await waitFor(() => /Control conectado: Xbox Controller/.test(c.$('#gamepad-status').textContent));
  ws.receive({ type: 'race_start', totalLaps: 3, track, weather: null });
  await waitFor(() => c.activeScreen() === 'screen-race');
  pad.axes[0] = -0.9;
  pad.buttons[7] = button(true); // R2: acelerar
  await waitFor(() => ws.sentOfType('input').some(m => m.input.up && m.input.left));
  pad.buttons[9] = button(true); // Start: pausa
  await waitFor(() => ws.sentOfType('toggle_pause').length === 1);
  gamepads.length = 0; // se desconecta
  await waitFor(() => c.$('#gamepad-status').textContent === '');
});

test('el contador de FPS aparece en la carrera y muestra la calidad en 3D', async () => {
  const race3d = { supported: true, active: true, quality: 'media', qualityMode: 'auto', setQualityMode() {}, setTrack() {}, update() {}, toggleView: () => true };
  const c = createClient({ race3d });
  const ws = await joinLobby(c);
  ws.receive({ type: 'race_start', totalLaps: 3, track, weather: null });
  await waitFor(() => c.activeScreen() === 'screen-race');
  const fps = c.$('.fps-counter');
  assert.ok(fps, 'existe el contador');
  await waitFor(() => /^\d+ FPS · media$/.test(fps.textContent), 3000);
  assert.ok(['good', 'ok', 'bad'].includes(fps.dataset.level));
  c.eval("Router.show('menu')");
  await waitFor(() => c.activeScreen() === 'screen-menu');
});
