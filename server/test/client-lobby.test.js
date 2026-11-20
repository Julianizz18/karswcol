import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, closeAllClients, waitFor, joinLobby, lobbyUpdate, tick } from './client/harness.js';

// Lobby: entrar a la sala, anfitrión, selectores, listo y rechazos (app.js).

afterEach(closeAllClients);

const HOST_CONTROLS = '#track-picker button, #track-prev, #track-next, #difficulty-picker button, #time-picker button, #btn-toggle-bots';

test('sin nombre no deja entrar y lo pide', async () => {
  const c = createClient();
  await waitFor(() => c.activeScreen() === 'screen-menu');
  c.$('#name-input').value = '   ';
  c.$('#btn-enter-lobby').click();
  assert.equal(c.$('#join-error').textContent, 'Escribe un nombre para continuar.');
  assert.equal(c.sockets.length, 0);
});

test('entrar manda join con el nombre y el vehículo, y muestra la parrilla', async () => {
  const c = createClient();
  const ws = await joinLobby(c, { name: 'Sara' });
  assert.deepEqual(ws.sentOfType('join')[0], { type: 'join', name: 'Sara', color: '#CE1126' });
  const items = c.document.querySelectorAll('#lobby-players li');
  assert.equal(items.length, 1);
  assert.match(items[0].textContent, /Sara/);
  assert.match(items[0].textContent, /Tú/);
  assert.match(items[0].textContent, /Anfitrión/);
  assert.equal(c.$('#lobby-count').textContent, '0 de 1 listos');
});

test('regresión: el anfitrión puede configurar aunque lobby_update llegue antes que joined', async () => {
  const c = createClient();
  await joinLobby(c, { id: '1', hostId: '1' });
  const controls = [...c.document.querySelectorAll(HOST_CONTROLS)];
  assert.ok(controls.length > 5);
  assert.ok(controls.every(el => !el.disabled), 'ningún control queda bloqueado');
  assert.equal(c.$('#host-note').hidden, true);
});

test('quien no es anfitrión ve los controles bloqueados y quién elige', async () => {
  const c = createClient();
  await joinLobby(c, {
    id: '2',
    hostId: '1',
    players: [{ id: '1', name: 'Julian', color: '#ECF0F1' }, { id: '2', name: 'Sara', color: '#CE1126' }]
  });
  assert.ok([...c.document.querySelectorAll(HOST_CONTROLS)].every(el => el.disabled));
  assert.equal(c.$('#host-note').hidden, false);
  assert.match(c.$('#host-note').textContent, /^Julian elige/);
});

test('el anfitrión cambia pista, hora, dificultad y bots', async () => {
  const c = createClient();
  const ws = await joinLobby(c);
  c.document.querySelectorAll('#track-picker button')[1].click();
  c.$('#track-next').click();
  c.$('#track-prev').click();
  c.document.querySelector('#time-picker button[data-id="noche"]').click();
  c.document.querySelector('#difficulty-picker button[data-id="dificil"]').click();
  c.$('#btn-toggle-bots').click();
  assert.deepEqual(ws.sentOfType('select_track').map(m => m.trackId), ['andes', 'andes', 'andes']);
  assert.deepEqual(ws.sentOfType('select_time'), [{ type: 'select_time', timeOfDay: 'noche' }]);
  assert.deepEqual(ws.sentOfType('select_difficulty'), [{ type: 'select_difficulty', difficulty: 'dificil' }]);
  assert.deepEqual(ws.sentOfType('toggle_bots'), [{ type: 'toggle_bots', enabled: true }]);
});

test('el lobby refleja la selección que confirma el servidor', async () => {
  const c = createClient();
  const ws = await joinLobby(c);
  ws.receive(lobbyUpdate({ selectedTrackId: 'andes', selectedTimeOfDay: 'noche', fillWithBots: true }));
  assert.equal(c.$('#track-name').textContent, 'Altiplano de Bogotá');
  assert.ok(c.document.querySelector('#track-picker button[data-track-id="andes"]').classList.contains('selected'));
  assert.ok(c.document.querySelector('#time-picker button[data-id="noche"]').classList.contains('selected'));
  assert.equal(c.$('#btn-toggle-bots').getAttribute('aria-checked'), 'true');
});

test('"Estoy listo" manda ready y queda esperando', async () => {
  const c = createClient();
  const ws = await joinLobby(c);
  c.$('#btn-ready').click();
  assert.equal(ws.sentOfType('ready').length, 1);
  assert.equal(c.$('#btn-ready').disabled, true);
  assert.equal(c.$('#btn-ready').textContent, 'Esperando al resto…');
});

test('un rechazo normal (sala llena) muestra el motivo', async () => {
  const c = createClient();
  await waitFor(() => c.activeScreen() === 'screen-menu');
  c.$('#name-input').value = 'Tarde';
  c.$('#btn-enter-lobby').click();
  await waitFor(() => c.socket?.sentOfType('join').length);
  c.socket.receive({ type: 'join_rejected', reason: 'La sala está llena.', waitMs: null });
  assert.equal(c.$('#join-error').textContent, 'La sala está llena.');
});

test('con carrera en curso avisa cuánto falta y entra solo cuando la sala vuelve al lobby', async () => {
  const c = createClient();
  await waitFor(() => c.activeScreen() === 'screen-menu');
  c.$('#name-input').value = 'Johan';
  c.$('#btn-enter-lobby').click();
  await waitFor(() => c.socket?.sentOfType('join').length);
  const ws = c.socket;
  ws.receive({ type: 'join_rejected', reason: 'Hay una carrera en curso', waitMs: 150_000 });
  assert.match(c.$('#join-error').textContent, /3 min como máximo/);
  ws.receive({ type: 'room_reset' });
  assert.equal(ws.sentOfType('join').length, 2, 'reintenta solo');
  assert.equal(c.$('#join-error').textContent, 'La carrera terminó: entrando a la sala…');
});

test('elegir vehículo cambia el color que se manda al entrar', async () => {
  const c = createClient();
  await waitFor(() => c.activeScreen() === 'screen-menu');
  c.$('#vehicle-next').click();
  c.$('#vehicle-next').click();
  c.$('#vehicle-prev').click();
  assert.ok(c.$('#vehicle-name').textContent.length > 0);
  c.document.querySelectorAll('#vehicle-dots button')[4].click();
  const ws = await joinLobby(c);
  assert.equal(ws.sentOfType('join')[0].color, '#2ECC71');
});

test('el selector de calidad gráfica aparece con 3D y guarda la elección', async () => {
  const modes = [];
  const race3d = {
    supported: true,
    qualityMode: 'auto',
    setQualityMode(m) { this.qualityMode = m; modes.push(m); },
    setTrack() {},
    update() {}
  };
  const c = createClient({ race3d });
  await waitFor(() => c.activeScreen() === 'screen-menu');
  assert.equal(c.$('#quality-setting').hidden, false);
  assert.ok(c.document.querySelector('#quality-picker button[data-id="auto"]').classList.contains('selected'));
  c.document.querySelector('#quality-picker button[data-id="media"]').click();
  assert.deepEqual(modes, ['media']);
  assert.ok(c.document.querySelector('#quality-picker button[data-id="media"]').classList.contains('selected'));
});

test('sin WebGL el selector de calidad queda oculto', async () => {
  const c = createClient();
  await waitFor(() => c.activeScreen() === 'screen-menu');
  await tick(10);
  assert.equal(c.$('#quality-setting').hidden, true);
});
