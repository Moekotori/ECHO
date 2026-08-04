import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from './LibraryService';
import type { LibraryDiagnostics } from './libraryTypes';

const electronWindows = vi.hoisted(
  () => [] as Array<{ webContents: { send: ReturnType<typeof vi.fn> } }>,
);

vi.mock('electron', () => ({
  default: {
    BrowserWindow: {
      getAllWindows: () => electronWindows,
    },
  },
}));

let playbackState: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' = 'idle';

vi.mock('../audio/AudioSession', () => ({
  getAudioSession: () => ({
    getStatus: () => ({
      state: playbackState,
      currentFilePath: null,
    }),
  }),
}));

class FakeStore {
  refreshAlbumsCalls = 0;
  refreshArtistsCalls = 0;
  markMissingCalls = 0;
  removeFolderCalls = 0;
  addedFolders: string[] = [];
  shouldThrowRefresh = false;

  transaction<T>(work: () => T): T {
    return work();
  }

  refreshAlbums(): void {
    this.refreshAlbumsCalls += 1;
    if (this.shouldThrowRefresh) {
      throw new Error('grouping failed');
    }
  }

  refreshArtists(): void {
    this.refreshArtistsCalls += 1;
  }

  getArtists(): { items: unknown[]; page: number; pageSize: number; total: number; hasMore: boolean } {
    return {
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
      hasMore: false,
    };
  }

  getPlaceholderMetadataTrackCount(): number {
    return 0;
  }

  markTracksMissingByPaths(): number {
    this.markMissingCalls += 1;
    return 1;
  }

  async removeFolder(): Promise<void> {
    this.removeFolderCalls += 1;
  }

  addFolder(folderPath: string): { id: string; path: string; status: 'active' } {
    this.addedFolders.push(folderPath);
    return { id: `folder-${this.addedFolders.length}`, path: folderPath, status: 'active' };
  }

  getDiagnostics(): LibraryDiagnostics {
    return {
      foldersCount: 0,
      tracksCount: 0,
      albumsCount: 0,
      artistsCount: 0,
      coversCount: 0,
      lastScan: null,
      lastQueryMs: { getTracks: null, getAlbums: null },
      averageAlbumPayloadBytes: null,
      databasePath: null,
      databaseSizeBytes: null,
      coverCachePath: null,
      coverCacheSizeBytes: null,
      coverCacheVersion: 0,
      cpuCount: 1,
      scanPerformanceMode: 'balanced',
      metadataConcurrency: 1,
      coverConcurrency: 1,
    };
  }
}

const createService = (store = new FakeStore(), liveLibraryUpdatesEnabled = false): LibraryService =>
  new LibraryService(
    store as never,
    { hasRunningJobs: () => false } as never,
    {} as never,
    {
      exec: () => undefined,
      prepare: () => ({
        all: () => [],
        get: () => null,
        run: () => ({ changes: 0 }),
      }),
    } as never,
    () => undefined,
    'test.sqlite',
    'covers',
    {} as never,
    {} as never,
    null,
    null,
    null,
    null,
    () =>
      ({
        albumMergeStrategy: 'standard',
        liveLibraryUpdatesEnabled,
        liveLibraryAutoHideDeletedEnabled: true,
        autoFetchArtistImages: false,
        audioAnalysisEnabled: true,
      }) as never,
    {
      cpuCount: 1,
      mode: 'balanced',
      metadataConcurrency: 1,
      coverConcurrency: 1,
    },
  );

const createFakeWatcher = () => ({
  setEnabled: vi.fn(),
  setAutoRescanEnabled: vi.fn(),
  isRunning: vi.fn(() => true),
  restart: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  getDiagnostics: vi.fn(() => ({
    enabled: true,
    autoRescanEnabled: true,
    watchedFolderCount: 1,
    totalEventCount: 0,
    recentEvents: [],
    eventStormCount: 0,
    pendingPathCount: 0,
    droppedPathCount: 0,
    triggeredRescanCount: 0,
    skippedDeleteEventCount: 0,
    skippedRenameEventCount: 0,
    lastError: null,
    lastTriggeredRescanAt: null,
    lastRescanError: null,
    startedAt: null,
    stoppedAt: null,
  })),
});

afterEach(() => {
  vi.useRealTimers();
  playbackState = 'idle';
  electronWindows.length = 0;
});

describe('LibraryService grouping refresh scheduling', () => {
  it('defers grouping refresh while playback is active and runs once after playback stops', async () => {
    const store = new FakeStore();
    const service = createService(store);
    const scheduled = service as unknown as {
      groupingRefreshQueued: boolean;
      runScheduledGroupingRefresh: () => Promise<void>;
      close: () => void;
    };

    playbackState = 'playing';
    scheduled.groupingRefreshQueued = true;
    await scheduled.runScheduledGroupingRefresh();

    expect(store.refreshAlbumsCalls).toBe(0);
    expect(store.refreshArtistsCalls).toBe(0);
    expect(service.getDiagnostics().groupingRefreshQueued).toBe(true);
    expect(service.getDiagnostics().groupingRefreshDelayedForPlaybackCount).toBe(1);

    playbackState = 'stopped';
    await scheduled.runScheduledGroupingRefresh();

    expect(store.refreshAlbumsCalls).toBe(1);
    expect(store.refreshArtistsCalls).toBe(1);
    expect(service.getDiagnostics().groupingRefreshQueued).toBe(false);
    expect(service.getDiagnostics().lastGroupingRefreshDurationMs).not.toBeNull();
    expect(service.getDiagnostics().lastGroupingRefreshAt).not.toBeNull();
    expect(service.getDiagnostics().lastGroupingRefreshError).toBeNull();
    scheduled.close();
  });

  it('coalesces repeated grouping refresh requests into one refresh', async () => {
    const store = new FakeStore();
    const service = createService(store);
    const scheduled = service as unknown as {
      groupingRefreshQueued: boolean;
      runScheduledGroupingRefresh: () => Promise<void>;
      close: () => void;
    };

    scheduled.groupingRefreshQueued = true;
    scheduled.groupingRefreshQueued = true;
    await scheduled.runScheduledGroupingRefresh();

    expect(store.refreshAlbumsCalls).toBe(1);
    expect(store.refreshArtistsCalls).toBe(1);
    scheduled.close();
  });

  it('notifies library views after a deferred album grouping refresh completes', async () => {
    const store = new FakeStore();
    const webContents = { send: vi.fn() };
    electronWindows.push({ webContents });
    const service = createService(store);
    const scheduled = service as unknown as {
      groupingRefreshQueued: boolean;
      runScheduledGroupingRefresh: () => Promise<void>;
      close: () => void;
    };

    scheduled.groupingRefreshQueued = true;
    await scheduled.runScheduledGroupingRefresh();

    expect(store.refreshAlbumsCalls).toBe(1);
    expect(webContents.send).toHaveBeenCalledWith('library:changed');
    scheduled.close();
  });

  it('removing a folder queues grouping refresh instead of rebuilding immediately during playback', async () => {
    const store = new FakeStore();
    const webContents = { send: vi.fn() };
    electronWindows.push({ webContents });
    const service = createService(store);

    playbackState = 'playing';
    await service.removeFolder('folder-1');

    expect(store.removeFolderCalls).toBe(1);
    expect(store.refreshAlbumsCalls).toBe(0);
    expect(store.refreshArtistsCalls).toBe(0);
    expect(service.getDiagnostics().groupingRefreshQueued).toBe(true);
    expect(webContents.send).toHaveBeenCalledWith('library:changed');
    service.close();
  });

  it('refreshes live watcher subscriptions after adding a library folder', () => {
    const root = join(tmpdir(), `echo-next-live-watcher-add-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(root, { recursive: true });
    const store = new FakeStore();
    const service = createService(store, true);
    const watcher = createFakeWatcher();
    (service as unknown as { watcherService: typeof watcher }).watcherService = watcher;

    try {
      const folder = service.addFolder(root);

      expect(folder.path).toBe(root);
      expect(store.addedFolders).toEqual([root]);
      expect(watcher.setEnabled).toHaveBeenCalledWith(true);
      expect(watcher.setAutoRescanEnabled).toHaveBeenCalledWith(true);
      expect(watcher.restart).toHaveBeenCalledTimes(1);
      expect(watcher.start).not.toHaveBeenCalled();
    } finally {
      service.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('refreshes live watcher subscriptions after removing a library folder', async () => {
    const store = new FakeStore();
    const service = createService(store, true);
    const watcher = createFakeWatcher();
    (service as unknown as { watcherService: typeof watcher }).watcherService = watcher;

    await service.removeFolder('folder-1');

    expect(store.removeFolderCalls).toBe(1);
    expect(watcher.setEnabled).toHaveBeenCalledWith(true);
    expect(watcher.setAutoRescanEnabled).toHaveBeenCalledWith(true);
    expect(watcher.restart).toHaveBeenCalledTimes(1);
    expect(watcher.start).not.toHaveBeenCalled();
    service.close();
  });

  it('records grouping refresh errors in diagnostics', async () => {
    const store = new FakeStore();
    store.shouldThrowRefresh = true;
    const service = createService(store);
    const scheduled = service as unknown as {
      groupingRefreshQueued: boolean;
      runScheduledGroupingRefresh: () => Promise<void>;
      close: () => void;
    };

    scheduled.groupingRefreshQueued = true;
    await scheduled.runScheduledGroupingRefresh();

    expect(service.getDiagnostics().lastGroupingRefreshError).toBe('grouping failed');
    expect(service.getDiagnostics().lastGroupingRefreshDurationMs).not.toBeNull();
    scheduled.close();
  });

});
