import { pathToFileURL } from 'node:url';

const defaultMatrix = [
  { metadataConcurrency: 2, coverConcurrency: 2 },
  { metadataConcurrency: 4, coverConcurrency: 2 },
  { metadataConcurrency: 4, coverConcurrency: 3 },
  { metadataConcurrency: 6, coverConcurrency: 3 },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const processWithConcurrency = async (items, concurrency, worker) => {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });

  await Promise.all(workers);
};

const measureAsync = async (work) => {
  const startedAt = performance.now();
  const result = await work();

  return {
    result,
    durationMs: performance.now() - startedAt,
  };
};

export const runScanConcurrencyScenario = async (options = {}) => {
  const tracks = options.tracks ?? 600;
  const changedTracks = options.changedTracks ?? Math.max(1, Math.floor(tracks * 0.15));
  const metadataDelayMs = options.metadataDelayMs ?? 4;
  const coverDelayMs = options.coverDelayMs ?? 9;
  const metadataConcurrency = options.metadataConcurrency ?? 2;
  const coverConcurrency = options.coverConcurrency ?? 2;
  const files = Array.from({ length: tracks }, (_, index) => ({ id: index + 1, hasCover: index % 3 !== 0 }));
  const changedFiles = files.slice(0, changedTracks);
  let metadataCalls = 0;
  let coverCalls = 0;

  const readMetadata = async () => {
    metadataCalls += 1;
    await sleep(metadataDelayMs);
  };
  const extractCover = async () => {
    coverCalls += 1;
    await sleep(coverDelayMs);
  };

  const firstScan = await measureAsync(async () => {
    await processWithConcurrency(files, metadataConcurrency, readMetadata);
    await processWithConcurrency(
      files.filter((file) => file.hasCover),
      coverConcurrency,
      extractCover,
    );
  });

  const metadataCallsAfterFirstScan = metadataCalls;
  const coverCallsAfterFirstScan = coverCalls;
  const changedScan = await measureAsync(async () => {
    await processWithConcurrency(changedFiles, metadataConcurrency, readMetadata);
    await processWithConcurrency(
      changedFiles.filter((file) => file.hasCover),
      coverConcurrency,
      extractCover,
    );
  });
  const memory = process.memoryUsage();

  return {
    scenario: options.scenario ?? `${metadataConcurrency}m/${coverConcurrency}c`,
    tracks,
    metadataConcurrency,
    coverConcurrency,
    firstScanDurationMs: firstScan.durationMs,
    fakeScanDurationMs: firstScan.durationMs,
    changedFilesDurationMs: changedScan.durationMs,
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
    },
    metadataCalls,
    coverCalls,
    firstScanMetadataCalls: metadataCallsAfterFirstScan,
    firstScanCoverCalls: coverCallsAfterFirstScan,
  };
};

export const runScanConcurrencyMatrix = async (options = {}) => {
  const matrix = options.matrix ?? defaultMatrix;
  const results = [];

  for (const entry of matrix) {
    results.push(
      await runScanConcurrencyScenario({
        ...options,
        ...entry,
        scenario: options.scenario ?? `${entry.metadataConcurrency}m/${entry.coverConcurrency}c`,
      }),
    );
  }

  return results;
};

const printResult = (result) => {
  console.log(`scenario: ${result.scenario}`);
  console.log(`tracks: ${result.tracks}`);
  console.log(`metadataConcurrency: ${result.metadataConcurrency}`);
  console.log(`coverConcurrency: ${result.coverConcurrency}`);
  console.log(`first scan / fake scan duration: ${result.firstScanDurationMs.toFixed(2)} ms`);
  console.log(`changed files duration: ${result.changedFilesDurationMs.toFixed(2)} ms`);
  console.log(`memory rss/heapUsed: ${result.memory.rss} / ${result.memory.heapUsed}`);
  console.log(`metadata calls: ${result.metadataCalls}`);
  console.log(`cover calls: ${result.coverCalls}`);
  console.log('');
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const tracks = Number(process.env.ECHO_BENCH_TRACKS ?? 600);
  const changedTracks = Number(process.env.ECHO_BENCH_CHANGED_TRACKS ?? Math.max(1, Math.floor(tracks * 0.15)));
  const results = await runScanConcurrencyMatrix({ tracks, changedTracks });

  for (const result of results) {
    printResult(result);
  }
}
