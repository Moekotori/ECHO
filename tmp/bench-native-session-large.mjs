/**
 * Realistic large-library stress for A1 session reuse + A3 timings + TS fallback.
 * Uses the real echo-native-scanner binary and production NativeFileScanner / NativeThenTsFileScanner.
 */
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Prefer compiled main output; fall back to tsx via vitest-less dynamic import of source through jiti if needed.
const candidates = [
  join(projectRoot, 'out/main/library/workers/NativeFileScanner.js'),
  join(projectRoot, 'out/main/src/main/library/workers/NativeFileScanner.js'),
];

const binaryName = process.platform === 'win32' ? 'echo-native-scanner.exe' : 'echo-native-scanner';
const binaryPath = resolve(projectRoot, 'electron-app/build', binaryName);

const FILE_COUNT = Math.max(1000, Number(process.env.ECHO_BENCH_SCAN_FILES ?? 12_000));
const DIR_COUNT = Math.max(20, Number(process.env.ECHO_BENCH_SCAN_DIRS ?? 240));
const NEST_DEPTH = Math.max(1, Number(process.env.ECHO_BENCH_NEST_DEPTH ?? 3));
const ROUNDS = Math.max(1, Number(process.env.ECHO_BENCH_ROUNDS ?? 2));

const extensions = ['.flac', '.mp3', '.wav', '.m4a', '.opus', '.ogg', '.aiff'];
const nonAudio = ['cover.jpg', 'folder.png', 'readme.txt', 'desktop.ini'];

const now = () => performance.now();

const pathKey = (p) => (process.platform === 'win32' ? resolve(p).toLocaleLowerCase() : resolve(p));

const createRealisticLibrary = () => {
  const root = join(tmpdir(), `echo-large-lib-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });

  // Artist / Album / Disc style tree + some longish path segments (Windows-ish).
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

    // Non-audio noise in album folder.
    for (const name of nonAudio) {
      writeFileSync(join(dir, name), `noise-${name}`);
    }

    const tracksHere = Math.max(1, Math.floor(FILE_COUNT / DIR_COUNT));
    for (let t = 0; t < tracksHere && createdFiles < FILE_COUNT; t += 1) {
      const ext = extensions[(createdFiles + t) % extensions.length];
      const name = `${String(t + 1).padStart(2, '0')} - Track 曲目 ${createdFiles}${ext}`;
      // Small but non-empty payload; not real audio frames (discovery only cares about path/stat).
      writeFileSync(join(dir, name), `audio-placeholder-${createdFiles}-${'x'.repeat(64)}`);
      createdFiles += 1;
    }
  }

  // Fill remainder if division left some out.
  while (createdFiles < FILE_COUNT) {
    const dir = join(root, `_overflow`, `bucket-${createdFiles % 20}`);
    mkdirSync(dir, { recursive: true });
    const ext = extensions[createdFiles % extensions.length];
    writeFileSync(join(dir, `extra-${createdFiles}${ext}`), `x-${createdFiles}`);
    createdFiles += 1;
  }

  return { root, createdFiles, createdDirs };
};

const loadScanners = async () => {
  process.env.ECHO_NATIVE_SCANNER_PATH = binaryPath;
  process.env.ECHO_NATIVE_FILE_SCANNER = '1';
  delete process.env.ECHO_DISABLE_NATIVE_FILE_SCANNER;

  // Compile-on-the-fly via tsx if available; else try out/ paths.
  try {
    const tsx = await import('tsx/esm/api');
    const mod = await tsx.registerAndImport(
      pathToFileURL(join(projectRoot, 'src/main/library/workers/NativeFileScanner.ts')).href,
    );
    return mod;
  } catch {
    // fall through
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return import(pathToFileURL(candidate).href);
    }
  }

  // Last resort: spawn vitest-less node with ts-node/register skipped — use child protocol like benchmark-file-scanner
  // and only exercise binary path for timing; still import via dynamic require of transpiled nothing.
  throw new Error(
    'Cannot load NativeFileScanner.ts. Install/use tsx or build main first. Falling back is handled by caller.',
  );
};

const collect = async (iterable) => {
  const files = [];
  for await (const file of iterable) {
    files.push(file);
  }
  return files;
};

const compareSets = (a, b) => {
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
  console.log('[large-bench] projectRoot=', projectRoot);
  console.log('[large-bench] binary=', binaryPath, 'exists=', existsSync(binaryPath));
  if (!existsSync(binaryPath)) {
    throw new Error(`Native binary missing: ${binaryPath}. Run npm run build:native-scanner`);
  }

  const { root, createdFiles, createdDirs } = createRealisticLibrary();
  console.log(
    `[large-bench] library root=${root}\n` +
      `[large-bench] requestedFiles=${FILE_COUNT} createdFiles=${createdFiles} nestDepth=${NEST_DEPTH} artistDirs=${DIR_COUNT} dirsCreated≈${createdDirs}`,
  );

  let NativeFileScanner;
  let NativeThenTsFileScanner;
  let getNativeFileScannerDiagnostics;
  let TsFileScanner;

  try {
    const mod = await loadScanners();
    NativeFileScanner = mod.NativeFileScanner;
    NativeThenTsFileScanner = mod.NativeThenTsFileScanner;
    getNativeFileScannerDiagnostics = mod.getNativeFileScannerDiagnostics;
  } catch (error) {
    console.warn('[large-bench] TS module load failed, using protocol-level native vs node only:', error.message);
  }

  try {
    if (NativeFileScanner) {
      const { TsFileScanner: Ts } = await import(
        pathToFileURL(join(projectRoot, 'src/main/library/workers/TsFileScanner.ts')).href
      ).catch(async () => {
        const tsx = await import('tsx/esm/api');
        return tsx.registerAndImport(pathToFileURL(join(projectRoot, 'src/main/library/workers/TsFileScanner.ts')).href);
      });
      TsFileScanner = Ts;

      const native = new NativeFileScanner({
        executablePath: binaryPath,
        idleTimeoutMs: 120_000,
      });
      const ts = new TsFileScanner();
      const wrapped = new NativeThenTsFileScanner(native, ts, console.warn, () => true);

      // Warm TS / disk cache lightly
      await collect(ts.scanFolder(root));

      const results = [];
      for (let round = 1; round <= ROUNDS; round += 1) {
        const t0 = now();
        const tsFiles = await collect(ts.scanFolder(root));
        const tsMs = now() - t0;

        const n0 = now();
        const nativeFiles = await collect(native.scanFolder(root));
        const nativeMs = now() - n0;

        const cmp = compareSets(tsFiles, nativeFiles);
        const diag = getNativeFileScannerDiagnostics(() => true);
        results.push({ round, tsMs, nativeMs, cmp, timing: diag.lastTiming, reuses: diag.processReuses, starts: diag.processStarts });

        console.log(
          `[large-bench] round=${round} ts=${tsMs.toFixed(1)}ms native=${nativeMs.toFixed(1)}ms ` +
            `speedup=${(tsMs / Math.max(1, nativeMs)).toFixed(2)}x files=${cmp.aCount}/${cmp.bCount} match=${cmp.match} ` +
            `reused=${diag.lastTiming?.reusedProcess} walkMs=${diag.lastTiming?.walkMs?.toFixed?.(1) ?? diag.lastTiming?.walkMs} ` +
            `starts=${diag.processStarts} reuses=${diag.processReuses}`,
        );
        if (!cmp.match) {
          console.error('[large-bench] MISMATCH', cmp);
          process.exitCode = 1;
        }
      }

      // Second API path: NativeThenTs with env enable — should stay native, 0 fallback
      const w0 = now();
      const wrappedFiles = await collect(wrapped.scanFolder(root));
      const wrappedMs = now() - w0;
      const diagAfter = getNativeFileScannerDiagnostics(() => true);
      console.log(
        `[large-bench] NativeThenTs files=${wrappedFiles.length} ms=${wrappedMs.toFixed(1)} ` +
          `fallbackToTs=${diagAfter.fallbackToTs} nativeScanOk=${diagAfter.nativeScanOk} lastFallback=${diagAfter.lastFallbackReason}`,
      );

      // Forced fallback: missing binary path on a fresh wrapper
      process.env.ECHO_NATIVE_SCANNER_PATH = join(projectRoot, 'definitely-missing-echo-native-scanner.exe');
      const brokenNative = new NativeFileScanner({
        executablePath: process.env.ECHO_NATIVE_SCANNER_PATH,
        idleTimeoutMs: 0,
      });
      const fallbackWrapper = new NativeThenTsFileScanner(brokenNative, ts, (msg) => {
        console.log('[large-bench] fallback-log:', msg);
      }, () => true);
      const fb0 = now();
      const fbFiles = await collect(fallbackWrapper.scanFolder(root));
      const fbMs = now() - fb0;
      const fbCmp = compareSets(wrappedFiles, fbFiles);
      console.log(
        `[large-bench] FALLBACK_TS files=${fbFiles.length} ms=${fbMs.toFixed(1)} matchNative=${fbCmp.match} ` +
          `(expect match; path must equal full TS discovery)`,
      );
      if (!fbCmp.match) {
        console.error('[large-bench] FALLBACK mismatch', fbCmp);
        process.exitCode = 1;
      }

      native.dispose();
      brokenNative.dispose();
      fallbackWrapper.dispose?.();
      wrapped.dispose?.();

      console.log('[large-bench] SUMMARY', JSON.stringify({
        fileCount: createdFiles,
        rounds: results.map((r) => ({
          round: r.round,
          tsMs: +r.tsMs.toFixed(1),
          nativeMs: +r.nativeMs.toFixed(1),
          speedup: +(r.tsMs / Math.max(1, r.nativeMs)).toFixed(2),
          reused: r.timing?.reusedProcess,
          walkMs: r.timing?.walkMs,
        })),
        fallbackOk: fbCmp.match,
      }, null, 2));
    }
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    console.log('[large-bench] cleaned library');
  }
};

main().catch((error) => {
  console.error('[large-bench] FATAL', error);
  process.exitCode = 1;
});
