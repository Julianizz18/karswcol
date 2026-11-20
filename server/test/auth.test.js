import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createGateway } from '../src/gateway/gateway.js';
import { createAuthService } from '../src/auth/authService.js';

// Pruebas del login con Google: el verificador de Google se reemplaza por
// uno falso, así se prueba todo el flujo (API, cookie, WebSocket) sin red.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');

const FAKE_TOKENS = {
  'token-valido': { sub: '123', email: 'piloto@example.com', email_verified: true, name: 'Piloto Prueba', picture: 'https://lh3.googleusercontent.com/a/foto' },
  'token-foto-externa': { sub: '789', email: 'y@example.com', email_verified: true, name: 'Y', picture: 'https://evil.example/track.png' },
  'token-no-verificado': { sub: '456', email: 'x@example.com', email_verified: false, name: 'X' }
};

const room = {
  players: [],
  addPlayer(id, name, color, avatar) { this.players.push({ id, name, avatar }); return null; },
  join(id, { name, avatar }) { this.players.push({ id, name, avatar }); return { playerId: id, rejoined: false }; },
  handleDisconnect(id) { this.removePlayer(id); },
  removed: [], tracks: [],
  removePlayer(id) { this.removed.push(id); }, setReady() {}, selectTrack(t) { this.tracks.push(t); }, selectDifficulty() {},
  toggleBots() {}, setInput() {}, requestRestart() {}
};

let server;
let base;

before(async () => {
  const auth = createAuthService({
    clientId: 'test-client-id.apps.googleusercontent.com',
    sessionSecret: 'secreto-de-prueba',
    verifyIdToken: async token => {
      if (!FAKE_TOKENS[token]) throw new Error('Token de Google inválido.');
      return FAKE_TOKENS[token];
    }
  });
  server = createGateway({ clientDir: CLIENT_DIR, room, auth });
  await new Promise(resolve => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

async function login(credential) {
  return fetch(`${base}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential })
  });
}

function sessionCookieFrom(res) {
  return res.headers.get('set-cookie').split(';')[0];
}

function openSocket(cookie) {
  return new WebSocket(base.replace('http', 'ws'), { headers: cookie ? { cookie } : {} });
}

test('config expone el client ID de Google', async () => {
  const res = await fetch(`${base}/api/auth/config`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { googleClientId: 'test-client-id.apps.googleusercontent.com' });
});

test('/me sin sesión responde 401', async () => {
  const res = await fetch(`${base}/api/auth/me`);
  assert.equal(res.status, 401);
});

test('login con token inválido responde 401 y no crea cookie', async () => {
  const res = await login('token-falso');
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('login con correo no verificado se rechaza', async () => {
  const res = await login('token-no-verificado');
  assert.equal(res.status, 401);
});

test('login válido crea cookie HttpOnly y /me devuelve el usuario', async () => {
  const res = await login('token-valido');
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /karswcol_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);

  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: sessionCookieFrom(res) } });
  assert.equal(me.status, 200);
  assert.deepEqual((await me.json()).user, { name: 'Piloto Prueba', email: 'piloto@example.com', picture: 'https://lh3.googleusercontent.com/a/foto' });
});

test('cookie manipulada no es aceptada', async () => {
  const res = await login('token-valido');
  const [name, value] = sessionCookieFrom(res).split('=');
  const sig = decodeURIComponent(value).split('.')[1];
  const forged = Buffer.from(JSON.stringify({ sub: '999', name: 'Hacker', exp: Date.now() + 1e9 })).toString('base64url');
  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: `${name}=${forged}.${sig}` } });
  assert.equal(me.status, 401);
});

test('logout borra la cookie', async () => {
  const res = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
});

test('login desde otro origen se rechaza', async () => {
  const res = await fetch(`${base}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ credential: 'token-valido' })
  });
  assert.equal(res.status, 403);
});

test('WebSocket sin sesión se cierra con código 4401', async () => {
  const ws = openSocket(null);
  const code = await new Promise(resolve => ws.on('close', resolve));
  assert.equal(code, 4401);
});

test('WebSocket con sesión permite unirse a la sala', async () => {
  const res = await login('token-valido');
  const ws = openSocket(sessionCookieFrom(res));
  await new Promise(resolve => ws.on('open', resolve));
  ws.send(JSON.stringify({ type: 'join', name: '', color: '#FCD116' }));
  const msg = await new Promise(resolve => ws.on('message', raw => resolve(JSON.parse(raw))));
  assert.equal(msg.type, 'joined');
  // Sin nombre explícito se usa el nombre de la cuenta de Google.
  assert.equal(room.players.at(-1).name, 'Piloto Prueba');
  ws.close();
});

test('los archivos estáticos se siguen sirviendo', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /screen-login/);
});

test('/me renueva la cookie de sesión', async () => {
  const res = await login('token-valido');
  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: sessionCookieFrom(res) } });
  assert.match(me.headers.get('set-cookie'), /karswcol_session=.+Max-Age=43200/);
  assert.equal(me.headers.get('cache-control'), 'no-store');
});

test('fotos que no son de Google se descartan', async () => {
  const res = await login('token-foto-externa');
  assert.equal((await res.json()).user.picture, '');
});

test('la foto de Google llega a la sala desde la sesión, no desde el cliente', async () => {
  const res = await login('token-valido');
  const ws = openSocket(sessionCookieFrom(res));
  await new Promise(resolve => ws.on('open', resolve));
  ws.send(JSON.stringify({ type: 'join', name: 'Otro', color: '#FCD116', avatar: 'https://evil.example/x.png' }));
  await new Promise(resolve => ws.on('message', resolve));
  assert.equal(room.players.at(-1).avatar, 'https://lh3.googleusercontent.com/a/foto');
  ws.close();
});

test('una conexión que no entró a la sala no puede controlarla', async () => {
  const res = await login('token-valido');
  const ws = openSocket(sessionCookieFrom(res));
  await new Promise(resolve => ws.on('open', resolve));
  ws.send(JSON.stringify({ type: 'select_track', trackId: 'antes-del-join' }));
  ws.send(JSON.stringify({ type: 'join', name: 'Sara', color: '#FCD116' }));
  await new Promise(resolve => ws.on('message', resolve));
  ws.send(JSON.stringify({ type: 'select_track', trackId: 'despues-del-join' }));
  ws.close();
  await new Promise(resolve => ws.on('close', resolve));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(!room.tracks.includes('antes-del-join'));
  assert.ok(room.tracks.includes('despues-del-join'));
});

test('cerrar una conexión que nunca entró no la saca de la sala', async () => {
  const res = await login('token-valido');
  const ws = openSocket(sessionCookieFrom(res));
  await new Promise(resolve => ws.on('open', resolve));
  const removedBefore = room.removed.length;
  ws.close();
  await new Promise(resolve => ws.on('close', resolve));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(room.removed.length, removedBefore);
});

test('los estáticos llevan Last-Modified y responden 304 si no cambiaron', async () => {
  const first = await fetch(`${base}/index.html`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-cache');
  const lastModified = first.headers.get('last-modified');
  assert.ok(lastModified);
  const second = await fetch(`${base}/index.html`, { headers: { 'if-modified-since': lastModified } });
  assert.equal(second.status, 304);
});

test('las imágenes se cachean un día', async () => {
  const res = await fetch(`${base}/img/kart-taxi.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=86400');
  assert.equal(res.headers.get('content-type'), 'image/png');
});

test('una carpeta no se sirve como archivo', async () => {
  const res = await fetch(`${base}/img`);
  assert.equal(res.status, 404);
});

test('los mensajes por encima del límite se descartan', async () => {
  const res = await login('token-valido');
  const ws = openSocket(sessionCookieFrom(res));
  await new Promise(resolve => ws.on('open', resolve));
  ws.send(JSON.stringify({ type: 'join', name: 'Spam', color: '#FCD116' }));
  await new Promise(resolve => ws.on('message', resolve));
  const before = room.tracks.length;
  for (let i = 0; i < 200; i++) ws.send(JSON.stringify({ type: 'select_track', trackId: `spam-${i}` }));
  await new Promise(resolve => setTimeout(resolve, 100));
  const processed = room.tracks.length - before;
  // La ráfaga permite ~60 (menos el join); el resto se descarta.
  assert.ok(processed < 70, `se procesaron ${processed}`);
  assert.ok(processed >= 50, `se procesaron ${processed}`);
  ws.close();
});

test('quien insiste muy por encima del límite es desconectado', async () => {
  const res = await login('token-valido');
  const ws = openSocket(sessionCookieFrom(res));
  await new Promise(resolve => ws.on('open', resolve));
  const closed = new Promise(resolve => ws.on('close', code => resolve(code)));
  for (let i = 0; i < 500; i++) ws.send(JSON.stringify({ type: 'input', input: {} }));
  assert.equal(await closed, 1008);
});

test('después del logout la cookie anterior ya no sirve', async () => {
  const res = await login('token-valido');
  const cookie = sessionCookieFrom(res);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie } })).status, 200);
  await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie } });
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie } })).status, 401);
});

test('una cookie renovada antes del logout también queda invalidada', async () => {
  const res = await login('token-valido');
  const cookie = sessionCookieFrom(res);
  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
  const renewed = me.headers.get('set-cookie').split(';')[0];
  await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie } });
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie: renewed } })).status, 401);
});

test('el logout desconecta las pestañas abiertas con esa sesión', async () => {
  const res = await login('token-valido');
  const cookie = sessionCookieFrom(res);
  const ws = openSocket(cookie);
  await new Promise(resolve => ws.on('open', resolve));
  const closed = new Promise(resolve => ws.on('close', code => resolve(code)));
  await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie } });
  assert.equal(await closed, 4401);
});

test('el logout de una sesión no afecta a otra', async () => {
  const a = sessionCookieFrom(await login('token-valido'));
  const b = sessionCookieFrom(await login('token-valido'));
  await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie: a } });
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie: b } })).status, 200);
});

test('los inicios de sesión exitosos y fallidos quedan en /metrics (trazabilidad)', async () => {
  const metricValue = async (labels) => {
    const text = await (await fetch(`${base}/metrics`)).text();
    const line = text.split('\n').find(l => l.startsWith('karswcol_auth_logins_total{') && labels.every(x => l.includes(x)));
    return line ? Number(line.split(' ').at(-1)) : 0;
  };
  const okBefore = await metricValue(['provider="google"', 'result="success"']);
  const failBefore = await metricValue(['provider="google"', 'result="failure"']);
  await login('token-valido');
  await login('no-existe');
  assert.equal(await metricValue(['provider="google"', 'result="success"']), okBefore + 1);
  assert.equal(await metricValue(['provider="google"', 'result="failure"']), failBefore + 1);
});

test('las rutas fuera del cliente no se sirven (path traversal)', async () => {
  for (const p of ['/../server/package.json', '/%2e%2e/server/package.json', '/..%2f..%2fserver%2fpackage.json', '/js/../../server/.env']) {
    const res = await fetch(`${base}${p}`);
    assert.ok([400, 404].includes(res.status), `${p} -> ${res.status}`);
  }
  assert.equal((await fetch(`${base}/js/app.js`)).status, 200);
});
