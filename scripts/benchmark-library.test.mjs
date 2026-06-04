import { describe, expect, it } from 'vitest';
import { generateFakeTracks, runAlbumBenchmark, runBenchmark } from './benchmark-library.mjs';
import { runScanConcurrencyMatrix } from './benchmark-scan-concurrency.mjs';

describe('benchmark-library', () => {
  it('generates fake tracks', () => {
    const tracks = generateFakeTracks(12);

    expect(tracks).toHaveLength(12);
    expect(tracks[0].path).toContain('FakeLibrary');
  });

  it('runs a small fake-data benchmark', () => {
    const result = runBenchmark(25);

    expect(result.tracks).toBe(25);
    expect(result.albumsCount).toBeGreaterThan(0);
    expect(result.getAlbumsPage1ItemCount).toBeGreaterThan(0);
    expect(result.searchChineseItemCount).toBe(1);
    expect(result.searchPinyinItemCount).toBe(1);
    expect(result.averageCoverThumbLength).toBeGreaterThan(0);
    expect(result.getAlbumsReturnsForbiddenCoverPayload).toBe(false);
    expect(result.unchangedScanSkipped).toBe(25);
    expect(result.duplicateCoverLookupCount).toBe(25);
    expect(result.upsertCoverDuplicateCount).toBeGreaterThan(0);
    expect(result.databaseSizeBytes).toBeGreaterThan(0);
    expect(result.memory.rss).toBeGreaterThan(0);
    expect(result.memory.heapUsed).toBeGreaterThan(0);
  });

  it('runs a small album-wall benchmark with fake cover cache payloads', () => {
    const result = runAlbumBenchmark(75);

    expect(result.scenario).toBe('albums');
    expect(result.tracks).toBe(75);
    expect(result.albumsTotalCount).toBe(75);
    expect(result.getAlbumsPage1ItemCount).toBe(60);
    expect(result.getAlbumsPage10ItemCount).toBe(0);
    expect(result.averageCoverThumbLength).toBeGreaterThan(0);
    expect(result.getAlbumsReturnsForbiddenCoverPayload).toBe(false);
  });

  it('runs a small scan concurrency matrix benchmark', async () => {
    const results = await runScanConcurrencyMatrix({
      tracks: 12,
      changedTracks: 4,
      metadataDelayMs: 1,
      coverDelayMs: 1,
    });

    expect(results).toHaveLength(4);
    expect(results[0]).toMatchObject({ metadataConcurrency: 2, coverConcurrency: 2 });
    expect(results[1]).toMatchObject({ metadataConcurrency: 4, coverConcurrency: 2 });
    expect(results[2]).toMatchObject({ metadataConcurrency: 4, coverConcurrency: 3 });
    expect(results[3]).toMatchObject({ metadataConcurrency: 6, coverConcurrency: 3 });
    expect(results[0].metadataCalls).toBeGreaterThan(0);
    expect(results[0].coverCalls).toBeGreaterThan(0);
    expect(results[0].memory.rss).toBeGreaterThan(0);
    expect(results[0].memory.heapUsed).toBeGreaterThan(0);
  });
});
