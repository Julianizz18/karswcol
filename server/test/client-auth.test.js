import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, closeAllClients, waitFor, jsonResponse, tick } from './client/harness.js';

afterEach(closeAllClients);

// Login con Google, sesión y navegación entre pantallas (auth.js, router.js).

function fakeGoogle() {
  const calls = { initialize: null, rendered: 0, prompts: 0, disabled: 0 };
  return {
    calls,
    initialize(opts) { calls.initialize = opts; },
    renderButton() { calls.rendered++; },
    prompt() { calls.prompts++; },
    disableAutoSelect() { calls.disabled++; }
  };
}

test('con sesión válida muestra el menú, el saludo y el nombre sugerido', async () => {
  const c = createClient({
    fetch: async () => jsonResponse(200, { user: { name: 'Sara Arteaga', picture: 'https://lh3.googleusercontent.com/a/x' } })
  });
  await waitFor(() => c.activeScreen() === 'screen-menu');
  assert.equal(c.$('#menu-greeting').textContent, 'Hola, Sara');
  assert.equal(c.$('#user-name').textContent, 'Sara Arteaga');
  assert.equal(c.$('#user-avatar').hidden, false);
  assert.equal(c.$('#name-input').value, 'Sara Arteaga');
  c.close();
});

test('no pone en la página una foto que no sea https de Google', async () => {
  for (const picture of ['javascript:alert(1)', 'http://lh3.googleusercontent.com/a/x', 'https://evil.example.com/x.png', 'no-es-url']) {
    const c = createClient({ fetch: async () => jsonResponse(200, { user: { name: 'Sara', picture } }) });
    await waitFor(() => c.activeScreen() === 'screen-menu');
    assert.equal(c.$('#user-avatar').hidden, true, picture);
    assert.equal(c.$('#user-avatar').getAttribute('src'), null, picture);
    c.close();
  }
});

test('sin sesión muestra el botón de Google y al iniciar sesión entra al menú', async () => {
  const google = fakeGoogle();
  const requests = [];
  const c = createClient({
    google,
    fetch: async (url, init = {}) => {
      requests.push([url, init.method || 'GET']);
      if (url.includes('/me')) return jsonResponse(401, { user: null });
      if (url.includes('/config')) return jsonResponse(200, { googleClientId: 'abc.apps.googleusercontent.com' });
      if (url.includes('/google')) return jsonResponse(200, { user: { name: 'Johan', picture: '' } });
      return jsonResponse(404, {});
    }
  });
  await waitFor(() => google.calls.rendered === 1);
  assert.equal(google.calls.initialize.client_id, 'abc.apps.googleusercontent.com');
  assert.equal(google.calls.prompts, 1);
  assert.equal(c.$('#login-form').hidden, false);
  await google.calls.initialize.callback({ credential: 'token' });
  await waitFor(() => c.activeScreen() === 'screen-menu');
  assert.ok(requests.some(([u, m]) => u === '/api/auth/google' && m === 'POST'));
  assert.equal(c.$('#user-avatar').hidden, true);
  c.close();
});

test('si Google rechaza el token se muestra el error y el formulario', async () => {
  const google = fakeGoogle();
  const c = createClient({
    google,
    fetch: async url => {
      if (url.includes('/me')) return jsonResponse(401, {});
      if (url.includes('/config')) return jsonResponse(200, { googleClientId: 'abc' });
      return jsonResponse(401, { error: 'Token de Google inválido o vencido.' });
    }
  });
  await waitFor(() => google.calls.initialize);
  await google.calls.initialize.callback({ credential: 'malo' });
  assert.equal(c.$('#login-error').textContent, 'Token de Google inválido o vencido.');
  assert.equal(c.$('#login-form').hidden, false);
  c.close();
});

test('si el servidor no tiene Client ID se muestra el error con opción de reintentar', async () => {
  const c = createClient({
    fetch: async url => (url.includes('/me') ? jsonResponse(401, {}) : jsonResponse(200, { googleClientId: '' }))
  });
  await waitFor(() => c.$('#login-error').textContent);
  assert.match(c.$('#login-error').textContent, /GOOGLE_CLIENT_ID/);
  assert.equal(c.$('#btn-login-retry').hidden, false);
  c.close();
});

test('si no hay red se informa que no se pudo contactar al servidor y se puede reintentar', async () => {
  let attempts = 0;
  const c = createClient({
    fetch: async (url, init, win) => {
      attempts++;
      if (attempts === 1) throw new win.TypeError('Failed to fetch');
      return jsonResponse(200, { user: { name: 'Johan' } });
    }
  });
  await waitFor(() => c.$('#login-error').textContent);
  assert.equal(c.$('#login-error').textContent, 'No se pudo contactar al servidor.');
  c.$('#btn-login-retry').click();
  await waitFor(() => c.activeScreen() === 'screen-menu');
  c.close();
});

test('cerrar sesión llama al servidor, desactiva el auto-login y recarga', async () => {
  const google = fakeGoogle();
  const requests = [];
  const c = createClient({
    google,
    fetch: async (url, init = {}) => {
      requests.push([url, init.method || 'GET']);
      return jsonResponse(200, { user: { name: 'Johan' } });
    }
  });
  await waitFor(() => c.activeScreen() === 'screen-menu');
  c.$('#btn-logout').click();
  await waitFor(() => c.navigations() > 0);
  assert.ok(requests.some(([u, m]) => u === '/api/auth/logout' && m === 'POST'));
  assert.equal(google.calls.disabled, 1);
  c.close();
});

test('los enlaces data-nav cambian de pantalla', async () => {
  const c = createClient();
  await waitFor(() => c.activeScreen() === 'screen-menu');
  const nav = c.document.querySelector('[data-nav]:not([data-nav="menu"])');
  assert.ok(nav, 'el menú tiene enlaces de navegación');
  nav.click();
  await waitFor(() => c.activeScreen() === `screen-${nav.dataset.nav}`);
  c.eval("Router.show('menu')");
  await waitFor(() => c.activeScreen() === 'screen-menu');
  c.eval("Router.show('no-existe')");
  await tick(20);
  assert.equal(c.activeScreen(), 'screen-menu');
  c.close();
});
