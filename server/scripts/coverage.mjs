// Cobertura para SonarQube: corre las pruebas con el runner de Node y deja
// server/coverage/lcov.info con rutas relativas a la raíz del repo
// (server/src/...), que es desde donde analiza sonar-project.properties.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(serverDir, 'coverage');
const lcov = path.join(outDir, 'lcov.info');
fs.mkdirSync(outDir, { recursive: true });

const tests = fs.readdirSync(path.join(serverDir, 'test'))
  .filter(f => f.endsWith('.test.js'))
  .map(f => path.join('test', f));

const result = spawnSync(process.execPath, [
  '--test', '--experimental-test-coverage',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=lcov', `--test-reporter-destination=${lcov}`,
  ...tests
], { cwd: serverDir, stdio: 'inherit' });

const fixed = fs.readFileSync(lcov, 'utf8').replace(/^SF:(?!server[\\/])/gm, 'SF:server/').replace(/\\/g, '/');
fs.writeFileSync(lcov, fixed);
console.log(`\nCobertura escrita en ${path.relative(process.cwd(), lcov)}`);
process.exit(result.status ?? 1);
