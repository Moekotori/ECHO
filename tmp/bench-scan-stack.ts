/**
 * P0+P1: first vs second discover (TS / Native incremental).
 * npx tsx tmp/bench-scan-stack.ts
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import {
  getNativeFileScannerDiagnostics,
  NativeFileScanner,
} from '../src/main/library/workers/NativeFileScanner';
import { TsFileScanner } from '../src/main/library/workers/TsFileScanner';
import type { ScanDirectorySnapshot, ScannedFile } from '../src/main/library/libraryTypes';

const projectRoot = resolve(import.meta.dirname, '..');
const binaryPath = resolve(
  projectRoot,
  'electron-app/build',
  process.platform === 'win32' ? 'echo-native-scanner.exe' : 'echo-native-scanner',
);

const FILE_COUNT = Math.max(500, Number(process.env.ECHO_BENCH_SCAN_FILES ?? 8000));
const DIR_COUNT = Math.max(20, Number(process.env.ECHO_BENCH_SCAN_DIRS ?? 160));
const audioExtensions = ['.flac', '.mp3', '.wav', '.m4a', '.opus', '.ogg'];

const now = () => performance.now();
const pathKey = (p: string) => (process.platform === 'win32' ? resolve(p).toLocaleLowerCase() : resolve(p));

const createLibrary = () => {
  const root = join(tmpdir(), `echo-stack-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  let files = 0;
  for (let a = 0; a < DIR_COUNT; a += 1) {
    const album = join(root, `Artist ${String(a + 1).padStart(3, '0')} 歌手`, `Album ${(a % 20) + 1} 专辑`);
    mkdirSync(album, { recursive: true });
    writeFileSync(join(album, 'cover.jpg'), 'jpg');
    const per = Math.max(1, Math.floor(FILE_COUNT / DIR_COUNT));
    for (let t = 0; t < per && files < FILE_COUNT; t += 1) {
      const ext = audioExtensions[files % audioExtensions.length];
      writeFileSync(join(album, `${String(t + 1).padStart(2, '0')} - track ${files}${ext}`), `x${files}`);
      files += 1;
    }
  }
  return { root, files };
};

const collect = async (iterable: AsyncIterable<ScannedFile>) => {
  const out: ScannedFile[] = [];
  for await (const file of iterable) {
    out.push(file);
  }
  return out;
};

const compare = (a: ScannedFile[], b: ScannedFile[]) => {
  const ak = new Set(a.map((f) => pathKey(f.path)));
  const bk = new Set(b.map((f) => pathKey(f.path)));
  return { match: ak.size === bk.size && [...ak].every((k) => bk.has(k)), a: ak.size, b: bk.size };
};

const main = async () => {
  if (!existsSync(binaryPath)) {
    throw new Error(`missing binary ${binaryPath}`);
  }
  process.env.ECHO_NATIVE_SCANNER_PATH = binaryPath;

  const { root, files: created } = createLibrary();
  console.log(`[scan-stack] files=${created} dirs=${DIR_COUNT} root=${root}`);

  const tsScanner = new TsFileScanner();
  const native = new NativeFileScanner({ executablePath: binaryPath, idleTimeoutMs: 120_000 });
  const store = new Map<string, ScanDirectorySnapshot>();

  try {
    // FIRST — no snapshots
    const t0 = now();
    const ts1 = await collect(tsScanner.scanFolder(root, {
      onDirectorySnapshot: (s) => store.set(pathKey(s.path), s),
    }));
    const ts1Ms = now() - t0;

    store.clear();
    const t1 = now();
    const n1 = await collect(native.scanFolder(root, {
      getDirectorySnapshot: () => null,
      onDirectorySnapshot: (s) => store.set(pathKey(s.path), s),
    }));
    const n1Ms = now() - t1;
    const c1 = compare(ts1, n1);
    console.log(
      `[scan-stack] FIRST  ts=${ts1Ms.toFixed(1)}ms native=${n1Ms.toFixed(1)}ms ` +
        `speedup=${(ts1Ms / Math.max(1, n1Ms)).toFixed(2)}x match=${c1.match} files=${c1.a} ` +
        `mode=${getNativeFileScannerDiagnostics(() => true).lastTiming?.mode}`,
    );

    // Ensure store has snapshots from native first pass
    // SECOND — with snapshots
    const getSnap = (p: string) => store.get(pathKey(p)) ?? null;

    const t2 = now();
    const ts2 = await collect(tsScanner.scanFolder(root, { getDirectorySnapshot: getSnap }));
    const ts2Ms = now() - t2;

    const t3 = now();
    const n2 = await collect(native.scanFolder(root, {
      getDirectorySnapshot: getSnap,
      onDirectorySnapshot: (s) => store.set(pathKey(s.path), s),
    }));
    const n2Ms = now() - t3;
    const c2 = compare(ts2, n2);
    const diag = getNativeFileScannerDiagnostics(() => true);

    console.log(
      `[scan-stack] SECOND ts=${ts2Ms.toFixed(1)}ms native=${n2Ms.toFixed(1)}ms ` +
        `speedup=${(ts2Ms / Math.max(1, n2Ms)).toFixed(2)}x match=${c2.match} files=${c2.a} ` +
        `mode=${diag.lastTiming?.mode} skipped=${diag.lastTiming?.snapshotDirsSkipped} dirty=${diag.lastTiming?.dirtyNativeSubtrees}`,
    );

    console.log('[scan-stack] SUMMARY', JSON.stringify({
      created,
      first: { tsMs: +ts1Ms.toFixed(1), nativeMs: +n1Ms.toFixed(1), speedup: +(ts1Ms / Math.max(1, n1Ms)).toFixed(2), match: c1.match },
      second: {
        tsMs: +ts2Ms.toFixed(1),
        nativeMs: +n2Ms.toFixed(1),
        speedup: +(ts2Ms / Math.max(1, n2Ms)).toFixed(2),
        match: c2.match,
        snapshotDirsSkipped: diag.lastTiming?.snapshotDirsSkipped,
        dirtyNativeSubtrees: diag.lastTiming?.dirtyNativeSubtrees,
      },
    }, null, 2));

    if (!c1.match || !c2.match) {
      process.exitCode = 1;
    }
  } finally {
    native.dispose();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 });
  }
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
