import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const executable = resolve(root, 'dist', 'win-unpacked', 'ECHO NEXT.exe');
const modulePath = resolve(root, 'dist', 'win-unpacked', 'resources', 'app.asar', 'node_modules', 'better-sqlite3');
const marker = 'ECHO_PACKAGED_SQLITE_OK';
const probe = [
  `const Database = require(${JSON.stringify(modulePath)});`,
  `const db = new Database(':memory:');`,
  `if (db.prepare('SELECT 1 AS ok').get().ok !== 1) throw new Error('SQLite probe failed');`,
  `db.close();`,
  `console.log(${JSON.stringify(marker)});`,
].join('\n');
const result = spawnSync(executable, ['-e', probe], {
  cwd: root,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  windowsHide: true,
  timeout: 20_000,
});
if (result.error) throw result.error;
if (result.status !== 0 || !result.stdout.includes(marker)) {
  throw new Error(`Packaged SQLite failed to load in Electron:\n${result.stderr || result.stdout}`);
}
console.log('[verify:packaged-sqlite] Electron loaded the packaged native module and executed an in-memory query.');
