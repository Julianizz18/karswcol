import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';

// Connection Gateway (HU01, componente "Connection Gateway" de la sección
// 4.1). Es el único punto de entrada de red: sirve el cliente estático,
// acepta conexiones WebSocket y traduce mensajes JSON hacia la sala de
// carrera. No conoce reglas de juego ni de matchmaking, solo enruta.

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

export function createGateway({ clientDir, room }) {
  const server = http.createServer((req, res) => {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    try {
      filePath = path.join(clientDir, decodeURIComponent(filePath.split('?')[0]));
    } catch {
      // URL mal codificada (p. ej. "/%"): sin este catch tumbaba el proceso.
      res.writeHead(400);
      res.end('Bad request');
      return;
    }

    if (!filePath.startsWith(clientDir + path.sep)) {
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
  const clients = new Map(); // id -> ws
  let nextId = 1;

  function broadcast(message) {
    const payload = JSON.stringify(message);
    for (const ws of clients.values()) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }
  room.broadcast = broadcast;

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
      // JSON válido pero no objeto ("null", "3", ...): se ignora en vez de tumbar el proceso.
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'join': {
          const name = String(msg.name || `Piloto ${id}`).slice(0, 20);
          const color = /^#[0-9a-fA-F]{6}$/.test(msg.color) ? msg.color : '#FCD116';
          const rejection = room.addPlayer(id, name, color);
          ws.send(JSON.stringify(rejection ? { type: 'join_rejected', reason: rejection } : { type: 'joined', id }));
          break;
        }
        case 'ready':
          room.setReady(id);
          break;
        case 'select_track':
          room.selectTrack(String(msg.trackId || ''));
          break;
        case 'select_difficulty':
          room.selectDifficulty(String(msg.difficulty || ''));
          break;
        case 'toggle_bots':
          room.toggleBots(!!msg.enabled);
          break;
        case 'input':
          room.setInput(id, msg.input);
          break;
        case 'restart':
          room.requestRestart();
          break;
        default:
          break;
      }
    });

    ws.on('close', () => {
      clients.delete(id);
      room.removePlayer(id);
    });
  });

  return server;
}
