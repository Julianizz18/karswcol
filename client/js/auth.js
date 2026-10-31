// Login con Google (Google Identity Services). El botón de Google entrega un
// ID token; el servidor lo valida y responde con una cookie de sesión
// HttpOnly que luego autentica también la conexión WebSocket.
const Auth = (() => {
  let user = null;
  const errorEl = document.getElementById('login-error');
  const loadingEl = document.getElementById('login-loading');
  const loadingText = document.getElementById('login-loading-text');
  const formEl = document.getElementById('login-form');
  const retryBtn = document.getElementById('btn-login-retry');

  function setLoading(text) {
    loadingEl.hidden = !text;
    if (text) loadingText.textContent = text;
  }

  function showError(message) {
    setLoading(null);
    errorEl.textContent = message;
    retryBtn.hidden = false;
  }

  function showUser(u) {
    user = u;
    document.getElementById('user-chip').hidden = false;
    document.getElementById('user-name').textContent = u.name;
    const avatar = document.getElementById('user-avatar');
    avatar.hidden = !u.picture;
    if (u.picture) avatar.src = u.picture;
    const firstName = (u.name || '').trim().split(/\s+/)[0];
    document.getElementById('menu-greeting').textContent = firstName ? `Hola, ${firstName}` : 'Hola';
    const nameInput = document.getElementById('name-input');
    if (!nameInput.value) nameInput.value = (u.name || '').slice(0, 20);
    Router.show('menu');
  }

  async function onGoogleCredential(response) {
    errorEl.textContent = '';
    formEl.hidden = true;
    setLoading('Iniciando sesión…');
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo iniciar sesión.');
      setLoading(null);
      showUser(data.user);
    } catch (err) {
      setLoading(null);
      formEl.hidden = false;
      errorEl.textContent = err.message || 'No se pudo iniciar sesión.';
    }
  }

  function waitForGoogleLibrary() {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      (function check() {
        if (window.google && google.accounts && google.accounts.id) return resolve();
        if (Date.now() - started > 10000) {
          return reject(new Error('No se pudo cargar el login de Google. Revisa tu conexión o desactiva bloqueadores de anuncios.'));
        }
        setTimeout(check, 100);
      })();
    });
  }

  async function renderGoogleButton() {
    setLoading('Cargando Google…');
    const config = await fetch('/api/auth/config').then(r => r.json());
    if (!config.googleClientId) throw new Error('El servidor no tiene configurado GOOGLE_CLIENT_ID.');
    await waitForGoogleLibrary();
    google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: onGoogleCredential,
      auto_select: true, // quien ya entró antes vuelve con un clic (One Tap)
      cancel_on_tap_outside: true,
      use_fedcm_for_prompt: true
    });
    const container = document.getElementById('google-signin');
    container.innerHTML = '';
    google.accounts.id.renderButton(container, {
      theme: 'filled_black',
      size: 'large',
      shape: 'rectangular',
      text: 'signin_with',
      locale: 'es',
      width: 300
    });
    setLoading(null);
    formEl.hidden = false;
    google.accounts.id.prompt();
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    // Evita que One Tap vuelva a entrar solo justo después de cerrar sesión.
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    location.reload();
  }

  async function init() {
    errorEl.textContent = '';
    retryBtn.hidden = true;
    formEl.hidden = true;
    setLoading('Verificando sesión…');
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      if (res.ok) {
        setLoading(null);
        showUser((await res.json()).user);
        return;
      }
      await renderGoogleButton();
    } catch (err) {
      showError(err.message && !(err instanceof TypeError) ? err.message : 'No se pudo contactar al servidor.');
    }
  }

  document.getElementById('btn-logout').addEventListener('click', logout);
  retryBtn.addEventListener('click', init);
  init();

  return { getUser: () => user };
})();
