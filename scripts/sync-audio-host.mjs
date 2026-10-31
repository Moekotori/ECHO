import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const sourcePath = resolve(projectRoot, '..', 'ECHO', 'electron-app', 'build', 'echo-audio-host.exe');
const targetPath = resolve(projectRoot, 'electron-app', 'build', 'echo-audio-host.exe');
const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  if (!existsSync(targetPath)) {
    console.warn(
      `[sync:audio-host] echo-audio-host.exe is not present in ECHO Next. Run "npm run sync:audio-host" before native audio testing.`,
    );
  }
  process.exit(0);
}

if (!existsSync(sourcePath)) {
  console.error(`[sync:audio-host] Source host binary not found: ${sourcePath}`);
  console.error('[sync:audio-host] Build or restore old ECHO first, then rerun "npm run sync:audio-host".');
  process.exit(1);
}

mkdirSync(dirname(targetPath), { recursive: true });
copyFileSync(sourcePath, targetPath);

console.log(`[sync:audio-host] Copied ${sourcePath}`);
console.log(`[sync:audio-host]      -> ${targetPath}`);
