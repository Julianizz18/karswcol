// Entorno de pruebas del cliente: carga el index.html real en jsdom y ejecuta
// los scripts del cliente en el mismo orden que el navegador. Las APIs que
// jsdom no trae (WebSocket, canvas, animaciones, gamepad, login de Google)
// se reemplazan por dobles controlables desde las pruebas.
//
// Cada script se ejecuta con su ruta real como nombre de archivo, así la
// cobertura de Node (--experimental-test-coverage) se atribuye a
// client/js/*.js.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CLIENT_DIR = path.resolve(here, '..', '..', '..', 'client');

// Mismo orden que los <script> clásicos de index.html (race3d.js es un
// módulo WebGL: se reemplaza por un doble cuando la prueba lo necesita).
export const CLIENT_SCRIPTS = ['network.js', 'router.js', 'race.js', 'gamepad.js', 'hud.js', 'auth.js', 'fps.js', 'app.js'];

/** Contexto 2D falso: acepta cualquier llamada y registra los textos dibujados. */
function fakeContext2D(canvas) {
  const calls = [];
  const gradient = { addColorStop() {} };
  const target = {
    canvas,
    calls,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => ({}),
    measureText: text => ({ width: String(text).length * 8 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    isPointInPath: () => false
  };
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      return (...args) => { calls.push([prop, ...args]); };
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    }
  });
}

/** WebSocket falso: las pruebas hacen de servidor con receive() y close(). */
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    FakeWebSocket.instances.push(this);
    const behavior = FakeWebSocket.nextBehavior.shift() || 'open';
    setTimeout(() => {
      if (behavior === 'fail') {
        this.readyState = FakeWebSocket.CLOSED;
        this.onerror?.(new Error('fallo de conexión'));
        this.onclose?.({ code: 1006 });
        return;
      }
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    }, 0);
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  /** El "servidor" manda un mensaje a este cliente. */
  receive(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** El "servidor" (o la red) cierra la conexión. */
  close(code = 1000) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }

  sentOfType(type) {
    return this.sent.filter(m => m.type === type);
  }
}

/** Respuesta de fetch mínima. */
export function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/**
 * Crea un navegador simulado con el cliente cargado.
 * opciones:
 *  - fetch(url, init): respuesta para cada petición (por defecto, sesión válida)
 *  - google: objeto google.accounts.id falso (opcional)
 *  - race3d: doble de window.Race3D (opcional)
 *  - storage: valores iniciales de localStorage
 */
const openClients = new Set();

/** Cierra todas las ventanas abiertas (sus bucles de animación mantienen vivo el proceso). */
export function closeAllClients() {
  for (const w of openClients) w.close();
  openClients.clear();
}

export function createClient({ fetch, google, race3d, gamepads = [], storage = {} } = {}) {
  const html = fs.readFileSync(path.join(CLIENT_DIR, 'index.html'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', err => errors.push(err.message));
  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  });
  const { window } = dom;
  openClients.add(window);

  FakeWebSocket.instances = [];
  FakeWebSocket.nextBehavior = [];
  window.WebSocket = FakeWebSocket;
  // La función recibe la ventana para lanzar errores del mismo "realm" (p. ej. window.TypeError).
  window.fetch = fetch ? (url, init) => fetch(url, init, window) : (async url => (url.includes('/api/auth/me')
    ? jsonResponse(200, { user: { name: 'Johan Beltran', email: 'j@example.com', picture: '' } })
    : jsonResponse(200, {})));
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} });
  window.scrollTo = () => {};
  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!this.__ctx) this.__ctx = fakeContext2D(this);
    return this.__ctx;
  };
  window.Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {} });
  window.Element.prototype.getAnimations = () => [];
  window.HTMLImageElement.prototype.decode = () => Promise.resolve();
  // jsdom no calcula diseño (offsetParent siempre es null): se aproxima con la
  // pantalla activa y los elementos ocultos, que es lo que usa el cliente.
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      if (!this.isConnected || this.closest('[hidden]')) return null;
      const screen = this.closest('.screen');
      if (screen && !screen.classList.contains('active')) return null;
      return this.parentElement;
    }
  });
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
  Object.defineProperty(window.navigator, 'getGamepads', { value: () => gamepads, configurable: true });
  if (google) window.google = { accounts: { id: google } };
  if (race3d) window.Race3D = race3d;
  for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
  window.console.info = () => {};
  window.console.warn = () => {};

  const ctx = dom.getInternalVMContext();
  for (const name of CLIENT_SCRIPTS) {
    const file = path.join(CLIENT_DIR, 'js', name);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  }

  const $ = sel => window.document.querySelector(sel);
  return {
    dom,
    window,
    document: window.document,
    $,
    errors,
    sockets: FakeWebSocket.instances,
    get socket() { return FakeWebSocket.instances.at(-1); },
    /** La próxima conexión WebSocket falla (para probar la reconexión). */
    failNextConnections(n = 1) { for (let i = 0; i < n; i++) FakeWebSocket.nextBehavior.push('fail'); },
    /** Evalúa una expresión en el contexto del cliente (p. ej. "Race"). */
    eval(code) { return vm.runInContext(code, ctx); },
    activeScreen() { return window.document.querySelector('.screen.active')?.id; },
    navigations() { return errors.filter(e => /navigation/i.test(e)).length; },
    close() { window.close(); }
  };
}

export const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

/** Espera hasta que se cumpla la condición (o falla a los `timeout` ms). */
export async function waitFor(check, timeout = 3000) {
  const start = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('waitFor: la condición no se cumplió a tiempo');
    await tick(10);
  }
}

/** Login, conexión y entrada a la sala; deja al cliente en el lobby. */
export async function joinLobby(client, { name = 'Johan', id = '1', hostId = id, players } = {}) {
  await waitFor(() => client.activeScreen() === 'screen-menu');
  client.$('#name-input').value = name;
  client.$('#btn-enter-lobby').click();
  await waitFor(() => client.socket && client.socket.readyState === 1 && client.socket.sentOfType('join').length);
  const ws = client.socket;
  // Mismo orden que el servidor real: primero lobby_update, después joined.
  ws.receive(lobbyUpdate({ hostId, players: players || [{ id, name, color: '#FCD116', ready: false }] }));
  ws.receive({ type: 'joined', id, rejoined: false });
  await waitFor(() => client.activeScreen() === 'screen-lobby');
  return ws;
}

export function lobbyUpdate(overrides = {}) {
  return {
    type: 'lobby_update',
    players: [{ id: '1', name: 'Johan', color: '#FCD116', avatar: '', ready: false }],
    tracks: [
      { id: 'caribe', name: 'Costa de Cartagena', region: 'Región Caribe', description: 'Mar', inspiration: 'Monza', length: 5000, accent: '#f2c14e', outline: [[0, 0], [100, 0], [100, 100], [0, 100]], weather: { condition: 'despejado', tempC: 31, isDay: true, city: 'Cartagena', source: 'real' } },
      { id: 'andes', name: 'Altiplano de Bogotá', region: 'Andes', description: 'Frío', inspiration: 'Spa', length: 6000, accent: '#9ad', outline: [[0, 0], [50, 0], [50, 50]], weather: null }
    ],
    selectedTrackId: 'caribe',
    difficulties: [{ id: 'facil', label: 'Fácil' }, { id: 'medio', label: 'Medio' }, { id: 'dificil', label: 'Difícil' }],
    selectedDifficulty: 'medio',
    timesOfDay: [{ id: 'dia', label: 'Día' }, { id: 'noche', label: 'Noche' }, { id: 'real', label: 'Hora real' }],
    selectedTimeOfDay: 'dia',
    lapOptions: [1, 2, 3, 5],
    totalLaps: 3,
    fillWithBots: false,
    botFillTarget: 6,
    hostId: '1',
    ...overrides
  };
}
