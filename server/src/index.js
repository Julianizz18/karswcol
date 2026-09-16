import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway } from './gateway/gateway.js';
import { RaceRoom } from './raceRoom.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const PORT = process.env.PORT || 3000;

// Alcance actual del curso: un único proceso, una sola sala (ver secciones
// 4.2 y 8 de la propuesta — el diseño está preparado para múltiples salas
// coordinadas por Redis si el backend llega a escalar a varios procesos).
const room = new RaceRoom(() => {});
const server = createGateway({ clientDir: CLIENT_DIR, room });

server.listen(PORT, () => {
  console.log(`KARSWCOL — Connection Gateway escuchando en http://localhost:${PORT}`);
});
