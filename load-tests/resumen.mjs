// Calcula TPS, TPM y los indicadores del informe de rendimiento a partir de
// los resúmenes de k6 (--summary-export) guardados en load-tests/results/.
//
//   node load-tests/resumen.mjs                       (todos los resumen-*.json)
//   node load-tests/resumen.mjs results/resumen-load-*.json
//
// Definiciones (sección 2.5):
// - Solicitud: cada petición HTTP (http_reqs). TPS_http = http_reqs / s.
// - Transacción de negocio: una sesión de juego completa = iniciar sesión,
//   abrir el WebSocket, entrar a la sala (o quedar de espectador si está
//   llena o en carrera) y jugar/observar 60 s (ws_sessions).
// - Mensajes en tiempo real: estados de carrera recibidos por los clientes
//   (karswcol_state_messages) y controles enviados (ws_msgs_sent).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
const files = process.argv.slice(2).length
  ? process.argv.slice(2).map(f => path.resolve(f))
  : fs.readdirSync(dir).filter(f => /^resumen-.*\.json$/.test(f)).sort().map(f => path.join(dir, f));

const num = (v, d = 2) => (v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(d));

function analyze(file) {
  const { metrics: m } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const httpReqs = m.http_reqs?.count ?? 0;
  // k6 da la tasa sobre la duración total de la prueba: de ahí sale la duración.
  const seconds = httpReqs && m.http_reqs.rate ? httpReqs / m.http_reqs.rate : (m.iterations.count / m.iterations.rate);
  const sessions = m.ws_sessions?.count ?? 0;
  const failedThresholds = Object.entries(m)
    .flatMap(([name, v]) => Object.entries(v.thresholds || {}).filter(([, failed]) => failed).map(([t]) => `${name} ${t}`));
  return {
    test: path.basename(file).replace(/^resumen-|\.json$/g, ''),
    seconds,
    vusMax: m.vus?.max,
    httpReqs,
    tpsHttp: httpReqs / seconds,
    tpmHttp: (httpReqs / seconds) * 60,
    sessions,
    tpsBiz: sessions / seconds,
    tpmBiz: (sessions / seconds) * 60,
    stateMsgsPerSec: (m.karswcol_state_messages?.count ?? 0) / seconds,
    inputsPerSec: (m.ws_msgs_sent?.count ?? 0) / seconds,
    httpP95: m.http_req_duration?.['p(95)'],
    httpP99: m.http_req_duration?.['p(99)'],
    httpErr: (m.http_req_failed?.value ?? 0) * 100,
    wsConnP95: m.ws_connecting?.['p(95)'],
    joinP95: m.karswcol_join_latency?.['p(95)'],
    gapP95: m.karswcol_state_gap?.['p(95)'],
    gapMax: m.karswcol_state_gap?.max,
    wsOk: (m.karswcol_ws_session_ok?.value ?? 0) * 100,
    checksOk: (m.checks?.value ?? 0) * 100,
    failedThresholds
  };
}

const rows = files.map(analyze);
console.log('| Prueba | Duración | VUs máx | Solicitudes HTTP | TPS (HTTP) | TPM (HTTP) | Sesiones de juego | TPS (negocio) | TPM (negocio) |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.test} | ${num(r.seconds / 60, 1)} min | ${r.vusMax} | ${r.httpReqs} | ${num(r.tpsHttp)} | ${num(r.tpmHttp, 0)} | ${r.sessions} | ${num(r.tpsBiz, 3)} | ${num(r.tpmBiz, 1)} |`);
}
console.log('\n| Prueba | HTTP p95 (ms) | Errores HTTP | WS conexión p95 (ms) | Entrada a sala p95 (ms) | Gap entre estados p95 / máx (ms) | Estados recibidos/s | Controles enviados/s | Sesiones WS OK | Checks OK | Umbrales incumplidos |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.test} | ${num(r.httpP95)} | ${num(r.httpErr)} % | ${num(r.wsConnP95)} | ${num(r.joinP95, 0)} | ${num(r.gapP95, 0)} / ${num(r.gapMax, 0)} | ${num(r.stateMsgsPerSec, 0)} | ${num(r.inputsPerSec, 1)} | ${num(r.wsOk, 1)} % | ${num(r.checksOk, 2)} % | ${r.failedThresholds.length ? r.failedThresholds.join('; ') : 'ninguno'} |`);
}
