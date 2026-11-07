// Observabilidad — logs estructurados. Cada línea es un objeto JSON en
// stdout/stderr; Docker los guarda, Promtail los envía a Loki y en Grafana
// se filtran por nivel o evento (p. ej. {app="karswcol"} | json | level="error").
//
// LOG_LEVEL controla el mínimo que se imprime (debug | info | warn | error).
// LOG_FORMAT=pretty los imprime legibles para desarrollo local.

import fs from 'node:fs';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

// LOG_FILE: además de la consola, cada línea JSON se agrega a ese archivo.
// Lo usa el modo sin Docker (observability/local), donde Promtail lee el
// archivo en vez de los logs de los contenedores.
const fileStream = process.env.LOG_FILE ? fs.createWriteStream(process.env.LOG_FILE, { flags: 'a' }) : null;

function minLevel() {
  if (LEVELS[process.env.LOG_LEVEL]) return LEVELS[process.env.LOG_LEVEL];
  // Bajo `node --test` no se imprime nada, para no ensuciar la salida de las pruebas.
  return process.env.NODE_TEST_CONTEXT ? Infinity : LEVELS.info;
}

function write(level, event, fields = {}) {
  if (LEVELS[level] < minLevel()) return;
  const entry = { ts: new Date().toISOString(), level, app: 'karswcol', event, ...fields };
  if (fields.err instanceof Error) entry.err = { message: fields.err.message, stack: fields.err.stack };
  if (fileStream) fileStream.write(JSON.stringify(entry) + '\n');
  let line;
  if (process.env.LOG_FORMAT === 'pretty') {
    const { ts, level: l, app, event: e, ...rest } = entry;
    line = `${ts} ${l.toUpperCase().padEnd(5)} ${e}${Object.keys(rest).length ? ' ' + JSON.stringify(rest) : ''}`;
  } else {
    line = JSON.stringify(entry);
  }
  (LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout).write(line + '\n');
}

export const logger = {
  debug: (event, fields) => write('debug', event, fields),
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields)
};
