import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const hostPath = join(projectRoot, 'electron-app', 'build', 'echo-smtc-host.exe');

if (process.platform !== 'win32') {
  console.log('[smoke:smtc-host] Skipping Windows-only SMTC host smoke test on this platform.');
  process.exit(0);
}

if (!existsSync(hostPath)) {
  console.error(`[smoke:smtc-host] Missing ${hostPath}. Run npm run build:smtc-host first.`);
  process.exit(1);
}

const child = spawn(hostPath, [], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
});

child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

const send = (message) => {
  child.stdin.write(`${JSON.stringify(message)}\n`);
};

send({ type: 'setEnabledActions', play: true, pause: true, previous: true, next: true, seek: true });
send({
  type: 'setMetadata',
  title: 'ECHO Smoke Song',
  artist: 'ECHO Smoke Artist',
  album: 'Smoke Album',
  albumArtist: 'Smoke Album Artist',
  durationSeconds: 120,
  positionSeconds: 12,
  coverPath: null,
});
send({ type: 'setPlaybackState', state: 'playing' });
send({ type: 'setTimeline', positionSeconds: 13, durationSeconds: 120 });

setTimeout(() => send({ type: 'dispose' }), 500);
setTimeout(() => child.stdin.end(), 600);

try {
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('SMTC host smoke test timed out'));
    }, 5000);

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.on('error', reject);
  });

  if (result.code !== 0) {
    console.error(`[smoke:smtc-host] Host exited with code ${result.code ?? 'null'} signal ${result.signal ?? 'null'}.`);
    if (stdout.trim()) {
      console.error(`[smoke:smtc-host] stdout:\n${stdout}`);
    }
    if (stderr.trim()) {
      console.error(`[smoke:smtc-host] stderr:\n${stderr}`);
    }
    process.exit(1);
  }

  if (stderr.trim()) {
    console.error(`[smoke:smtc-host] Unexpected stderr:\n${stderr}`);
    process.exit(1);
  }

  if (stdout.includes('"type":"error"')) {
    console.error(`[smoke:smtc-host] Host reported an error:\n${stdout}`);
    process.exit(1);
  }

  if (stdout.trim()) {
    console.log(`[smoke:smtc-host] stdout:\n${stdout}`);
  }

  console.log('[smoke:smtc-host] PASS');
} catch (error) {
  console.error(`[smoke:smtc-host] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
