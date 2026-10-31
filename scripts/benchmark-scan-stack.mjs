/**
 * P0: discover-phase stack bench — TS vs Native, cold first scan + warm second (with snapshots).
 *
 * Usage:
 *   node scripts/benchmark-scan-stack.mjs
 *   ECHO_BENCH_SCAN_FILES=10000 ECHO_BENCH_SCAN_DIRS=200 node scripts/benchmark-scan-stack.mjs
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getNativeFileScannerDiagnostics,
  NativeFileScanner,
} from '../src/main/library/workers/NativeFileScanner.ts';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binaryName = process.platform === 'win32' ? 'echo-native-scanner.exe' : 'echo-native-scanner';
const binaryPath = resolve(projectRoot, 'electron-app/build', binaryName);

const FILE_COUNT = Math.max(500, Number(process.env.ECHO_BENCH_SCAN_FILES ?? 8000));
const DIR_COUNT = Math.max(20, Number(process.env.ECHO_BENCH_SCAN_DIRS ?? 160));
const audioExtensions = ['.flac', '.mp3', '.wav', '.m4a', '.opus', '.ogg'];
const audioSet = new Set(audioExtensions);

const now = () => performance.now();
const pathKey = (p) => (process.platform === 'win32' ? resolve(p).toLocaleLowerCase() : resolve(p));

const createLibrary = () => {
  const root = join(tmpdir(), `echo-stack-bench-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  let files = 0;
  for (let a = 0; a < DIR_COUNT; a += 1) {
    const artist = join(root, `Artist ${String(a + 1).padStart(3, '0')} 歌手`);
    const album = join(artist, `Album ${(a % 20) + 1} 专辑`);
    mkdirSync(album, { recursive: true });
    writeFileSync(join(album, 'cover.jpg'), 'jpg');
    const per = Math.max(1, Math.floor(FILE_COUNT / DIR_COUNT));
    for (let t = 0; t < per && files < FILE_COUNT; t += 1) {
      const ext = audioExtensions[files % audioExtensions.length];
      writeFileSync(join(album, `${String(t + 1).padStart(2, '0')} - track ${files}${ext}`), `x${files}`);
      files += 1;
    }
  }
  while (files < FILE_COUNT) {
    const dir = join(root, '_extra', `b${files % 10}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `e${files}.flac`), 'x');
    files += 1;
  }
  return { root, files };
};

/** TS-style walk with optional snapshot skip (mirrors TsFileScanner). */
const scanTs = async (root, { getDirectorySnapshot, onDirectorySnapshot } = {}) => {
  const files = [];
  const snapshots = [];
  let dirsVisited = 0;
  let dirsSkipped = 0;

  const walk = async (directoryPath) => {
    dirsVisited += 1;
    const directoryStats = await stat(directoryPath);
    if (!directoryStats.isDirectory()) {
      return;
    }
    const directoryMtimeMs = Math.round(directoryStats.mtimeMs);
    const snapshot = getDirectorySnapshot?.(directoryPath) ?? null;
    if (snapshot && snapshot.mtimeMs === directoryMtimeMs && Array.isArray(snapshot.entries)) {
      dirsSkipped += 1;
      for (const entry of snapshot.entries) {
        const entryPath = join(directoryPath, entry.name);
        if (entry.kind === 'directory') {
          await walk(entryPath);
          continue;
        }
        const fileStats = await stat(entryPath);
        files.push({
          path: resolve(entryPath),
          sizeBytes: fileStats.size,
          mtimeMs: Math.round(fileStats.mtimeMs),
        });
      }
      return;
    }

    const entries = await readdir(directoryPath, { withFileTypes: true });
    const snapshotEntries = [];
    for (const entry of entries) {
      const entryPath = join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        snapshotEntries.push({ name: entry.name, kind: 'directory' });
        await walk(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = extname(entry.name).toLowerCase();
      if (!audioSet.has(extension)) {
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
    const nextSnapshot = { path: resolve(directoryPath), mtimeMs: directoryMtimeMs, entries: snapshotEntries };
    snapshots.push(nextSnapshot);
    onDirectorySnapshot?.(nextSnapshot);
  };

  await walk(resolve(root));
  return { files, snapshots, dirsVisited, dirsSkipped };
};

const collect = async (iterable) => {
  const files = [];
  for await (const file of iterable) {
    files.push(file);
  }
  return files;
};

const compare = (a, b) => {
  const ak = new Set(a.map((f) => pathKey(f.path)));
  const bk = new Set(b.map((f) => pathKey(f.path)));
  return {
    match: ak.size === bk.size && [...ak].every((k) => bk.has(k)),
    a: ak.size,
    b: bk.size,
  };
};

const main = async () => {
  console.log(`[scan-stack] binary=${binaryPath} exists=${existsSync(binaryPath)}`);
  if (!existsSync(binaryPath)) {
    throw new Error('native binary missing — run npm run build:native-scanner');
  }

  process.env.ECHO_NATIVE_SCANNER_PATH = binaryPath;
  const { root, files: created } = createLibrary();
  console.log(`[scan-stack] library files=${created} dirs≈${DIR_COUNT} root=${root}`);

  const native = new NativeFileScanner({ executablePath: binaryPath, idleTimeoutMs: 120_000 });
  const snapshotStore = new Map();

  try {
    // --- Cold first scan ---
    const tTs1 = now();
    const ts1 = await scanTs(root);
    const ts1Ms = now() - tTs1;

    const nativeSnaps1 = [];
    const tN1 = now();
    const nativeFiles1 = await collect(
      native.scanFolder(root, {
        getDirectorySnapshot: () => null,
        onDirectorySnapshot: (s) => {
          nativeSnaps1.push(s);
          snapshotStore.set(pathKey(s.path), s);
        },
      }),
    );
    const n1Ms = now() - tN1;
    // Also store TS snapshots for fair second-scan compare
    for (const s of ts1.snapshots) {
      if (!snapshotStore.has(pathKey(s.path))) {
        snapshotStore.set(pathKey(s.path), s);
      }
    }
    // Prefer native-produced snapshots for second native pass
    for (const s of nativeSnaps1) {
      snapshotStore.set(pathKey(s.path), s);
    }

    const c1 = compare(ts1.files, nativeFiles1);
    console.log(
      `[scan-stack] FIRST  ts=${ts1Ms.toFixed(1)}ms native=${n1Ms.toFixed(1)}ms speedup=${(ts1Ms / Math.max(1, n1Ms)).toFixed(2)}x ` +
        `files=${c1.a}/${c1.b} match=${c1.match} mode=${getNativeFileScannerDiagnostics(() => true).lastTiming?.mode}`,
    );

    // --- Warm second scan (snapshots available) ---
    const getSnap = (directoryPath) => snapshotStore.get(pathKey(directoryPath)) ?? null;

    const tTs2 = now();
    const ts2 = await scanTs(root, { getDirectorySnapshot: getSnap });
    const ts2Ms = now() - tTs2;

    const tN2 = now();
    const nativeFiles2 = await collect(
      native.scanFolder(root, {
        getDirectorySnapshot: getSnap,
        onDirectorySnapshot: (s) => snapshotStore.set(pathKey(s.path), s),
      }),
    );
    const n2Ms = now() - tN2;
    const c2 = compare(ts2.files, nativeFiles2);
    const diag = getNativeFileScannerDiagnostics(() => true);

    console.log(
      `[scan-stack] SECOND ts=${ts2Ms.toFixed(1)}ms native=${n2Ms.toFixed(1)}ms speedup=${(ts2Ms / Math.max(1, n2Ms)).toFixed(2)}x ` +
        `files=${c2.a}/${c2.b} match=${c2.match} ` +
        `tsSkip=${ts2.dirsSkipped}/${ts2.dirsVisited} ` +
        `nativeTiming=${JSON.stringify({
          mode: diag.lastTiming?.mode,
          snapshotDirsSkipped: diag.lastTiming?.snapshotDirsSkipped,
          dirtyNativeSubtrees: diag.lastTiming?.dirtyNativeSubtrees,
          walkMs: diag.lastTiming?.walkMs,
        })}`,
    );

    console.log(
      '[scan-stack] SUMMARY',
      JSON.stringify(
        {
          fileCount: created,
          first: { tsMs: +ts1Ms.toFixed(1), nativeMs: +n1Ms.toFixed(1), speedup: +(ts1Ms / Math.max(1, n1Ms)).toFixed(2), match: c1.match },
          second: {
            tsMs: +ts2Ms.toFixed(1),
            nativeMs: +n2Ms.toFixed(1),
            speedup: +(ts2Ms / Math.max(1, n2Ms)).toFixed(2),
            match: c2.match,
            nativeMode: diag.lastTiming?.mode,
            snapshotDirsSkipped: diag.lastTiming?.snapshotDirsSkipped,
            dirtyNativeSubtrees: diag.lastTiming?.dirtyNativeSubtrees,
          },
        },
        null,
        2,
      ),
    );

    if (!c1.match || !c2.match) {
      process.exitCode = 1;
    }
  } finally {
    native.dispose?.();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
};

main().catch((error) => {
  console.error('[scan-stack] FATAL', error);
  process.exitCode = 1;
});
