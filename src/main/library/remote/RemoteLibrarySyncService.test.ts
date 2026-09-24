import { describe, expect, it, vi } from 'vitest';
import type { RemoteSourceAdapter } from './remoteTypes';
import type { RemoteLibraryStore } from './RemoteLibraryStore';
import { RemoteLibrarySyncService } from './RemoteLibrarySyncService';

const waitForSettled = async (service: RemoteLibrarySyncService): Promise<void> => {
  for (let index = 0; index < 100; index += 1) {
    if (service.getSyncStatus('source-1').status !== 'running') return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('sync did not settle');
};

const source = {
  id: 'source-1', provider: 'webdav', displayName: 'Remote', status: 'enabled', baseUrl: 'https://example.test',
  username: null, authType: 'none', config: {}, syncMode: 'index', lastTestAt: null, lastSyncAt: null,
  lastError: null, indexedTrackCount: 1, createdAt: '', updatedAt: '', secret: null,
} as const;

describe('RemoteLibrarySyncService completeness', () => {
  it('keeps old tracks when enumeration is partial and reports partial', async () => {
    const markMissingExcept = vi.fn();
    const store = {
      getSourceWithSecret: () => source,
      getComparableFingerprints: () => new Map(),
      updateSourceTestResult: vi.fn(), updateSourceSyncResult: vi.fn(),
      prepareSearchTermsForTracks: async () => new Map(), upsertTracks: vi.fn(), markMissingExcept,
    } as unknown as RemoteLibraryStore;
    const adapter = {
      provider: 'webdav', testConnection: async () => ({ ok: true, message: 'ok', testedAt: '' }),
      async *scan(input: Parameters<RemoteSourceAdapter['scan']>[0]) {
        yield* [];
        input.onError?.('/failed', new Error('503'));
      },
    } as unknown as RemoteSourceAdapter;
    const service = new RemoteLibrarySyncService(store, () => adapter);

    service.syncSource(source.id);
    await waitForSettled(service);

    expect(service.getSyncStatus(source.id).status).toBe('partial');
    expect(markMissingExcept).not.toHaveBeenCalled();
  });

  it('restores an unchanged missing track without rewriting metadata', async () => {
    const markTracksSeen = vi.fn();
    const upsertTracks = vi.fn();
    const store = {
      getSourceWithSecret: () => source,
      getComparableFingerprints: () => new Map([['/song.flac', { etag: 'e', modifiedAt: 'm', sizeBytes: 1, coverId: null }]]),
      updateSourceTestResult: vi.fn(), updateSourceSyncResult: vi.fn(), markTracksSeen,
      prepareSearchTermsForTracks: async () => new Map(), upsertTracks, markMissingExcept: vi.fn(() => 0),
    } as unknown as RemoteLibraryStore;
    const adapter = {
      provider: 'webdav', testConnection: async () => ({ ok: true, message: 'ok', testedAt: '' }),
      async *scan() { yield { path: '/song.flac', name: 'song.flac', etag: 'e', modifiedAt: 'm', sizeBytes: 1, stableKey: 's' }; },
    } as unknown as RemoteSourceAdapter;
    const service = new RemoteLibrarySyncService(store, () => adapter);

    service.syncSource(source.id);
    await waitForSettled(service);

    expect(markTracksSeen).toHaveBeenCalledWith(source.id, ['/song.flac']);
    expect(upsertTracks).not.toHaveBeenCalled();
  });

  it('marks unchanged tracks seen in bounded batches', async () => {
    const markTracksSeen = vi.fn();
    const fingerprints = new Map(
      Array.from({ length: 151 }, (_, index) => [`/song-${index}.flac`, { etag: 'e', modifiedAt: 'm', sizeBytes: 1, coverId: null }]),
    );
    const store = {
      getSourceWithSecret: () => source,
      getComparableFingerprints: () => fingerprints,
      updateSourceTestResult: vi.fn(), updateSourceSyncResult: vi.fn(), markTracksSeen,
      prepareSearchTermsForTracks: async () => new Map(), upsertTracks: vi.fn(), markMissingExcept: vi.fn(() => 0),
    } as unknown as RemoteLibraryStore;
    const adapter = {
      provider: 'webdav', testConnection: async () => ({ ok: true, message: 'ok', testedAt: '' }),
      async *scan() {
        for (let index = 0; index < 151; index += 1) {
          yield { path: `/song-${index}.flac`, name: `song-${index}.flac`, etag: 'e', modifiedAt: 'm', sizeBytes: 1, stableKey: `s-${index}` };
        }
      },
    } as unknown as RemoteSourceAdapter;
    const service = new RemoteLibrarySyncService(store, () => adapter);

    service.syncSource(source.id);
    await waitForSettled(service);

    expect(markTracksSeen).toHaveBeenCalledTimes(2);
    expect(markTracksSeen.mock.calls[0]?.[1]).toHaveLength(150);
    expect(markTracksSeen.mock.calls[1]?.[1]).toEqual(['/song-150.flac']);
  });

  it('previews additions, updates, and missing tracks without writing', async () => {
    const upsertTracks = vi.fn();
    const markMissingExcept = vi.fn();
    const store = {
      getSourceWithSecret: () => source,
      getComparableFingerprints: () => new Map([
        ['/same.flac', { etag: 'same', modifiedAt: '1', sizeBytes: 1, coverId: null }],
        ['/changed.flac', { etag: 'old', modifiedAt: '1', sizeBytes: 1, coverId: null }],
        ['/missing.flac', { etag: 'missing', modifiedAt: '1', sizeBytes: 1, coverId: null }],
      ]),
      getProviderScanCache: vi.fn(() => null),
      upsertTracks,
      markMissingExcept,
      updateSourceTestResult: vi.fn(),
      updateSourceSyncResult: vi.fn(),
    } as unknown as RemoteLibraryStore;
    const adapter = {
      provider: 'webdav',
      testConnection: async () => ({ ok: true, message: 'ok', testedAt: '' }),
      async *scan() {
        yield { path: '/same.flac', name: 'same.flac', etag: 'same', modifiedAt: '1', sizeBytes: 1, stableKey: 'same' };
        yield { path: '/changed.flac', name: 'changed.flac', etag: 'new', modifiedAt: '2', sizeBytes: 2, stableKey: 'changed' };
        yield { path: '/new.flac', name: 'new.flac', etag: 'new', modifiedAt: '1', sizeBytes: 1, stableKey: 'new' };
      },
    } as unknown as RemoteSourceAdapter;
    const service = new RemoteLibrarySyncService(store, () => adapter);

    const preview = await service.previewSync(source.id);

    expect(preview).toMatchObject({
      discoveredCount: 3,
      addedCount: 1,
      updatedCount: 1,
      unchangedCount: 1,
      missingCount: 1,
      failedCount: 0,
      complete: true,
    });
    expect(upsertTracks).not.toHaveBeenCalled();
    expect(markMissingExcept).not.toHaveBeenCalled();
  });
});
