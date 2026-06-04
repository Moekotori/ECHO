import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, type EchoDatabase } from '../../database/createDatabase';
import { LibraryStore } from '../LibraryStore';
import { ArtistImageCacheService } from './ArtistImageCacheService';
import { artistImageKeyForName } from './ArtistImageMatching';
import { artistImageCacheSourceHash, type ArtistImageCandidate, type ArtistImageProvider } from './ArtistImageTypes';

const tempRoots: string[] = [];

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-artist-images-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

const validPng = (): Uint8Array =>
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#446688"/><circle cx="256" cy="210" r="110" fill="#d8e9f7"/><rect x="104" y="326" width="304" height="150" rx="75" fill="#1f8f84"/></svg>',
    'utf8',
  );

const qqDefaultArtistAvatar = (): Uint8Array =>
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#ecf6ee"/><circle cx="256" cy="178" r="76" fill="#fde6ce"/><rect x="80" y="286" width="352" height="226" rx="176" fill="#92e4bb"/><rect x="228" y="326" width="56" height="116" rx="10" fill="#ffffff"/><rect x="216" y="354" width="80" height="12" rx="6" fill="#ffffff"/><rect x="216" y="382" width="80" height="12" rx="6" fill="#ffffff"/></svg>',
    'utf8',
  );

const insertArtist = (database: EchoDatabase, id: string, name: string): string => {
  const key = artistImageKeyForName(name);
  database
    .prepare(
      `INSERT INTO artists (
        id, artist_key, name, sort_name, role, track_count, album_count, cover_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'track', 1, 0, NULL, ?, ?)`,
    )
    .run(id, key, name, key, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  return key;
};

const insertCache = (
  database: EchoDatabase,
  artistKey: string,
  status: string,
  overrides: Record<string, unknown> = {},
): void => {
  database
    .prepare(
      `INSERT INTO artist_image_cache (
        artist_key, artist_name, provider, provider_artist_id, source_url, source_hash,
        thumb_path, medium_path, large_path, status, confidence, failure_reason,
        fetched_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      artistKey,
      overrides.artistName ?? 'Echo Artist',
      overrides.provider ?? 'qqmusic',
      overrides.providerArtistId ?? null,
      overrides.sourceUrl ?? null,
      overrides.sourceHash ?? null,
      overrides.thumbPath ?? null,
      overrides.mediumPath ?? null,
      overrides.largePath ?? null,
      status,
      overrides.confidence ?? 0,
      overrides.failureReason ?? null,
      overrides.fetchedAt ?? null,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );
};

const createProvider = (searchArtistImage: ReturnType<typeof vi.fn>, name = 'mock'): ArtistImageProvider => ({
  name,
  minRequestIntervalMs: 0,
  searchArtistImage: searchArtistImage as (input: { artistName: string; artistKey: string }) => Promise<ArtistImageCandidate[]>,
});

const createDeferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate: () => boolean, timeoutMs = 250): Promise<void> => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for artist image test condition');
    }
    await delay(5);
  }
};

const createService = (
  database: EchoDatabase,
  providers: ArtistImageProvider | ArtistImageProvider[],
  root = makeTempRoot(),
  options: {
    concurrency?: number;
    fetchImageData?: Uint8Array;
    fetchImage?: (url: string) => Promise<{ data: Uint8Array; mimeType: string; sourceHash: string }>;
  } = {},
): ArtistImageCacheService =>
  new ArtistImageCacheService(database, {
    cacheRoot: join(root, 'artist-images'),
    providers: Array.isArray(providers) ? providers : [providers],
    concurrency: options.concurrency,
    fetchImage: options.fetchImage ?? (async (url) => ({
      data: options.fetchImageData ?? validPng(),
      mimeType: 'image/png',
      sourceHash: `hash:${url}`,
    })),
  });

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('ArtistImageCacheService', () => {
  it('does not request the provider when a matched cache exists', () => {
    const database = createDatabase(':memory:');
    const artistKey = insertArtist(database, 'artist-1', 'Echo Artist');
    insertCache(database, artistKey, 'matched', {
      thumbPath: 'D:/cache/thumb.webp',
      mediumPath: 'D:/cache/medium.webp',
      largePath: 'D:/cache/large.webp',
      sourceHash: artistImageCacheSourceHash('old'),
      confidence: 0.96,
    });
    const providerSearch = vi.fn();
    const service = createService(database, createProvider(providerSearch));

    const result = service.refreshVisibleArtistImages([{ id: 'artist-1', name: 'Echo Artist' }]);

    expect(result).toEqual({ queued: 0, skipped: 1 });
    expect(providerSearch).not.toHaveBeenCalled();
    database.close();
  });

  it('refreshes old matched caches without the current image cache version', async () => {
    const database = createDatabase(':memory:');
    const artistKey = insertArtist(database, 'artist-1', 'Echo Artist');
    insertCache(database, artistKey, 'matched', {
      thumbPath: 'D:/cache/thumb.webp',
      mediumPath: 'D:/cache/medium.webp',
      largePath: 'D:/cache/large.webp',
      confidence: 0.96,
    });
    const providerSearch = vi.fn().mockResolvedValue([]);
    const service = createService(database, createProvider(providerSearch));

    const result = service.refreshVisibleArtistImages([{ id: 'artist-1', name: 'Echo Artist' }]);

    expect(result).toEqual({ queued: 1, skipped: 0 });
    await waitFor(() => providerSearch.mock.calls.length === 1);
    await waitFor(() => service.getJobStatus().active === 0);
    database.close();
  });

  it('does not retry not_found or error rows during the next enqueue', () => {
    const database = createDatabase(':memory:');
    const missingKey = insertArtist(database, 'artist-1', 'Missing Artist');
    const errorKey = insertArtist(database, 'artist-2', 'Error Artist');
    insertCache(database, missingKey, 'not_found', { failureReason: 'no_result', sourceHash: artistImageCacheSourceHash('no-result') });
    insertCache(database, errorKey, 'error', { failureReason: 'network', sourceHash: artistImageCacheSourceHash('network') });
    const providerSearch = vi.fn();
    const service = createService(database, createProvider(providerSearch));

    const result = service.enqueueMissingArtistImages([
      { id: 'artist-1', name: 'Missing Artist' },
      { id: 'artist-2', name: 'Error Artist' },
    ]);

    expect(result).toEqual({ queued: 0, skipped: 2 });
    expect(providerSearch).not.toHaveBeenCalled();
    database.close();
  });

  it('includes failed cache rows when enqueueing missing artists with force', async () => {
    const database = createDatabase(':memory:');
    const missingKey = insertArtist(database, 'artist-1', 'Missing Artist');
    const errorKey = insertArtist(database, 'artist-2', 'Error Artist');
    insertCache(database, missingKey, 'not_found', { failureReason: 'no_result' });
    insertCache(database, errorKey, 'error', { failureReason: 'network' });
    const providerSearch = vi.fn().mockResolvedValue([]);
    const service = createService(database, createProvider(providerSearch));

    const result = service.enqueueMissingArtistImages([], { force: true, limit: 10 });

    expect(result).toEqual({ queued: 2, skipped: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(providerSearch).toHaveBeenCalledTimes(2);
    database.close();
  });

  it('does not retry terminal cache rows during default background backfill', async () => {
    const database = createDatabase(':memory:');
    const missingKey = insertArtist(database, 'artist-1', 'Missing Artist');
    const errorKey = insertArtist(database, 'artist-2', 'Error Artist');
    const rateLimitedKey = insertArtist(database, 'artist-3', 'Rate Limited Artist');
    insertCache(database, missingKey, 'not_found', { failureReason: 'no_result', sourceHash: artistImageCacheSourceHash('no-result') });
    insertCache(database, errorKey, 'error', { failureReason: 'network', sourceHash: artistImageCacheSourceHash('network') });
    insertCache(database, rateLimitedKey, 'rate_limited', { failureReason: 'rate_limited', sourceHash: artistImageCacheSourceHash('rate') });
    const providerSearch = vi.fn().mockResolvedValue([]);
    const service = createService(database, createProvider(providerSearch));

    const status = service.kickoffBackfill({ limit: 10 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(status.lastQueued).toEqual({ queued: 0, skipped: 0 });
    expect(providerSearch).not.toHaveBeenCalled();
    database.close();
  });

  it('stores NetEase frequent-operation failures as rate limited', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'Rate Limited Artist');
    const providerSearch = vi.fn().mockRejectedValue(new Error('request_failed:405 操作频繁，请稍候再试'));
    const service = createService(database, createProvider(providerSearch, 'netease'));

    const result = await service.refreshArtistImage('artist-1', true);

    expect(result.entry).toMatchObject({
      status: 'rate_limited',
      provider: 'netease',
    });
    database.close();
  });

  it('does not enqueue an extra batch when default background backfill is already running', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'First Artist');
    insertArtist(database, 'artist-2', 'Second Artist');
    insertArtist(database, 'artist-3', 'Third Artist');
    const lookup = createDeferred<ArtistImageCandidate[]>();
    const providerSearch = vi.fn(() => lookup.promise);
    const service = createService(database, createProvider(providerSearch), makeTempRoot(), { concurrency: 1 });

    service.kickoffBackfill({ limit: 2 });
    await waitFor(() => providerSearch.mock.calls.length === 1);
    const status = service.kickoffBackfill({ force: false, limit: 2 });

    expect(status).toMatchObject({ queued: 1, active: 1 });
    expect(status.lastQueued).toEqual({ queued: 2, skipped: 0 });
    expect(providerSearch).toHaveBeenCalledTimes(1);

    lookup.resolve([]);
    await waitFor(() => service.getJobStatus().active === 0);
    database.close();
  });

  it('retries terminal cache rows when background backfill is forced', async () => {
    const database = createDatabase(':memory:');
    const missingKey = insertArtist(database, 'artist-1', 'Missing Artist');
    const errorKey = insertArtist(database, 'artist-2', 'Error Artist');
    insertCache(database, missingKey, 'not_found', { failureReason: 'no_result', sourceHash: artistImageCacheSourceHash('no-result') });
    insertCache(database, errorKey, 'error', { failureReason: 'network', sourceHash: artistImageCacheSourceHash('network') });
    const providerSearch = vi.fn().mockResolvedValue([]);
    const service = createService(database, createProvider(providerSearch));

    const status = service.kickoffBackfill({ force: true, limit: 10 });
    await waitFor(() => providerSearch.mock.calls.length === 2);

    expect(status.lastQueued).toEqual({ queued: 2, skipped: 0 });
    database.close();
  });

  it('retries stale loading rows on the next service run', async () => {
    const database = createDatabase(':memory:');
    const artistKey = insertArtist(database, 'artist-1', 'Interrupted Artist');
    insertCache(database, artistKey, 'loading');
    const providerSearch = vi.fn().mockResolvedValue([]);
    const service = createService(database, createProvider(providerSearch));

    const result = await service.refreshArtistImage('artist-1');

    expect(providerSearch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      queued: true,
      entry: {
        status: 'not_found',
        failureReason: 'all_providers_no_result',
      },
    });
    database.close();
  });

  it('retries stale loading rows when background backfill starts', async () => {
    const database = createDatabase(':memory:');
    const artistKey = insertArtist(database, 'artist-1', 'Interrupted Artist');
    insertCache(database, artistKey, 'loading');
    const providerSearch = vi.fn().mockResolvedValue([]);
    const service = createService(database, createProvider(providerSearch));

    service.kickoffBackfill({ force: true, limit: 10 });
    await waitFor(() => providerSearch.mock.calls.length === 1);

    expect(service.getJobStatus()).toMatchObject({
      running: false,
      queued: 0,
      active: 0,
    });
    database.close();
  });

  it('pauses queued artist image jobs until resumed', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'Paused Artist');
    const providerSearch = vi.fn().mockResolvedValue([]);
    const service = createService(database, createProvider(providerSearch));

    service.setPaused(true);
    const result = service.enqueueMissingArtistImages([{ id: 'artist-1', name: 'Paused Artist' }], { force: true });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result).toEqual({ queued: 1, skipped: 0 });
    expect(service.getJobStatus()).toMatchObject({ paused: true, queued: 1, active: 0 });
    expect(providerSearch).not.toHaveBeenCalled();

    service.setPaused(false);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(providerSearch).toHaveBeenCalledTimes(1);
    database.close();
  });

  it('defers queued artist image jobs while playback is active', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'Playing Artist');
    const providerSearch = vi.fn().mockResolvedValue([]);
    const service = createService(database, createProvider(providerSearch));

    service.setPlaybackActive(true);
    const result = service.enqueueMissingArtistImages([{ id: 'artist-1', name: 'Playing Artist' }], { force: true });
    await delay(20);

    expect(result).toEqual({ queued: 1, skipped: 0 });
    expect(service.getJobStatus()).toMatchObject({ paused: false, running: false, queued: 1, active: 0 });
    expect(providerSearch).not.toHaveBeenCalled();

    service.setPlaybackActive(false);
    await waitFor(() => providerSearch.mock.calls.length === 1);

    database.close();
  });

  it('remembers background backfill requested during playback and starts it afterward', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'Deferred Backfill Artist');
    const providerSearch = vi.fn().mockResolvedValue([]);
    const service = createService(database, createProvider(providerSearch));

    service.setPlaybackActive(true);
    const status = service.kickoffBackfill({ force: true, limit: 10 });
    await delay(20);

    expect(status).toMatchObject({ running: false, queued: 0, active: 0 });
    expect(providerSearch).not.toHaveBeenCalled();

    service.setPlaybackActive(false);
    await waitFor(() => providerSearch.mock.calls.length === 1);

    database.close();
  });

  it('requeues an active artist image job if playback starts before image processing', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'Interrupted Playback Artist');
    const serviceRef: { current: ArtistImageCacheService | null } = { current: null };
    const fetchImage = vi.fn(async () => {
      serviceRef.current?.setPlaybackActive(true);
      return {
        data: validPng(),
        mimeType: 'image/png',
        sourceHash: 'hash:interrupted',
      };
    });
    const providerSearch = vi.fn().mockResolvedValue([
      {
        provider: 'mock',
        providerArtistId: 'remote-1',
        artistName: 'Interrupted Playback Artist',
        imageUrl: 'https://example.test/avatar.jpg',
        confidence: 0.98,
      },
    ]);
    const service = createService(database, createProvider(providerSearch), makeTempRoot(), { fetchImage });
    serviceRef.current = service;

    service.enqueueMissingArtistImages([{ id: 'artist-1', name: 'Interrupted Playback Artist' }], { force: true });
    await waitFor(() => service.getJobStatus().queued === 1 && service.getJobStatus().active === 0);

    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(service.getArtistImage('artist-1')?.status).toBe('pending');

    fetchImage.mockImplementationOnce(async () => ({
      data: validPng(),
      mimeType: 'image/png',
      sourceHash: 'hash:resumed',
    }));
    service.setPlaybackActive(false);
    await waitFor(() => service.getArtistImage('artist-1')?.status === 'matched');

    database.close();
  });

  it('lets the active job finish while paused without starting the next queued job', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'Active Artist');
    insertArtist(database, 'artist-2', 'Queued Artist');
    const firstSearch = createDeferred<ArtistImageCandidate[]>();
    const providerSearch = vi.fn()
      .mockReturnValueOnce(firstSearch.promise)
      .mockResolvedValue([]);
    const service = createService(database, createProvider(providerSearch), makeTempRoot(), { concurrency: 1 });

    service.enqueueMissingArtistImages([
      { id: 'artist-1', name: 'Active Artist' },
      { id: 'artist-2', name: 'Queued Artist' },
    ], { force: true });
    await waitFor(() => providerSearch.mock.calls.length === 1);

    service.setPaused(true);
    expect(service.getJobStatus()).toMatchObject({ paused: true, queued: 1, active: 1 });

    firstSearch.resolve([]);
    await waitFor(() => service.getJobStatus().active === 0);

    expect(providerSearch).toHaveBeenCalledTimes(1);
    expect(service.getJobStatus()).toMatchObject({ paused: true, queued: 1, active: 0 });

    service.setPaused(false);
    await waitFor(() => providerSearch.mock.calls.length === 2);

    database.close();
  });

  it('keeps refilling background batches until no missing artists remain', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'Artist One');
    insertArtist(database, 'artist-2', 'Artist Two');
    insertArtist(database, 'artist-3', 'Artist Three');
    const providerSearch = vi.fn().mockResolvedValue([]);
    const service = createService(database, createProvider(providerSearch));

    service.kickoffBackfill({ force: true, limit: 1 });
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(providerSearch).toHaveBeenCalledTimes(3);
    expect(service.getJobStatus()).toMatchObject({
      running: false,
      queued: 0,
      active: 0,
      lastQueued: { queued: 0, skipped: 0 },
    });
    database.close();
  });

  it('paces same-provider searches without waiting for the previous search to finish', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'Artist One');
    insertArtist(database, 'artist-2', 'Artist Two');
    const searches: Array<{ artistName: string; resolve: (candidates: ArtistImageCandidate[]) => void }> = [];
    const providerSearch = vi.fn((input: { artistName: string }) => {
      const search = createDeferred<ArtistImageCandidate[]>();
      searches.push({ artistName: input.artistName, resolve: search.resolve });
      return search.promise;
    });
    const service = createService(database, createProvider(providerSearch, 'limited'), makeTempRoot(), { concurrency: 2 });

    service.enqueueMissingArtistImages([
      { id: 'artist-1', name: 'Artist One' },
      { id: 'artist-2', name: 'Artist Two' },
    ], { force: true });
    await waitFor(() => providerSearch.mock.calls.length === 2);

    expect(service.getJobStatus()).toMatchObject({ active: 2, queued: 0 });

    searches[0]!.resolve([]);
    expect(searches.map((search) => search.artistName)).toEqual(['Artist One', 'Artist Two']);
    searches[1]!.resolve([]);
    await waitFor(() => service.getJobStatus().active === 0);
    database.close();
  });

  it('forceRefresh requests the provider again', async () => {
    const database = createDatabase(':memory:');
    const artistKey = insertArtist(database, 'artist-1', 'Echo Artist');
    insertCache(database, artistKey, 'matched', { confidence: 0.96, sourceUrl: 'https://old.example/avatar.jpg' });
    const providerSearch = vi.fn().mockResolvedValue([
      {
        provider: 'mock',
        providerArtistId: 'remote-1',
        artistName: 'Echo Artist',
        imageUrl: 'https://example.test/avatar.jpg',
        confidence: 0.96,
        sourceUrl: 'https://example.test/artist',
      },
    ]);
    const service = createService(database, createProvider(providerSearch));

    const result = await service.refreshArtistImage('artist-1', true);

    expect(providerSearch).toHaveBeenCalledTimes(1);
    expect(result.entry).toMatchObject({
      status: 'matched',
      provider: 'mock',
      providerArtistId: 'remote-1',
      sourceUrl: 'https://example.test/artist',
      confidence: 0.96,
    });
    expect(result.entry?.thumbPath).toContain('thumb.webp');
    database.close();
  });

  it('stores low-confidence provider results as not_found', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'A');
    const providerSearch = vi.fn().mockResolvedValue([
      {
        provider: 'mock',
        providerArtistId: 'remote-1',
        artistName: 'A',
        imageUrl: 'https://example.test/avatar.jpg',
        confidence: 0.7,
        sourceUrl: 'https://example.test/artist',
      },
    ]);
    const service = createService(database, createProvider(providerSearch));

    const result = await service.refreshArtistImage('artist-1', true);

    expect(result.entry).toMatchObject({
      status: 'not_found',
      failureReason: 'low_confidence',
      confidence: 0.7,
    });
    database.close();
  });

  it('rejects QQ Music default artist avatar image content', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'Default Avatar Artist');
    const providerSearch = vi.fn().mockResolvedValue([
      {
        provider: 'qqmusic',
        providerArtistId: 'default-avatar',
        artistName: 'Default Avatar Artist',
        imageUrl: 'https://y.gtimg.cn/music/photo_new/T001R500x500M000artist-photo.jpg',
        confidence: 0.96,
      },
    ]);
    const service = createService(database, createProvider(providerSearch), makeTempRoot(), {
      fetchImageData: qqDefaultArtistAvatar(),
    });

    const result = await service.refreshArtistImage('artist-1', true);

    expect(result.entry).toMatchObject({
      status: 'not_found',
      failureReason: 'artist_image_default_placeholder',
    });
    database.close();
  });

  it('skips obvious platform default avatar URLs before downloading', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'Default Url Artist');
    const providerSearch = vi.fn().mockResolvedValue([
      {
        provider: 'netease',
        providerArtistId: 'default-url',
        artistName: 'Default Url Artist',
        imageUrl: 'https://p2.music.126.net/artist_default.png?param=600y600',
        confidence: 0.96,
      },
    ]);
    const fetchImage = vi.fn(async (url: string) => ({
      data: validPng(),
      mimeType: 'image/png',
      sourceHash: `hash:${url}`,
    }));
    const service = createService(database, createProvider(providerSearch), makeTempRoot(), { fetchImage });

    const result = await service.refreshArtistImage('artist-1', true);

    expect(fetchImage).not.toHaveBeenCalled();
    expect(result.entry).toMatchObject({
      status: 'not_found',
      failureReason: 'artist_image_default_placeholder',
    });
    database.close();
  });

  it('stores a NetEase match when QQ Music has no candidates', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'Arika');
    const qqSearch = vi.fn().mockResolvedValue([]);
    const neteaseSearch = vi.fn().mockResolvedValue([
      {
        provider: 'netease',
        providerArtistId: '55240314',
        artistName: 'Arika',
        imageUrl: 'https://p2.music.126.net/arika.jpg?param=500y500',
        confidence: 0.96,
        sourceUrl: 'https://music.163.com/#/artist?id=55240314',
      },
    ]);
    const service = createService(database, [
      createProvider(qqSearch, 'qqmusic'),
      createProvider(neteaseSearch, 'netease'),
    ]);

    const result = await service.refreshArtistImage('artist-1', true);

    expect(qqSearch).toHaveBeenCalledTimes(1);
    expect(neteaseSearch).toHaveBeenCalledTimes(1);
    expect(result.entry).toMatchObject({
      status: 'matched',
      provider: 'netease',
      providerArtistId: '55240314',
      confidence: 0.96,
    });
    database.close();
  });

  it('keeps searching other providers when one provider fails', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'Arika');
    const qqSearch = vi.fn().mockRejectedValue(new Error('qqmusic_down'));
    const neteaseSearch = vi.fn().mockResolvedValue([
      {
        provider: 'netease',
        providerArtistId: '55240314',
        artistName: 'Arika',
        imageUrl: 'https://p2.music.126.net/arika.jpg?param=500y500',
        confidence: 0.96,
      },
    ]);
    const service = createService(database, [
      createProvider(qqSearch, 'qqmusic'),
      createProvider(neteaseSearch, 'netease'),
    ]);

    const result = await service.refreshArtistImage('artist-1', true);

    expect(result.entry).toMatchObject({
      status: 'matched',
      provider: 'netease',
      confidence: 0.96,
    });
    database.close();
  });

  it('uses a rotated first-pass provider before touching every primary provider', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'Artist One');
    const qqSearch = vi.fn().mockResolvedValue([
      {
        provider: 'qqmusic',
        providerArtistId: 'qq-artist-one',
        artistName: 'Artist One',
        imageUrl: 'https://y.gtimg.cn/arika.jpg',
        confidence: 0.96,
      },
    ]);
    const neteaseSearch = vi.fn().mockResolvedValue([]);
    const kuwoSearch = vi.fn().mockResolvedValue([
      {
        provider: 'kuwo',
        providerArtistId: 'kuwo-artist-one',
        artistName: 'Artist One',
        imageUrl: 'https://img2.kuwo.cn/star/starheads/500/artist-one.jpg',
        confidence: 0.96,
      },
    ]);
    const kugouSearch = vi.fn().mockResolvedValue([]);
    const miguSearch = vi.fn().mockResolvedValue([]);
    const service = createService(database, [
      createProvider(qqSearch, 'qqmusic'),
      createProvider(neteaseSearch, 'netease'),
      createProvider(kuwoSearch, 'kuwo'),
      createProvider(kugouSearch, 'kugou'),
      createProvider(miguSearch, 'migu'),
    ]);

    const result = await service.refreshArtistImage('artist-1', true);

    expect(result.entry).toMatchObject({
      status: 'matched',
      provider: 'kuwo',
      providerArtistId: 'kuwo-artist-one',
      confidence: 0.96,
    });
    expect(kuwoSearch).toHaveBeenCalledTimes(1);
    expect(kugouSearch).toHaveBeenCalledTimes(1);
    expect(miguSearch).toHaveBeenCalledTimes(1);
    expect(neteaseSearch).not.toHaveBeenCalled();
    expect(qqSearch).not.toHaveBeenCalled();
    database.close();
  });

  it('uses NetEase when the rotated first-pass providers are too weak', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'Artist One');
    const qqSearch = vi.fn().mockResolvedValue([
      {
        provider: 'qqmusic',
        providerArtistId: 'qq-artist-one',
        artistName: 'Artist One Fan Page',
        imageUrl: 'https://y.gtimg.cn/arika.jpg',
        confidence: 0.72,
      },
    ]);
    const neteaseSearch = vi.fn().mockResolvedValue([
      {
        provider: 'netease',
        providerArtistId: '55240314',
        artistName: 'Artist One',
        imageUrl: 'https://p2.music.126.net/arika.jpg?param=500y500',
        confidence: 0.96,
      },
    ]);
    const kuwoSearch = vi.fn().mockResolvedValue([
      {
        provider: 'kuwo',
        providerArtistId: 'kuwo-artist-one',
        artistName: 'Artist One Fan Page',
        imageUrl: 'https://img2.kuwo.cn/star/starheads/500/artist-one.jpg',
        confidence: 0.72,
      },
    ]);
    const kugouSearch = vi.fn().mockResolvedValue([]);
    const miguSearch = vi.fn().mockResolvedValue([]);
    const service = createService(database, [
      createProvider(qqSearch, 'qqmusic'),
      createProvider(neteaseSearch, 'netease'),
      createProvider(kuwoSearch, 'kuwo'),
      createProvider(kugouSearch, 'kugou'),
      createProvider(miguSearch, 'migu'),
    ]);

    const result = await service.refreshArtistImage('artist-1', true);

    expect(kuwoSearch).toHaveBeenCalledTimes(1);
    expect(kugouSearch).toHaveBeenCalledTimes(1);
    expect(miguSearch).toHaveBeenCalledTimes(1);
    expect(qqSearch).toHaveBeenCalledTimes(1);
    expect(neteaseSearch).toHaveBeenCalledTimes(1);
    expect(result.entry).toMatchObject({
      status: 'matched',
      provider: 'netease',
      providerArtistId: '55240314',
      confidence: 0.96,
    });
    database.close();
  });

  it('rotates same-confidence primary providers by artist key instead of always preferring NetEase quality', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'Arika');
    const qqSearch = vi.fn().mockResolvedValue([
      {
        provider: 'qqmusic',
        providerArtistId: 'qq-arika',
        artistName: 'Arika',
        imageUrl: 'https://y.gtimg.cn/arika.jpg',
        confidence: 0.96,
        quality: 500,
      },
    ]);
    const neteaseSearch = vi.fn().mockResolvedValue([
      {
        provider: 'netease',
        providerArtistId: 'netease-arika',
        artistName: 'Arika',
        imageUrl: 'https://p2.music.126.net/arika.jpg?param=1000y1000',
        confidence: 0.96,
        quality: 1000,
      },
    ]);
    const kuwoSearch = vi.fn().mockResolvedValue([
      {
        provider: 'kuwo',
        providerArtistId: 'kuwo-arika',
        artistName: 'Arika',
        imageUrl: 'https://img2.kuwo.cn/star/starheads/500/arika.jpg',
        confidence: 0.96,
        quality: 500,
      },
    ]);
    const service = createService(database, [
      createProvider(qqSearch, 'qqmusic'),
      createProvider(neteaseSearch, 'netease'),
      createProvider(kuwoSearch, 'kuwo'),
    ]);

    const result = await service.refreshArtistImage('artist-1', true);

    expect(result.entry).toMatchObject({
      status: 'matched',
      provider: 'kuwo',
      providerArtistId: 'kuwo-arika',
      confidence: 0.96,
    });
    database.close();
  });

  it('waits for same-tier primary providers and chooses the best domestic match', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'Arika');
    const kuwoDeferred = createDeferred<ArtistImageCandidate[]>();
    const qqSearch = vi.fn().mockResolvedValue([
      {
        provider: 'qqmusic',
        providerArtistId: 'qq-arika',
        artistName: 'Arika Fan Page',
        imageUrl: 'https://y.gtimg.cn/arika.jpg',
        confidence: 0.86,
      },
    ]);
    const kuwoSearch = vi.fn().mockReturnValue(kuwoDeferred.promise);
    const service = createService(database, [
      createProvider(qqSearch, 'qqmusic'),
      createProvider(kuwoSearch, 'kuwo'),
    ]);

    const resultPromise = service.refreshArtistImage('artist-1', true);
    await waitFor(() => kuwoSearch.mock.calls.length === 1);
    await delay(20);

    expect(service.getJobStatus().active).toBe(1);

    kuwoDeferred.resolve([
      {
        provider: 'kuwo',
        providerArtistId: 'kuwo-arika',
        artistName: 'Arika',
        imageUrl: 'https://img2.kuwo.cn/star/starheads/500/arika.jpg',
        confidence: 0.96,
      },
    ]);
    const result = await resultPromise;

    expect(kuwoSearch).toHaveBeenCalledTimes(1);
    expect(result.entry).toMatchObject({
      status: 'matched',
      provider: 'kuwo',
      providerArtistId: 'kuwo-arika',
    });
    database.close();
  });

  it('stores not_found only when all providers return no candidates', async () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'Missing Artist');
    const qqSearch = vi.fn().mockResolvedValue([]);
    const neteaseSearch = vi.fn().mockResolvedValue([]);
    const service = createService(database, [
      createProvider(qqSearch, 'qqmusic'),
      createProvider(neteaseSearch, 'netease'),
    ]);

    const result = await service.refreshArtistImage('artist-1', true);

    expect(result.entry).toMatchObject({
      status: 'not_found',
      failureReason: 'all_providers_no_result',
    });
    database.close();
  });

  it('getArtists returns cached local artist avatar URLs', () => {
    const database = createDatabase(':memory:');
    const artistKey = insertArtist(database, 'artist-1', 'Echo Artist');
    insertCache(database, artistKey, 'matched', {
      thumbPath: 'D:/cache/thumb.webp',
      mediumPath: 'D:/cache/medium.webp',
      largePath: 'D:/cache/large.webp',
      sourceHash: artistImageCacheSourceHash('old'),
      confidence: 0.96,
    });
    const store = new LibraryStore(database);

    const artist = store.getArtists({ pageSize: 1 }).items[0];

    expect(artist.avatarThumbUrl).toBe(`echo-artist-image://thumb/${encodeURIComponent(artistKey)}`);
    expect(artist.avatarUrl).toBe(`echo-artist-image://large/${encodeURIComponent(artistKey)}`);
    expect(artist.avatarStatus).toBe('matched');
    expect(artist.avatarProvider).toBe('qqmusic');
    database.close();
  });

  it('can prioritize artists with cached avatars before the selected artist sort', () => {
    const database = createDatabase(':memory:');
    insertArtist(database, 'artist-1', 'Alpha No Avatar');
    const avatarArtistKey = insertArtist(database, 'artist-2', 'Zulu Avatar');
    insertCache(database, avatarArtistKey, 'matched', {
      thumbPath: 'D:/cache/thumb.webp',
      sourceHash: artistImageCacheSourceHash('avatar'),
      confidence: 0.96,
    });
    const store = new LibraryStore(database);

    expect(store.getArtists({ pageSize: 10, sort: 'titleAsc' }).items.map((artist) => artist.name)).toEqual([
      'Alpha No Avatar',
      'Zulu Avatar',
    ]);
    expect(store.getArtists({ pageSize: 10, sort: 'titleAsc', prioritizeArtistAvatars: true }).items.map((artist) => artist.name)).toEqual([
      'Zulu Avatar',
      'Alpha No Avatar',
    ]);
    database.close();
  });

  it('does not resolve image paths outside the artist image cache directory', () => {
    const database = createDatabase(':memory:');
    const artistKey = insertArtist(database, 'artist-1', 'Echo Artist');
    insertCache(database, artistKey, 'matched', {
      thumbPath: 'D:/outside/thumb.webp',
      mediumPath: 'D:/outside/medium.webp',
      largePath: 'D:/outside/large.webp',
      sourceHash: artistImageCacheSourceHash('old'),
      confidence: 0.96,
    });
    const providerSearch = vi.fn();
    const service = createService(database, createProvider(providerSearch));

    expect(service.resolveAsset(artistKey, 'thumb')).toBeNull();
    database.close();
  });
});
