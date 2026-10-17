import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

// Auth Service: login con Google (Google Identity Services). El cliente
// obtiene un ID token firmado por Google y lo envía una sola vez; el
// servidor lo verifica (firma, audiencia = nuestro Client ID, expiración) y
// emite su propia cookie de sesión firmada con HMAC. A partir de ahí, tanto
// las peticiones HTTP como el WebSocket se autentican con esa cookie.

export const SESSION_COOKIE = 'karswcol_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

export function createAuthService({
  clientId = process.env.GOOGLE_CLIENT_ID || '',
  sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  verifyIdToken = null
} = {}) {
  const googleClient = new OAuth2Client(clientId);

  // Inyectable para pruebas; por defecto valida contra las llaves públicas de Google.
  const verify = verifyIdToken || (async credential => {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId });
    return ticket.getPayload();
  });

  function sign(data) {
    return crypto.createHmac('sha256', sessionSecret).update(data).digest('base64url');
  }

  function createSession(user) {
    const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }

  function readSession(token) {
    if (!token || typeof token !== 'string') return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expected = Buffer.from(sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return session.exp > Date.now() ? session : null;
    } catch {
      return null;
    }
  }

  async function loginWithGoogle(credential) {
    if (!clientId) throw new Error('GOOGLE_CLIENT_ID no está configurado en el servidor.');
    if (!credential || typeof credential !== 'string') throw new Error('Falta el token de Google.');
    let payload;
    try {
      payload = await verify(credential);
    } catch {
      throw new Error('Token de Google inválido o vencido.');
    }
    if (!payload || !payload.sub) throw new Error('Token de Google inválido.');
    if (payload.email && payload.email_verified === false) throw new Error('El correo de Google no está verificado.');
    const user = {
      sub: payload.sub,
      email: payload.email || '',
      name: String(payload.name || payload.given_name || 'Piloto').slice(0, 40),
      picture: safePictureUrl(payload.picture)
    };
    return { user, token: createSession(user) };
  }

  function sessionFromRequest(req) {
    return readSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  }

  // Sesión deslizante: cada visita reemite la cookie con 12h nuevas, así un
  // jugador activo no tiene que volver a iniciar sesión.
  function renewSession(session) {
    const { exp, ...user } = session;
    return createSession(user);
  }

  return { clientId, loginWithGoogle, readSession, sessionFromRequest, renewSession };
}

// Solo se aceptan fotos servidas por Google: la URL termina en el <img> de
// otros jugadores y no debe apuntar a un servidor arbitrario.
function safePictureUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.googleusercontent.com') ? parsed.href : '';
  } catch {
    return '';
  }
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    try {
      cookies[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      // Cookie mal codificada: se ignora.
    }
  }
  return cookies;
}

export function publicUser(session) {
  return session ? { name: session.name, email: session.email, picture: session.picture } : null;
}
