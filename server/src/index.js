import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(CLIENT_DIR, decodeURIComponent(filePath.split('?')[0]));

  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

// Alcance actual del curso: un único proceso, una sola sala (ver sección 4.2/8 de la propuesta).
const room = new Room(broadcast);
let nextId = 1;
const clients = new Map(); // id -> ws

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const ws of clients.values()) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

wss.on('connection', ws => {
  const id = String(nextId++);
  clients.set(id, ws);

  ws.on('message', raw => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join': {
        const name = String(msg.name || `Piloto ${id}`).slice(0, 20);
        const color = /^#[0-9a-fA-F]{6}$/.test(msg.color) ? msg.color : '#FCD116';
        room.addPlayer(id, name, color);
        ws.send(JSON.stringify({ type: 'joined', id }));
        break;
      }
      case 'ready':
        room.setReady(id);
        break;
      case 'input':
        room.setInput(id, msg.input);
        break;
      case 'restart':
        room.resetToLobby();
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    clients.delete(id);
    room.removePlayer(id);
    broadcast({ type: 'player_left', id });
  });
});

server.listen(PORT, () => {
  console.log(`KARSWCOL server escuchando en http://localhost:${PORT}`);
});
