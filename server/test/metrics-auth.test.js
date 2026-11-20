import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway } from '../src/gateway/gateway.js';
import { createAuthService } from '../src/auth/authService.js';
import { RaceRoom } from '../src/raceRoom.js';

// Con METRICS_TOKEN definido, /metrics exige "Authorization: Bearer <token>".

const CLIENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client');
let server;
let base;

before(async () => {
  const auth = createAuthService({ clientId: 'x', sessionSecret: 's' });
  server = createGateway({ clientDir: CLIENT_DIR, room: new RaceRoom(() => {}), auth, metricsToken: 'secreto-metricas' });
  await new Promise(resolve => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

test('/metrics sin token responde 401', async () => {
  const res = await fetch(`${base}/metrics`);
  assert.equal(res.status, 401);
});

test('/metrics con token incorrecto responde 401', async () => {
  const res = await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer otro' } });
  assert.equal(res.status, 401);
});

test('/metrics con el token correcto responde las métricas', async () => {
  const res = await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer secreto-metricas' } });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /karswcol_/);
});

test('/health sigue abierto', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
});
