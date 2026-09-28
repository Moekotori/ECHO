import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// node scripts/check-lyrics-memory.mjs [--baseline=<git revision>] [--player-bar | --artwork]
// Requires the existing Playwright Chromium installation. No audio/profile access.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.argv.find((arg) => arg.startsWith('--baseline='))?.slice(11);
const playerBar = process.argv.includes('--player-bar');
const artwork = process.argv.includes('--artwork');
const originalFiles = new Set([
  'src/renderer/pages/LyricsPage.tsx',
  'src/renderer/components/lyrics/LyricsView.tsx',
  'src/renderer/components/lyrics/LyricsLine.tsx',
  'src/renderer/components/player/PlayerBar.tsx',
  'src/renderer/hooks/useLibraryStartupArtworkPreloader.ts',
]);
const plugins = baseline ? [{
  name: 'baseline-source',
  setup(builder) {
    builder.onLoad({ filter: /(?:LyricsPage|LyricsView|LyricsLine|PlayerBar|useLibraryStartupArtworkPreloader)\.tsx?$/ }, ({ path }) => {
      const relativePath = path.replaceAll('\\', '/').slice(root.replaceAll('\\', '/').length + 1);
      if (!originalFiles.has(relativePath)) return;
      return {
        contents: execFileSync('git', ['show', `${baseline}:${relativePath}`], {
          cwd: root, encoding: 'utf8', env: { ...process.env, GIT_MASTER: '1' },
        }),
        loader: 'tsx', resolveDir: dirname(path),
      };
    });
  },
}] : [];
const result = await build({
  absWorkingDir: root, entryPoints: ['scripts/fixtures/lyrics-memory.tsx'],
  bundle: true, write: false, jsx: 'automatic', loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' }, plugins,
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://lyrics-memory.test/**', (route) => route.fulfill({
    contentType: 'text/html', body: '<div id="root"></div>',
  }));
  await page.goto(`http://lyrics-memory.test/${playerBar ? '?player-bar' : ''}`);
  await page.addScriptTag({ content: result.outputFiles[0].text });
  await page.waitForSelector('.lyrics-line', { timeout: 5000 }).catch((error) => {
    throw new Error(`Lyrics fixture failed: ${errors.join('; ') || error.message}`);
  });
  const session = await page.context().newCDPSession(page);
  if (artwork) {
    await page.evaluate(() => Promise.race([
      window.prepareArtworkProbe(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Artwork probe timed out')), 5000)),
    ]));
  }
  const samples = [];
  for (let batch = 0; batch < (artwork ? 0 : 8); batch += 1) {
    await page.evaluate(async (batchIndex) => {
      for (let index = 0; index < 2000; index += 1) {
        window.tick(batchIndex * 2000 + index);
        if (index % 25 === 0) await new Promise((done) => setTimeout(done, 0));
      }
    }, batch);
    await session.send('HeapProfiler.collectGarbage');
    samples.push((await session.send('Runtime.getHeapUsage')).usedSize);
  }
  await session.send('HeapProfiler.collectGarbage');
  const retainedArtworkImages = artwork ? await page.evaluate(() => window.retainedArtworkImages()) : null;
  const chunks = [];
  session.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => chunks.push(chunk));
  await session.send('HeapProfiler.takeHeapSnapshot');
  const heap = JSON.parse(chunks.join(''));
  const nodeFields = heap.snapshot.meta.node_fields;
  const edgeFields = heap.snapshot.meta.edge_fields;
  const nodeWidth = nodeFields.length;
  const edgeWidth = edgeFields.length;
  const retained = { pageContexts: 0, viewContexts: 0, playerContexts: 0 };
  let edgeOffset = 0;
  for (let node = 0; node < heap.nodes.length; node += nodeWidth) {
    const edgeEnd = edgeOffset + heap.nodes[node + nodeFields.indexOf('edge_count')] * edgeWidth;
    if (heap.strings[heap.nodes[node + nodeFields.indexOf('name')]] === 'system / Context') {
      for (let edge = edgeOffset; edge < edgeEnd; edge += edgeWidth) {
        const type = heap.snapshot.meta.edge_types[0][heap.edges[edge + edgeFields.indexOf('type')]];
        if (type !== 'context') continue;
        const name = heap.strings[heap.edges[edge + edgeFields.indexOf('name_or_index')]];
        if (name === 'lyricsDrawerCurrentTrackTools') retained.pageContexts += 1;
        if (name === 'centerActiveLyric') retained.viewContexts += 1;
        if (name === 'publishOptimisticPause') retained.playerContexts += 1;
      }
    }
    edgeOffset = edgeEnd;
  }
  const stats = await page.evaluate(() => window.probeStats());
  await page.evaluate(() => window.unmountProbe());
  const afterUnmount = await page.evaluate(() => window.probeStats());
  await page.evaluate(() => window.cleanupArtworkProbe());
  console.log(JSON.stringify({ baseline: baseline ?? null, updates: artwork ? 0 : 16000, samples, retained, retainedArtworkImages, stats, afterUnmount }, null, 2));
  assert.deepEqual(errors, [], 'renderer errors');
  assert.equal(afterUnmount.activeSubscriptions, 0, 'subscriptions must be released');
  // Count retained render scopes rather than timing-sensitive RSS/GC thresholds.
  assert.ok(retained.pageContexts <= 32, `retained ${retained.pageContexts} LyricsPage renders`);
  assert.ok(retained.viewContexts <= 32, `retained ${retained.viewContexts} LyricsView renders`);
  assert.ok(retained.playerContexts <= 32, `retained ${retained.playerContexts} PlayerBar renders`);
  if (artwork) assert.equal(retainedArtworkImages, 0, 'completed artwork must not be retained by the idle preloader');
} finally {
  await browser.close();
}
