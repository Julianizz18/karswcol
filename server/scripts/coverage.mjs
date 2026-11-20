// Cobertura para SonarCloud/SonarQube: corre las pruebas (servidor y cliente)
// con el runner de Node y deja server/coverage/lcov.info con rutas relativas
// a la raíz del repo (server/src/..., client/js/...), que es desde donde
// analiza sonar-project.properties.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.join(serverDir, '..');
const outDir = path.join(serverDir, 'coverage');
const lcov = path.join(outDir, 'lcov.info');
fs.mkdirSync(outDir, { recursive: true });

const tests = fs.readdirSync(path.join(serverDir, 'test'))
  .filter(f => f.endsWith('.test.js'))
  .map(f => path.join('test', f));

const result = spawnSync(process.execPath, [
  '--test', '--experimental-test-coverage', '--test-timeout=60000',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=lcov', `--test-reporter-destination=${lcov}`,
  ...tests
], { cwd: serverDir, stdio: 'inherit' });

// Las pruebas del servidor dejan rutas relativas a server/ y las del cliente
// (ejecutadas en jsdom) rutas absolutas: todas pasan a ser relativas a la raíz.
const toRepoPath = file => {
  const absolute = path.isAbsolute(file) ? file : path.join(serverDir, file);
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
};
const fixed = fs.readFileSync(lcov, 'utf8').replace(/^SF:(.*)$/gm, (_, file) => `SF:${toRepoPath(file)}`);
fs.writeFileSync(lcov, fixed);
console.log(`\nCobertura escrita en ${path.relative(process.cwd(), lcov)}`);
process.exit(result.status ?? 1);
