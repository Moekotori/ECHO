/**
 * Realistic large-library stress: A1 session reuse + A3 timings + TS fallback.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  getNativeFileScannerDiagnostics,
  NativeFileScanner,
  NativeThenTsFileScanner,
} from '../src/main/library/workers/NativeFileScanner';
import { TsFileScanner } from '../src/main/library/workers/TsFileScanner';

const projectRoot = resolve(import.meta.dirname, '..');
const binaryName = process.platform === 'win32' ? 'echo-native-scanner.exe' : 'echo-native-scanner';
const binaryPath = resolve(projectRoot, 'electron-app/build', binaryName);

const FILE_COUNT = Math.max(1000, Number(process.env.ECHO_BENCH_SCAN_FILES ?? 12_000));
const DIR_COUNT = Math.max(20, Number(process.env.ECHO_BENCH_SCAN_DIRS ?? 240));
const NEST_DEPTH = Math.max(1, Number(process.env.ECHO_BENCH_NEST_DEPTH ?? 3));
const ROUNDS = Math.max(2, Number(process.env.ECHO_BENCH_ROUNDS ?? 3));

const extensions = ['.flac', '.mp3', '.wav', '.m4a', '.opus', '.ogg', '.aiff'] as const;
const nonAudio = ['cover.jpg', 'folder.png', 'readme.txt', 'desktop.ini'] as const;

const now = () => performance.now();
const pathKey = (p: string) => (process.platform === 'win32' ? resolve(p).toLocaleLowerCase() : resolve(p));

const createRealisticLibrary = () => {
  const root = join(tmpdir(), `echo-large-lib-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });

  let createdFiles = 0;
  let createdDirs = 0;

  for (let artist = 0; artist < DIR_COUNT; artist += 1) {
    let dir = root;
    for (let depth = 0; depth < NEST_DEPTH; depth += 1) {
      const segment =
        depth === 0
          ? `Artist ${String(artist + 1).padStart(3, '0')} 歌手`
          : depth === 1
            ? `Album ${String((artist % 40) + 1).padStart(2, '0')} — 专辑`
            : `disc-${depth}`;
      dir = join(dir, segment);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        createdDirs += 1;
      }
    }

    for (const name of nonAudio) {
      writeFileSync(join(dir, name), `noise-${name}`);
    }

    const tracksHere = Math.max(1, Math.floor(FILE_COUNT / DIR_COUNT));
    for (let t = 0; t < tracksHere && createdFiles < FILE_COUNT; t += 1) {
      const ext = extensions[(createdFiles + t) % extensions.length];
      const name = `${String(t + 1).padStart(2, '0')} - Track 曲目 ${createdFiles}${ext}`;
      writeFileSync(join(dir, name), `audio-placeholder-${createdFiles}-${'x'.repeat(64)}`);
      createdFiles += 1;
    }
  }

  while (createdFiles < FILE_COUNT) {
    const dir = join(root, '_overflow', `bucket-${createdFiles % 20}`);
    mkdirSync(dir, { recursive: true });
    const ext = extensions[createdFiles % extensions.length];
    writeFileSync(join(dir, `extra-${createdFiles}${ext}`), `x-${createdFiles}`);
    createdFiles += 1;
  }

  return { root, createdFiles, createdDirs };
};

const collect = async (iterable: AsyncIterable<{ path: string; sizeBytes: number; mtimeMs: number }>) => {
  const files: Array<{ path: string; sizeBytes: number; mtimeMs: number }> = [];
  for await (const file of iterable) {
    files.push(file);
  }
  return files;
};

const compareSets = (
  a: Array<{ path: string }>,
  b: Array<{ path: string }>,
) => {
  const aKeys = new Set(a.map((f) => pathKey(f.path)));
  const bKeys = new Set(b.map((f) => pathKey(f.path)));
  const missing = [...aKeys].filter((k) => !bKeys.has(k)).slice(0, 5);
  const extra = [...bKeys].filter((k) => !aKeys.has(k)).slice(0, 5);
  return {
    match: aKeys.size === bKeys.size && missing.length === 0 && extra.length === 0,
    aCount: aKeys.size,
    bCount: bKeys.size,
    missing,
    extra,
  };
};

const main = async () => {
  console.log(`[large-bench] binary=${binaryPath} exists=${existsSync(binaryPath)}`);
  if (!existsSync(binaryPath)) {
    throw new Error(`Native binary missing: ${binaryPath}`);
  }

  process.env.ECHO_NATIVE_SCANNER_PATH = binaryPath;
  process.env.ECHO_NATIVE_FILE_SCANNER = '1';
  delete process.env.ECHO_DISABLE_NATIVE_FILE_SCANNER;

  const { root, createdFiles, createdDirs } = createRealisticLibrary();
  console.log(
    `[large-bench] root=${root}\n` +
      `[large-bench] files=${createdFiles} artistFolders=${DIR_COUNT} nestDepth=${NEST_DEPTH} dirs≈${createdDirs} rounds=${ROUNDS}`,
  );

  const native = new NativeFileScanner({
    executablePath: binaryPath,
    idleTimeoutMs: 120_000,
  });
  const ts = new TsFileScanner();
  const wrapped = new NativeThenTsFileScanner(native, ts, console.warn, () => true);

  try {
    // Disk warm
    await collect(ts.scanFolder(root));

    const rounds: Array<Record<string, unknown>> = [];
    for (let round = 1; round <= ROUNDS; round += 1) {
      const t0 = now();
      const tsFiles = await collect(ts.scanFolder(root));
      const tsMs = now() - t0;

      const n0 = now();
      const nativeFiles = await collect(native.scanFolder(root));
      const nativeMs = now() - n0;

      const cmp = compareSets(tsFiles, nativeFiles);
      const diag = getNativeFileScannerDiagnostics(() => true);
      rounds.push({
        round,
        tsMs: +tsMs.toFixed(1),
        nativeMs: +nativeMs.toFixed(1),
        speedup: +(tsMs / Math.max(1, nativeMs)).toFixed(2),
        match: cmp.match,
        files: cmp.aCount,
        reused: diag.lastTiming?.reusedProcess ?? false,
        walkMs: diag.lastTiming?.walkMs ?? null,
        attachMs: diag.lastTiming?.spawnOrAttachMs ?? null,
        starts: diag.processStarts,
        reuses: diag.processReuses,
      });

      console.log(
        `[large-bench] round=${round} ts=${tsMs.toFixed(1)}ms native=${nativeMs.toFixed(1)}ms ` +
          `speedup=${(tsMs / Math.max(1, nativeMs)).toFixed(2)}x match=${cmp.match} files=${cmp.aCount} ` +
          `reused=${diag.lastTiming?.reusedProcess} walkMs=${diag.lastTiming?.walkMs?.toFixed(1)} ` +
          `attachMs=${diag.lastTiming?.spawnOrAttachMs.toFixed(1)} starts=${diag.processStarts} reuses=${diag.processReuses}`,
      );

      if (!cmp.match) {
        console.error('[large-bench] MISMATCH', cmp);
        process.exitCode = 1;
      }
    }

    // NativeThenTs happy path
    const w0 = now();
    const wrappedFiles = await collect(wrapped.scanFolder(root));
    const wrappedMs = now() - w0;
    const diagOk = getNativeFileScannerDiagnostics(() => true);
    console.log(
      `[large-bench] NativeThenTs ok files=${wrappedFiles.length} ms=${wrappedMs.toFixed(1)} ` +
        `fallbackToTs=${diagOk.fallbackToTs ?? 0} nativeScanOk=${diagOk.nativeScanOk ?? 0}`,
    );

    // Forced fallback: broken executable path
    const broken = new NativeFileScanner({
      executablePath: join(projectRoot, 'definitely-missing-echo-native-scanner.exe'),
      idleTimeoutMs: 0,
    });
    let fallbackLogged = false;
    const fallbackWrapper = new NativeThenTsFileScanner(
      broken,
      ts,
      (msg) => {
        fallbackLogged = true;
        console.log(`[large-bench] fallback-log: ${msg}`);
      },
      () => true,
    );
    const fb0 = now();
    const fbFiles = await collect(fallbackWrapper.scanFolder(root));
    const fbMs = now() - fb0;
    const fbCmp = compareSets(wrappedFiles, fbFiles);
    console.log(
      `[large-bench] FALLBACK_TS files=${fbFiles.length} ms=${fbMs.toFixed(1)} match=${fbCmp.match} logged=${fallbackLogged}`,
    );
    if (!fbCmp.match || !fallbackLogged) {
      console.error('[large-bench] FALLBACK failed', { fbCmp, fallbackLogged });
      process.exitCode = 1;
    }
    broken.dispose();

    console.log('[large-bench] SUMMARY', JSON.stringify({ fileCount: createdFiles, rounds, fallbackOk: fbCmp.match && fallbackLogged }, null, 2));
  } finally {
    native.dispose();
    wrapped.dispose();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    console.log('[large-bench] cleaned');
  }
};

main().catch((error) => {
  console.error('[large-bench] FATAL', error);
  process.exitCode = 1;
});
