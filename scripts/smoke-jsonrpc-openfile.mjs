/**
 * Smoke test: JSON-RPC audio.openFile via --no-stdin over fd 3/4.
 *
 * Differences from smoke-jsonrpc-playfile.mjs:
 * - Method: audio.openFile (not audio.playFile)
 * - Expected response status: "ready" or "probed" (not "ok"/"playing")
 * - Watches for audio.position notifications on fd 4
 * - After ~5 seconds, kills gracefully (SIGTERM → SIGKILL)
 */
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const hostPath = join(projectRoot, 'electron-app', 'build', 'echo-audio-host');
const testFile = process.argv[2] || '/home/uright/Music/Solo/かめりあ/U.U.F.O/1-02 (The) Red  Room.m4a';

const fail = (msg) => { console.error(`\n[FAIL] ${msg}`); process.exit(1); };

if (!existsSync(hostPath)) fail(`Missing host: ${hostPath}`);
if (!existsSync(testFile)) fail(`Missing test file: ${testFile}`);

console.log(`[smoke:openfile] Host: ${hostPath}`);
console.log(`[smoke:openfile] File: ${testFile}\n`);

const child = spawn(hostPath, ['--no-stdin', '--rpc-stdin-fd', '3', '--rpc-stdout-fd', '4'], {
  cwd: projectRoot,
  stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
});

let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => { stderr += chunk; });

let stdoutText = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdoutText += chunk; });

const rpcIn = child.stdio[3];
const rpcOut = child.stdio[4];

let rpcBuf = '';
const rpcMsgs = [];
rpcOut.setEncoding('utf8');
rpcOut.on('data', (chunk) => {
  rpcBuf += chunk;
  while (rpcBuf.includes('\n')) {
    const idx = rpcBuf.indexOf('\n');
    const line = rpcBuf.slice(0, idx).trim();
    rpcBuf = rpcBuf.slice(idx + 1);
    if (!line) continue;
    try { rpcMsgs.push(JSON.parse(line)); } catch { rpcMsgs.push(line); }
  }
});

// Wait for host readiness (watch stderr for "awaiting" or "ready")
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout: host not ready')), 15000);
  const check = () => {
    if (stderr.includes('awaiting') || stderr.includes('ready')) {
      clearTimeout(timer);
      resolve();
    }
  };
  child.stderr.on('data', check);
  check();
});
console.log('[smoke:openfile] ✓ Host ready\n');

// Send openFile
const startTime = Date.now();
rpcIn.write(JSON.stringify({
  jsonrpc: '2.0',
  method: 'audio.openFile',
  params: [{ filePath: testFile }],
  id: 1,
}) + '\n');
console.log('[smoke:openfile] → audio.openFile sent');

// Wait for response
const response = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout waiting for response')), 20000);
  const check = () => {
    const m = rpcMsgs.find((x) => x && x.id === 1);
    if (m) { clearTimeout(timer); resolve(m); }
  };
  rpcOut.on('data', check);
  check();
});

if (response.error) fail(`openFile error: ${JSON.stringify(response.error, null, 2)}`);

const r = response.result;
console.log(`[smoke:openfile] ← response (${Date.now() - startTime}ms)`);
console.log(`  status:   ${r.status}`);
console.log(`  codec:    ${r.codec} (${r.container})`);
console.log(`  audio:    ${r.sampleRate} Hz, ${r.channels} ch, ${r.bitDepth} bit`);
console.log(`  duration: ${r.durationSeconds.toFixed(1)} s\n`);

// Validate
const errors = [];
if (r.status !== 'decoding') errors.push(`status=${r.status}`);
if (typeof r.filePath !== 'string' || r.filePath !== testFile) errors.push(`filePath=${r.filePath}`);
if (typeof r.codec !== 'string' || r.codec.length === 0) errors.push('missing codec');
if (typeof r.container !== 'string' || r.container.length === 0) errors.push('missing container');
if (!Number.isFinite(r.sampleRate) || r.sampleRate <= 0) errors.push(`sampleRate=${r.sampleRate}`);
if (!Number.isFinite(r.channels) || r.channels <= 0) errors.push(`channels=${r.channels}`);
if (!Number.isFinite(r.durationSeconds) || r.durationSeconds <= 0) errors.push(`durationSeconds=${r.durationSeconds}`);
if (r.operationId !== undefined && !Number.isFinite(r.operationId)) errors.push(`operationId=${r.operationId}`);
if (r.startSeconds !== undefined && (!Number.isFinite(r.startSeconds) || r.startSeconds < 0)) errors.push(`startSeconds=${r.startSeconds}`);
if (r.bitDepth !== undefined && (!Number.isFinite(r.bitDepth) || r.bitDepth <= 0)) errors.push(`bitDepth=${r.bitDepth}`);
if (r.bitrate !== undefined && (!Number.isFinite(r.bitrate) || r.bitrate <= 0)) errors.push(`bitrate=${r.bitrate}`);
if (errors.length > 0) fail(`Invalid JSON-RPC openFile response fields: ${errors.join('; ')}`);
console.log('[smoke:openfile] ✓ JSON-RPC openFile fields valid for libav daemon decode\n');

// Wait ~5 seconds and check for audio.position notifications
await new Promise((r) => setTimeout(r, 5000));

const posMsgs = rpcMsgs.filter((x) => x && x.method === 'audio.position');
const hasPositions = posMsgs.length > 0;

console.log(`[smoke:openfile] Activity check:`);
console.log(`  position notifications: ${hasPositions ? `✓ (${posMsgs.length})` : '✗'}`);
const alive = child.exitCode === null;
console.log(`  host alive:             ${alive ? `✓ (pid=${child.pid})` : `✗ exit=${child.exitCode}`}\n`);

if (hasPositions) {
  console.log('[smoke:openfile] ✓ Position notifications received');
} else {
  console.log('[smoke:openfile] ⚠ No position notifications (may be acceptable for openFile)\n');
}

if (!alive) fail(`Host crashed! exit=${child.exitCode}\nStderr tail:\n${stderr.slice(-600)}`);

// Shutdown: graceful SIGTERM, then SIGKILL after 3s
rpcIn.end();
child.kill('SIGTERM');
await new Promise((resolve) => {
  const t = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
  child.on('exit', () => { clearTimeout(t); resolve(); });
});

console.log(`\n[PASS] audio.openFile JSON-RPC smoke test`);
process.exit(0);
