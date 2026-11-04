// Pruebas de aceptación contra PostgreSQL REAL (mocks de Prisma no demuestran bloqueos).
//
//   ACCEPTANCE_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/stella_acceptance_test npm run test:acceptance [filtro]
//
// Usa node:test sobre JS compilado: NestJS 12 se publica como ESM y Jest no lo carga en este proyecto.
// La base debe ser local y su nombre debe contener "test": se BORRA por completo en cada corrida.
const { execFileSync, spawnSync } = require('node:child_process');
const { cpSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const globalSetup = require('./support/global-setup.js');

const cwd = join(__dirname, '..', '..');
const out = join(cwd, 'dist-acceptance');
const filter = process.argv[2];

(async () => {
  execFileSync(process.execPath, [join(cwd, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'test/acceptance/tsconfig.json'], { cwd, stdio: 'inherit' });
  cpSync(join(cwd, 'src', 'i18n', 'locales'), join(out, 'src', 'i18n', 'locales'), { recursive: true });
  await globalSetup();

  const dir = join(out, 'test', 'acceptance');
  const specs = readdirSync(dir)
    .filter((f) => f.endsWith('.spec.js') && (!filter || f.includes(filter)))
    .sort()
    .map((f) => join(dir, f));
  if (specs.length === 0) throw new Error(`Sin pruebas para el filtro "${filter}"`);

  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=spec', ...specs], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(result.status ?? 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
