import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway } from './gateway/gateway.js';
import { RaceRoom } from './raceRoom.js';
import { createAuthService } from './auth/authService.js';
import { WeatherService } from './weather/weatherService.js';
import { logger } from './observability/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const PORT = process.env.PORT || 3000;

// Un error no controlado queda registrado como log estructurado (visible en
// Loki/Grafana) antes de que el proceso termine.
process.on('uncaughtException', err => {
  logger.error('process.uncaught_exception', { err });
  process.exit(1);
});
process.on('unhandledRejection', err => {
  logger.error('process.unhandled_rejection', { err: err instanceof Error ? err : new Error(String(err)) });
});

// Alcance actual del curso: un único proceso, una sola sala (ver secciones
// 4.2 y 8 de la propuesta — el diseño está preparado para múltiples salas
// coordinadas por Redis si el backend llega a escalar a varios procesos).
const room = new RaceRoom(() => {});
// Clima real de cada región: si cambia mientras la sala está en el lobby, se avisa.
room.weather = new WeatherService({ onUpdate: () => { if (room.state === 'lobby') room.sendLobbyUpdate(); } });
room.weather.start();
const auth = createAuthService();
if (!auth.clientId) {
  logger.warn('config.missing_google_client_id', { message: 'GOOGLE_CLIENT_ID no está definido; el login con Google no funcionará.' });
}
if (auth.loadTestEnabled) {
  logger.warn('config.load_test_enabled', { message: 'LOAD_TEST_TOKEN definido: /api/auth/loadtest está activo. No usar en producción.' });
}
const server = createGateway({ clientDir: CLIENT_DIR, room, auth });

server.listen(PORT, () => {
  logger.info('server.started', { port: Number(PORT), url: `http://localhost:${PORT}`, metrics: '/metrics', health: '/health' });
});

// Apagado ordenado (docker stop envía SIGTERM).
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    logger.info('server.stopping', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
