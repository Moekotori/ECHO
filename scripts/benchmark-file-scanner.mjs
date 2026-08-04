import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const nativeScannerName = process.platform === 'win32' ? 'echo-native-scanner.exe' : 'echo-native-scanner';
const nativeScannerPath = resolve(process.env.ECHO_NATIVE_SCANNER_PATH || join(projectRoot, 'electron-app', 'build', nativeScannerName));
const syntheticFileCount = Math.max(1, Number(process.env.ECHO_BENCH_SCAN_FILES ?? 1200));
const syntheticDirectoryCount = Math.max(1, Number(process.env.ECHO_BENCH_SCAN_DIRS ?? 24));
const sampleLimit = 10;

const audioExtensions = [
  '.mp3',
  '.flac',
  '.wav',
  '.m4a',
  '.m4p',
  '.aac',
  '.ogg',
  '.opus',
  '.wma',
  '.alac',
  '.aiff',
  '.aif',
  '.ape',
  '.wv',
  '.tta',
  '.tak',
  '.caf',
  '.dsf',
  '.dff',
  '.mka',
  '.mkv',
  '.mp4',
  '.mov',
  '.webm',
  '.mp2',
  '.mp1',
  '.mpc',
  '.ofr',
  '.ofs',
  '.spx',
  '.amr',
  '.ac3',
  '.eac3',
  '.ec3',
  '.dd',
  '.ddp',
  '.thd',
  '.truehd',
  '.mlp',
  '.ac4',
  '.dts',
  '.ncm',
  '.kgm',
  '.kgma',
];

const audioExtensionSet = new Set(audioExtensions);

const nowMs = () => performance.now();

const measure = async (work) => {
  const startedAt = nowMs();
  const result = await work();
  return { result, durationMs: nowMs() - startedAt };
};

const pathKey = (filePath) => (process.platform === 'win32' ? resolve(filePath).toLocaleLowerCase() : resolve(filePath));

const scanWithNode = async (root) => {
  const files = [];
  const snapshots = [];
  const stack = [resolve(root)];
  let directories = 0;

  while (stack.length > 0) {
    const directory = stack.pop();
    directories += 1;
    const directoryStats = await stat(directory);
    const entries = await readdir(directory, { withFileTypes: true });
    const snapshotEntries = [];

    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        snapshotEntries.push({ name: entry.name, kind: 'directory' });
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = extname(entry.name).toLocaleLowerCase();
      if (!audioExtensionSet.has(extension)) {
        continue;
      }
      snapshotEntries.push({ name: entry.name, kind: 'file' });
      const fileStats = await stat(entryPath);
      files.push({
        path: resolve(entryPath),
        sizeBytes: fileStats.size,
        mtimeMs: Math.round(fileStats.mtimeMs),
      });
    }

    snapshots.push({
      path: directory,
      mtimeMs: Math.round(directoryStats.mtimeMs),
      entries: snapshotEntries,
    });
  }

  return { files, snapshots, directories };
};

const scanWithNative = async (root) => {
  if (!existsSync(nativeScannerPath)) {
    throw new Error(`Native scanner binary not found: ${nativeScannerPath}`);
  }

  const child = spawn(nativeScannerPath, [], {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const files = [];
  const snapshots = [];
  const errors = [];
  let progress = { directories: 0, files: 0 };
  let stdout = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(`${JSON.stringify({
    type: 'scan',
    root: resolve(root),
    extensions: audioExtensions,
    batchSize: 256,
  })}\n`);

  const processStartedAt = nowMs();
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code) => resolveExit(code));
  });
  const processDurationMs = nowMs() - processStartedAt;

  const parseStartedAt = nowMs();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const message = JSON.parse(line);
    if (message.type === 'batch' && Array.isArray(message.items)) {
      for (const item of message.items) {
        files.push({
          path: resolve(String(item.path)),
          sizeBytes: Number(item.sizeBytes),
          mtimeMs: Math.round(Number(item.mtimeMs)),
        });
      }
      continue;
    }
    if (message.type === 'directorySnapshot') {
      snapshots.push({
        path: resolve(String(message.path)),
        mtimeMs: Math.round(Number(message.mtimeMs)),
        entries: Array.isArray(message.entries) ? message.entries : [],
      });
      continue;
    }
    if (message.type === 'progress') {
      progress = {
        directories: Number(message.directories ?? progress.directories),
        files: Number(message.files ?? progress.files),
      };
      continue;
    }
    if (message.type === 'error') {
      errors.push(message);
    }
  }

  if (exitCode !== 0) {
    throw new Error(`Native scanner exited with ${exitCode}; stderr=${stderr.trim()}`);
  }

  return {
    files,
    snapshots,
    errors,
    progress,
    processDurationMs,
    parseDurationMs: nowMs() - parseStartedAt,
    stdoutBytes: Buffer.byteLength(stdout, 'utf8'),
  };
};

const createSyntheticLibrary = () => {
  const root = join(tmpdir(), `echo-next-scanner-bench-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const extensions = ['.flac', '.mp3', '.wav', '.m4a', '.opus', '.jpg'];
  mkdirSync(root, { recursive: true });

  for (let directoryIndex = 0; directoryIndex < syntheticDirectoryCount; directoryIndex += 1) {
    const directory = join(root, `album-${String(directoryIndex + 1).padStart(3, '0')}`);
    mkdirSync(directory, { recursive: true });
  }

  for (let index = 0; index < syntheticFileCount; index += 1) {
    const directory = join(root, `album-${String((index % syntheticDirectoryCount) + 1).padStart(3, '0')}`);
    const extension = extensions[index % extensions.length];
    const fileName = `track-${String(index + 1).padStart(5, '0')}${extension}`;
    writeFileSync(join(directory, fileName), extension === '.jpg' ? 'cover' : `audio-${index}`);
  }

  return root;
};

const compareResults = (nodeFiles, nativeFiles) => {
  const nodeKeys = new Set(nodeFiles.map((file) => pathKey(file.path)));
  const nativeKeys = new Set(nativeFiles.map((file) => pathKey(file.path)));
  const missingFromNative = [...nodeKeys].filter((key) => !nativeKeys.has(key)).slice(0, sampleLimit);
  const extraFromNative = [...nativeKeys].filter((key) => !nodeKeys.has(key)).slice(0, sampleLimit);

  return {
    matches: nodeKeys.size === nativeKeys.size && missingFromNative.length === 0 && extraFromNative.length === 0,
    missingFromNative,
    extraFromNative,
  };
};

const snapshotEntryKey = (entry) => `${entry.kind}:${entry.name}`;

const compareSnapshots = (nodeSnapshots, nativeSnapshots) => {
  const nodeByPath = new Map(nodeSnapshots.map((snapshot) => [pathKey(snapshot.path), snapshot]));
  const nativeByPath = new Map(nativeSnapshots.map((snapshot) => [pathKey(snapshot.path), snapshot]));
  const missingFromNative = [...nodeByPath.keys()].filter((key) => !nativeByPath.has(key)).slice(0, sampleLimit);
  const extraFromNative = [...nativeByPath.keys()].filter((key) => !nodeByPath.has(key)).slice(0, sampleLimit);
  const entryMismatches = [];
  const mtimeMismatches = [];

  for (const [key, nodeSnapshot] of nodeByPath) {
    const nativeSnapshot = nativeByPath.get(key);
    if (!nativeSnapshot) {
      continue;
    }

    const nodeEntries = new Set(nodeSnapshot.entries.map(snapshotEntryKey));
    const nativeEntries = new Set(nativeSnapshot.entries.map(snapshotEntryKey));
    const missingEntries = [...nodeEntries].filter((entry) => !nativeEntries.has(entry));
    const extraEntries = [...nativeEntries].filter((entry) => !nodeEntries.has(entry));
    if (missingEntries.length > 0 || extraEntries.length > 0) {
      entryMismatches.push({
        path: nodeSnapshot.path,
        missingEntries: missingEntries.slice(0, sampleLimit),
        extraEntries: extraEntries.slice(0, sampleLimit),
      });
      if (entryMismatches.length >= sampleLimit) {
        break;
      }
    }

    if (Math.abs(Number(nodeSnapshot.mtimeMs) - Number(nativeSnapshot.mtimeMs)) > 2) {
      mtimeMismatches.push({
        path: nodeSnapshot.path,
        nodeMtimeMs: nodeSnapshot.mtimeMs,
        nativeMtimeMs: nativeSnapshot.mtimeMs,
      });
      if (mtimeMismatches.length >= sampleLimit) {
        break;
      }
    }
  }

  return {
    matches:
      nodeByPath.size === nativeByPath.size &&
      missingFromNative.length === 0 &&
      extraFromNative.length === 0 &&
      entryMismatches.length === 0 &&
      mtimeMismatches.length === 0,
    missingFromNative,
    extraFromNative,
    entryMismatches,
    mtimeMismatches,
  };
};

const printSummary = ({ root, synthetic, nodeScan, nativeScan, comparison }) => {
  console.log(`[benchmark:file-scanner] root: ${root}`);
  console.log(`[benchmark:file-scanner] source: ${synthetic ? 'synthetic' : 'provided'}`);
  console.log(`[benchmark:file-scanner] native binary: ${nativeScannerPath}`);
  console.log(`[benchmark:file-scanner] node files/directories/snapshots: ${nodeScan.result.files.length}/${nodeScan.result.directories}/${nodeScan.result.snapshots.length}`);
  console.log(`[benchmark:file-scanner] native files/snapshots/errors: ${nativeScan.result.files.length}/${nativeScan.result.snapshots.length}/${nativeScan.result.errors.length}`);
  console.log(`[benchmark:file-scanner] node duration: ${nodeScan.durationMs.toFixed(2)} ms`);
  console.log(`[benchmark:file-scanner] native duration: ${nativeScan.durationMs.toFixed(2)} ms`);
  console.log(`[benchmark:file-scanner] native process/parse/stdout: ${nativeScan.result.processDurationMs.toFixed(2)} ms / ${nativeScan.result.parseDurationMs.toFixed(2)} ms / ${nativeScan.result.stdoutBytes} bytes`);
  console.log(`[benchmark:file-scanner] speedup: ${(nodeScan.durationMs / Math.max(1, nativeScan.durationMs)).toFixed(2)}x`);
  console.log(`[benchmark:file-scanner] file output match: ${comparison.files.matches ? 'yes' : 'no'}`);
  console.log(`[benchmark:file-scanner] snapshot output match: ${comparison.snapshots.matches ? 'yes' : 'no'}`);
  if (!comparison.files.matches) {
    console.log(`[benchmark:file-scanner] files missing from native sample: ${JSON.stringify(comparison.files.missingFromNative)}`);
    console.log(`[benchmark:file-scanner] files extra from native sample: ${JSON.stringify(comparison.files.extraFromNative)}`);
  }
  if (!comparison.snapshots.matches) {
    console.log(`[benchmark:file-scanner] snapshots missing from native sample: ${JSON.stringify(comparison.snapshots.missingFromNative)}`);
    console.log(`[benchmark:file-scanner] snapshots extra from native sample: ${JSON.stringify(comparison.snapshots.extraFromNative)}`);
    console.log(`[benchmark:file-scanner] snapshot entry mismatch sample: ${JSON.stringify(comparison.snapshots.entryMismatches)}`);
    console.log(`[benchmark:file-scanner] snapshot mtime mismatch sample: ${JSON.stringify(comparison.snapshots.mtimeMismatches)}`);
  }
};

const providedRoot = process.argv[2] ? resolve(process.argv[2]) : null;
const synthetic = !providedRoot;
const root = providedRoot ?? createSyntheticLibrary();

try {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Benchmark root is not a directory: ${root}`);
  }

  const nodeScan = await measure(() => scanWithNode(root));
  const nativeScan = await measure(() => scanWithNative(root));
  const comparison = {
    files: compareResults(nodeScan.result.files, nativeScan.result.files),
    snapshots: compareSnapshots(nodeScan.result.snapshots, nativeScan.result.snapshots),
  };
  printSummary({ root, synthetic, nodeScan, nativeScan, comparison });

  if (!comparison.files.matches || !comparison.snapshots.matches) {
    process.exitCode = 1;
  }
} finally {
  if (synthetic) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}
