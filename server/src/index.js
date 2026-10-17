import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway } from './gateway/gateway.js';
import { RaceRoom } from './raceRoom.js';
import { createAuthService } from './auth/authService.js';
import { WeatherService } from './weather/weatherService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const PORT = process.env.PORT || 3000;

// Alcance actual del curso: un único proceso, una sola sala (ver secciones
// 4.2 y 8 de la propuesta — el diseño está preparado para múltiples salas
// coordinadas por Redis si el backend llega a escalar a varios procesos).
const room = new RaceRoom(() => {});
// Clima real de cada región: si cambia mientras la sala está en el lobby, se avisa.
room.weather = new WeatherService({ onUpdate: () => { if (room.state === 'lobby') room.sendLobbyUpdate(); } });
room.weather.start();
const auth = createAuthService();
if (!auth.clientId) {
  console.warn('AVISO: GOOGLE_CLIENT_ID no está definido; el login con Google no funcionará.');
}
const server = createGateway({ clientDir: CLIENT_DIR, room, auth });

server.listen(PORT, () => {
  console.log(`KARSWCOL — Connection Gateway escuchando en http://localhost:${PORT}`);
});
