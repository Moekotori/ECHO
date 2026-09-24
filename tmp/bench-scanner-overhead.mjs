import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const bin = resolve('electron-app/build/echo-native-scanner.exe');
const exts = new Set(['.flac', '.mp3', '.wav', '.m4a', '.opus']);
const now = () => performance.now();

const makeLib = (files, dirs) => {
  const root = join(tmpdir(), `echo-oh-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  for (let d = 0; d < dirs; d += 1) {
    mkdirSync(join(root, `a${d}`), { recursive: true });
  }
  const e = ['.flac', '.mp3', '.wav', '.m4a', '.opus'];
  for (let i = 0; i < files; i += 1) {
    writeFileSync(join(root, `a${i % dirs}`, `t${i}${e[i % e.length]}`), 'x');
  }
  return root;
};

const scanNode = async (root) => {
  const stack = [resolve(root)];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = await readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(p);
      } else if (ent.isFile() && exts.has(extname(ent.name).toLowerCase())) {
        await stat(p);
      }
    }
  }
};

const scanNative = async (root) => {
  const t0 = now();
  const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '';
  let readyAt = null;
  let doneAt = null;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (readyAt == null && stdout.includes('"type":"ready"')) {
      readyAt = now();
    }
    if (doneAt == null && stdout.includes('"type":"done"')) {
      doneAt = now();
    }
  });
  child.stdin.end(
    `${JSON.stringify({
      type: 'scan',
      root: resolve(root),
      extensions: [...exts],
      batchSize: 256,
    })}\n`,
  );
  const code = await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', resolveExit);
  });
  const tExit = now();
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim()) {
      JSON.parse(line);
    }
  }
  const tEnd = now();
  return {
    code,
    total: tEnd - t0,
    ready: (readyAt ?? tExit) - t0,
    walk: (doneAt ?? tExit) - (readyAt ?? t0),
    parse: tEnd - tExit,
    bytes: Buffer.byteLength(stdout, 'utf8'),
  };
};

const avg = (xs) => xs.reduce((sum, x) => sum + x, 0) / xs.length;

const run = async (label, files, dirs, rounds) => {
  const root = makeLib(files, dirs);
  try {
    await scanNode(root);
    await scanNative(root);
    const nodeTimes = [];
    const nativeSamples = [];
    for (let i = 0; i < rounds; i += 1) {
      const a = now();
      await scanNode(root);
      nodeTimes.push(now() - a);
      nativeSamples.push(await scanNative(root));
    }
    const nodeAvg = avg(nodeTimes);
    const totalAvg = avg(nativeSamples.map((x) => x.total));
    const readyAvg = avg(nativeSamples.map((x) => x.ready));
    const walkAvg = avg(nativeSamples.map((x) => x.walk));
    const parseAvg = avg(nativeSamples.map((x) => x.parse));
    console.log(`--- ${label} (${files} files / ${dirs} dirs, n=${rounds}) ---`);
    console.log(`  node_avg_ms                 = ${nodeAvg.toFixed(2)}`);
    console.log(`  native_total_avg_ms         = ${totalAvg.toFixed(2)}  (speedup ${ (nodeAvg / totalAvg).toFixed(2) }x)`);
    console.log(`  native_spawn_to_ready_ms    = ${readyAvg.toFixed(2)}  << fixed process overhead`);
    console.log(`  native_ready_to_done_ms     = ${walkAvg.toFixed(2)}  << mostly pure C++ walk`);
    console.log(`  native_json_parse_ms        = ${parseAvg.toFixed(2)}`);
    console.log(`  if_compare_node_vs_cpp_walk = ${(nodeAvg / Math.max(0.1, walkAvg)).toFixed(2)}x  (ignore spawn)`);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  }
};

if (!existsSync(bin)) {
  throw new Error(`missing binary: ${bin}`);
}

await run('tiny', 50, 5, 5);
await run('small', 200, 10, 5);
await run('mid', 3000, 60, 3);
await run('deep', 5000, 500, 3);
