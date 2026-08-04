import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  LIBRARY_WATCHER_AUTO_RESCAN_FEATURE_FLAG,
  LIBRARY_WATCHER_FEATURE_FLAG,
  LibraryWatcherService,
  classifyNodeWatcherEvent,
  isLibraryWatcherAutoRescanEnabled,
  isLibraryWatcherFeatureEnabled,
} from './LibraryWatcherService';
import type { FileSystemWatcherAdapter, LibraryWatcherFolder, LibraryWatcherRawEvent } from './LibraryWatcherService';

class FakeWatcherAdapter implements FileSystemWatcherAdapter {
  readonly subscriptions: Array<{ folder: LibraryWatcherFolder; closed: boolean }> = [];
  private callbacks: Array<(event: LibraryWatcherRawEvent) => void> = [];

  watch(folder: LibraryWatcherFolder, onEvent: (event: LibraryWatcherRawEvent) => void): { close: () => void } {
    const subscription = { folder, closed: false };
    this.subscriptions.push(subscription);
    this.callbacks.push(onEvent);

    return {
      close: () => {
        subscription.closed = true;
      },
    };
  }

  emit(event: LibraryWatcherRawEvent): void {
    for (const callback of this.callbacks) {
      callback(event);
    }
  }
}

const createFolder = (overrides: Partial<LibraryWatcherFolder> = {}): LibraryWatcherFolder => ({
  id: 'folder-1',
  path: 'D:\\Music',
  enabled: true,
  ...overrides,
});

const flushWatcherTimers = async (debounceMs = 20, stabilityPollMs = 20): Promise<void> => {
  await vi.advanceTimersByTimeAsync(debounceMs);
  await vi.advanceTimersByTimeAsync(stabilityPollMs);
};

const flushStableAutoRescanTimers = async (debounceMs = 5, stabilityPollMs = 5, rescanDebounceMs = 10): Promise<void> => {
  await vi.advanceTimersByTimeAsync(debounceMs);
  await vi.advanceTimersByTimeAsync(stabilityPollMs);
  await vi.advanceTimersByTimeAsync(rescanDebounceMs);
};

describe('LibraryWatcherService', () => {
  it('classifies Node rename events for existing files as add so Windows drops can rescan', () => {
    const root = join(tmpdir(), `echo-next-watcher-node-event-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(root, { recursive: true });
    const filePath = join(root, 'new-song.flac');
    writeFileSync(filePath, 'audio');

    expect(classifyNodeWatcherEvent('rename', filePath)).toBe('add');
    expect(classifyNodeWatcherEvent('rename', join(root, 'deleted-song.flac'))).toBe('unlink');
    expect(classifyNodeWatcherEvent('change', filePath)).toBe('change');

    rmSync(root, { recursive: true, force: true });
  });

  it('requires an explicit feature flag value to opt in', () => {
    expect(isLibraryWatcherFeatureEnabled({})).toBe(false);
    expect(isLibraryWatcherFeatureEnabled({ [LIBRARY_WATCHER_FEATURE_FLAG]: '0' })).toBe(false);
    expect(isLibraryWatcherFeatureEnabled({ [LIBRARY_WATCHER_FEATURE_FLAG]: 'true' })).toBe(true);
    expect(isLibraryWatcherFeatureEnabled({ [LIBRARY_WATCHER_FEATURE_FLAG]: '1' })).toBe(true);
    expect(isLibraryWatcherAutoRescanEnabled({})).toBe(false);
    expect(isLibraryWatcherAutoRescanEnabled({ [LIBRARY_WATCHER_AUTO_RESCAN_FEATURE_FLAG]: '0' })).toBe(false);
    expect(isLibraryWatcherAutoRescanEnabled({ [LIBRARY_WATCHER_AUTO_RESCAN_FEATURE_FLAG]: 'on' })).toBe(true);
  });

  it('is disabled by default and does not watch folders', () => {
    const adapter = new FakeWatcherAdapter();
    const readFolders = vi.fn(() => [createFolder()]);
    const service = new LibraryWatcherService({
      readFolders,
      adapter,
    });

    const diagnostics = service.start();

    expect(diagnostics.enabled).toBe(false);
    expect(diagnostics.watchedFolderCount).toBe(0);
    expect(readFolders).not.toHaveBeenCalled();
    expect(adapter.subscriptions).toHaveLength(0);
  });

  it('can be enabled for the current session without an environment flag', () => {
    const adapter = new FakeWatcherAdapter();
    const service = new LibraryWatcherService({
      readFolders: () => [createFolder()],
      adapter,
    });

    service.setEnabled(true);
    const diagnostics = service.start();

    expect(diagnostics.enabled).toBe(true);
    expect(diagnostics.watchedFolderCount).toBe(1);
    expect(service.isRunning()).toBe(true);

    service.stop();
  });

  it('keeps start and stop idempotent', () => {
    const adapter = new FakeWatcherAdapter();
    const service = new LibraryWatcherService({
      enabled: true,
      readFolders: () => [createFolder()],
      adapter,
    });

    service.start();
    service.start();
    expect(adapter.subscriptions).toHaveLength(1);
    expect(service.getDiagnostics().watchedFolderCount).toBe(1);

    service.stop();
    service.stop();
    expect(adapter.subscriptions[0].closed).toBe(true);
    expect(service.getDiagnostics().watchedFolderCount).toBe(0);
  });

  it('coalesces repeated events for the same audio path', async () => {
    vi.useFakeTimers();
    const adapter = new FakeWatcherAdapter();
    const service = new LibraryWatcherService({
      enabled: true,
      readFolders: () => [createFolder()],
      adapter,
      debounceMs: 20,
      stabilityPollMs: 20,
      statFile: () => ({ sizeBytes: 128, mtimeMs: 2000 }),
    });
    service.start();

    adapter.emit({ folderId: 'folder-1', eventType: 'change', path: 'D:\\Music\\song.flac' });
    adapter.emit({ folderId: 'folder-1', eventType: 'change', path: 'D:\\Music\\song.flac' });
    adapter.emit({ folderId: 'folder-1', eventType: 'change', path: 'D:\\Music\\song.flac' });
    await flushWatcherTimers();

    const diagnostics = service.getDiagnostics();
    expect(diagnostics.totalEventCount).toBe(3);
    expect(diagnostics.recentEvents).toHaveLength(1);
    expect(diagnostics.recentEvents[0]).toMatchObject({
      folderId: 'folder-1',
      eventType: 'change',
      path: 'D:\\Music\\song.flac',
      extension: '.flac',
      sizeBytes: 128,
      mtimeMs: 2000,
    });
    expect(diagnostics.recentEvents[0].stableForMs).toBeGreaterThanOrEqual(40);

    service.stop();
    vi.useRealTimers();
  });

  it('caps recent events at 100 entries', async () => {
    vi.useFakeTimers();
    const adapter = new FakeWatcherAdapter();
    const service = new LibraryWatcherService({
      enabled: true,
      readFolders: () => [createFolder()],
      adapter,
      debounceMs: 1,
      stabilityPollMs: 1,
      statFile: () => ({ sizeBytes: 1, mtimeMs: 1 }),
    });
    service.start();

    for (let index = 0; index < 105; index += 1) {
      adapter.emit({ folderId: 'folder-1', eventType: 'add', path: `D:\\Music\\track-${index}.mp3` });
      await flushWatcherTimers(1, 1);
    }

    const diagnostics = service.getDiagnostics();
    expect(diagnostics.recentEvents).toHaveLength(100);
    expect(diagnostics.recentEvents[0].path).toBe('D:\\Music\\track-5.mp3');
    expect(diagnostics.recentEvents[99].path).toBe('D:\\Music\\track-104.mp3');

    service.stop();
    vi.useRealTimers();
  });

  it('ignores temporary and non-audio files', async () => {
    vi.useFakeTimers();
    const adapter = new FakeWatcherAdapter();
    const service = new LibraryWatcherService({
      enabled: true,
      readFolders: () => [createFolder()],
      adapter,
      debounceMs: 5,
      stabilityPollMs: 5,
      statFile: () => ({ sizeBytes: 99, mtimeMs: 99 }),
    });
    service.start();

    adapter.emit({ folderId: 'folder-1', eventType: 'add', path: 'D:\\Music\\song.mp3.tmp' });
    adapter.emit({ folderId: 'folder-1', eventType: 'add', path: 'D:\\Music\\cover.jpg' });
    adapter.emit({ folderId: 'folder-1', eventType: 'add', path: 'D:\\Music\\library.sqlite' });
    adapter.emit({ folderId: 'folder-1', eventType: 'add', path: 'D:\\Music\\.hidden.mp3' });
    await flushWatcherTimers(5, 5);

    const diagnostics = service.getDiagnostics();
    expect(diagnostics.totalEventCount).toBe(0);
    expect(diagnostics.recentEvents).toHaveLength(0);

    service.stop();
    vi.useRealTimers();
  });

  it('does not mutate LibraryStore track data', async () => {
    vi.useFakeTimers();
    const adapter = new FakeWatcherAdapter();
    const fakeStore = {
      getFolders: vi.fn(() => [createFolder()]),
      insertTrack: vi.fn(),
      updateTrack: vi.fn(),
      removeTrack: vi.fn(),
      markMissingTracks: vi.fn(),
    };
    const service = new LibraryWatcherService({
      enabled: true,
      readFolders: fakeStore.getFolders,
      adapter,
      debounceMs: 5,
      stabilityPollMs: 5,
      statFile: () => ({ sizeBytes: 256, mtimeMs: 3000 }),
    });
    service.start();

    adapter.emit({ folderId: 'folder-1', eventType: 'add', path: 'D:\\Music\\new-song.wav' });
    await flushWatcherTimers(5, 5);

    expect(fakeStore.getFolders).toHaveBeenCalledTimes(1);
    expect(fakeStore.insertTrack).not.toHaveBeenCalled();
    expect(fakeStore.updateTrack).not.toHaveBeenCalled();
    expect(fakeStore.removeTrack).not.toHaveBeenCalled();
    expect(fakeStore.markMissingTracks).not.toHaveBeenCalled();
    expect(service.getDiagnostics().recentEvents).toHaveLength(1);

    service.stop();
    vi.useRealTimers();
  });

  it('keeps auto rescan disabled by default', async () => {
    vi.useFakeTimers();
    const adapter = new FakeWatcherAdapter();
    const rescanPaths = vi.fn();
    const service = new LibraryWatcherService({
      enabled: true,
      readFolders: () => [createFolder()],
      adapter,
      debounceMs: 5,
      stabilityPollMs: 5,
      rescanDebounceMs: 10,
      statFile: () => ({ sizeBytes: 64, mtimeMs: 1000 }),
      rescanCoordinator: { rescanPaths },
    });
    service.start();

    adapter.emit({ folderId: 'folder-1', eventType: 'add', path: 'D:\\Music\\new.flac' });
    await flushStableAutoRescanTimers();

    expect(service.getDiagnostics().autoRescanEnabled).toBe(false);
    expect(service.getDiagnostics().recentEvents).toHaveLength(1);
    expect(rescanPaths).not.toHaveBeenCalled();

    service.stop();
    vi.useRealTimers();
  });

  it('calls rescanPaths for stable add and change events when auto rescan is enabled', async () => {
    vi.useFakeTimers();
    const adapter = new FakeWatcherAdapter();
    const rescanPaths = vi.fn();
    const service = new LibraryWatcherService({
      enabled: true,
      autoRescanEnabled: true,
      readFolders: () => [createFolder()],
      adapter,
      debounceMs: 5,
      stabilityPollMs: 5,
      rescanDebounceMs: 10,
      statFile: () => ({ sizeBytes: 64, mtimeMs: 1000 }),
      rescanCoordinator: { rescanPaths },
    });
    service.start();

    adapter.emit({ folderId: 'folder-1', eventType: 'add', path: 'D:\\Music\\new.flac' });
    adapter.emit({ folderId: 'folder-1', eventType: 'change', path: 'D:\\Music\\changed.mp3' });
    await flushStableAutoRescanTimers();

    expect(rescanPaths).toHaveBeenCalledTimes(1);
    expect(rescanPaths).toHaveBeenCalledWith('folder-1', ['D:\\Music\\new.flac', 'D:\\Music\\changed.mp3']);
    expect(service.getDiagnostics().triggeredRescanCount).toBe(1);
    expect(service.getDiagnostics().pendingPathCount).toBe(0);

    service.stop();
    vi.useRealTimers();
  });

  it('marks deleted audio paths missing, rescans stable rename events, and ignores unknown events', async () => {
    vi.useFakeTimers();
    const adapter = new FakeWatcherAdapter();
    const rescanPaths = vi.fn();
    const markMissingPaths = vi.fn();
    const service = new LibraryWatcherService({
      enabled: true,
      autoRescanEnabled: true,
      readFolders: () => [createFolder()],
      adapter,
      debounceMs: 5,
      stabilityPollMs: 5,
      rescanDebounceMs: 10,
      statFile: () => ({ sizeBytes: 64, mtimeMs: 1000 }),
      rescanCoordinator: { rescanPaths, markMissingPaths },
    });
    service.start();

    adapter.emit({ folderId: 'folder-1', eventType: 'unlink', path: 'D:\\Music\\deleted.flac' });
    adapter.emit({ folderId: 'folder-1', eventType: 'rename', path: 'D:\\Music\\renamed.flac' });
    adapter.emit({ folderId: 'folder-1', eventType: 'unknown', path: 'D:\\Music\\mystery.flac' });
    await flushStableAutoRescanTimers();

    expect(rescanPaths).toHaveBeenCalledWith('folder-1', ['D:\\Music\\renamed.flac']);
    expect(markMissingPaths).toHaveBeenCalledWith('folder-1', ['D:\\Music\\deleted.flac']);
    expect(service.getDiagnostics().skippedDeleteEventCount).toBe(0);
    expect(service.getDiagnostics().skippedRenameEventCount).toBe(0);
    expect(service.getDiagnostics().triggeredRescanCount).toBe(2);
    expect(service.getDiagnostics().recentEvents.map((event) => event.eventType)).toEqual(['unlink', 'unknown', 'add']);

    service.stop();
    vi.useRealTimers();
  });

  it('waits for rename-created files to appear before queuing a rescan', async () => {
    vi.useFakeTimers();
    const adapter = new FakeWatcherAdapter();
    const rescanPaths = vi.fn();
    const statFile = vi
      .fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ sizeBytes: 64, mtimeMs: 1000 })
      .mockReturnValueOnce({ sizeBytes: 64, mtimeMs: 1000 });
    const service = new LibraryWatcherService({
      enabled: true,
      autoRescanEnabled: true,
      readFolders: () => [createFolder()],
      adapter,
      debounceMs: 5,
      stabilityPollMs: 5,
      rescanDebounceMs: 10,
      statFile,
      rescanCoordinator: { rescanPaths },
    });
    service.start();

    adapter.emit({ folderId: 'folder-1', eventType: 'rename', path: 'D:\\Music\\late.flac' });
    await vi.advanceTimersByTimeAsync(5);
    expect(rescanPaths).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(10);

    expect(rescanPaths).toHaveBeenCalledTimes(1);
    expect(rescanPaths).toHaveBeenCalledWith('folder-1', ['D:\\Music\\late.flac']);
    expect(service.getDiagnostics().recentEvents.map((event) => event.eventType)).toEqual(['add']);

    service.stop();
    vi.useRealTimers();
  });

  it('treats rapid remove and re-add for the same path as an add when the file is present', async () => {
    vi.useFakeTimers();
    const adapter = new FakeWatcherAdapter();
    const rescanPaths = vi.fn();
    const markMissingPaths = vi.fn();
    const service = new LibraryWatcherService({
      enabled: true,
      autoRescanEnabled: true,
      readFolders: () => [createFolder()],
      adapter,
      debounceMs: 5,
      stabilityPollMs: 5,
      rescanDebounceMs: 10,
      statFile: () => ({ sizeBytes: 64, mtimeMs: 1000 }),
      rescanCoordinator: { rescanPaths, markMissingPaths },
    });
    service.start();

    adapter.emit({ folderId: 'folder-1', eventType: 'unlink', path: 'D:\\Music\\bounce.flac' });
    adapter.emit({ folderId: 'folder-1', eventType: 'add', path: 'D:\\Music\\bounce.flac' });
    await flushStableAutoRescanTimers();

    expect(markMissingPaths).not.toHaveBeenCalled();
    expect(rescanPaths).toHaveBeenCalledTimes(1);
    expect(rescanPaths).toHaveBeenCalledWith('folder-1', ['D:\\Music\\bounce.flac']);
    expect(service.getDiagnostics().recentEvents.map((event) => event.eventType)).toEqual(['add']);

    service.stop();
    vi.useRealTimers();
  });

  it('records unlink events without queuing database mutation work', async () => {
    vi.useFakeTimers();
    const adapter = new FakeWatcherAdapter();
    const rescanPaths = vi.fn();
    const service = new LibraryWatcherService({
      enabled: true,
      autoRescanEnabled: true,
      readFolders: () => [createFolder()],
      adapter,
      debounceMs: 5,
      stabilityPollMs: 5,
      rescanDebounceMs: 10,
      statFile: () => null,
      rescanCoordinator: { rescanPaths },
    });
    service.start();

    adapter.emit({ folderId: 'folder-1', eventType: 'unlink', path: 'D:\\Music\\deleted.flac' });
    await vi.advanceTimersByTimeAsync(5);
    expect(service.getDiagnostics().pendingPathCount).toBe(0);
    await vi.advanceTimersByTimeAsync(10);

    expect(rescanPaths).not.toHaveBeenCalled();
    expect(service.getDiagnostics().pendingPathCount).toBe(0);
    expect(service.getDiagnostics().skippedDeleteEventCount).toBe(1);

    service.stop();
    vi.useRealTimers();
  });

  it('debounces and deduplicates many changes into one rescan', async () => {
    vi.useFakeTimers();
    const adapter = new FakeWatcherAdapter();
    const rescanPaths = vi.fn();
    const service = new LibraryWatcherService({
      enabled: true,
      autoRescanEnabled: true,
      readFolders: () => [createFolder()],
      adapter,
      debounceMs: 5,
      stabilityPollMs: 5,
      rescanDebounceMs: 10,
      statFile: () => ({ sizeBytes: 64, mtimeMs: 1000 }),
      rescanCoordinator: { rescanPaths },
    });
    service.start();

    adapter.emit({ folderId: 'folder-1', eventType: 'change', path: 'D:\\Music\\same.flac' });
    adapter.emit({ folderId: 'folder-1', eventType: 'change', path: 'D:\\Music\\same.flac' });
    adapter.emit({ folderId: 'folder-1', eventType: 'change', path: 'D:\\Music\\other.flac' });
    await flushStableAutoRescanTimers();

    expect(rescanPaths).toHaveBeenCalledTimes(1);
    expect(rescanPaths).toHaveBeenCalledWith('folder-1', ['D:\\Music\\same.flac', 'D:\\Music\\other.flac']);
    expect(service.getDiagnostics().recentEvents).toHaveLength(2);

    service.stop();
    vi.useRealTimers();
  });

  it('does not rescan ignored file types', async () => {
    vi.useFakeTimers();
    const adapter = new FakeWatcherAdapter();
    const rescanPaths = vi.fn();
    const service = new LibraryWatcherService({
      enabled: true,
      autoRescanEnabled: true,
      readFolders: () => [createFolder()],
      adapter,
      debounceMs: 5,
      stabilityPollMs: 5,
      rescanDebounceMs: 10,
      statFile: () => ({ sizeBytes: 64, mtimeMs: 1000 }),
      rescanCoordinator: { rescanPaths },
    });
    service.start();

    adapter.emit({ folderId: 'folder-1', eventType: 'change', path: 'D:\\Music\\cover.jpg' });
    adapter.emit({ folderId: 'folder-1', eventType: 'change', path: 'D:\\Music\\song.mp3.tmp' });
    adapter.emit({ folderId: 'folder-1', eventType: 'change', path: 'D:\\Music\\.hidden.flac' });
    await flushStableAutoRescanTimers();

    expect(rescanPaths).not.toHaveBeenCalled();
    expect(service.getDiagnostics().totalEventCount).toBe(0);

    service.stop();
    vi.useRealTimers();
  });

  it('does not rescan files that never become stable', async () => {
    vi.useFakeTimers();
    const adapter = new FakeWatcherAdapter();
    const rescanPaths = vi.fn();
    let sizeBytes = 10;
    const service = new LibraryWatcherService({
      enabled: true,
      autoRescanEnabled: true,
      readFolders: () => [createFolder()],
      adapter,
      debounceMs: 5,
      stabilityPollMs: 5,
      maxStabilityChecks: 1,
      rescanDebounceMs: 10,
      statFile: () => {
        sizeBytes += 1;
        return { sizeBytes, mtimeMs: 1000 };
      },
      rescanCoordinator: { rescanPaths },
    });
    service.start();

    adapter.emit({ folderId: 'folder-1', eventType: 'change', path: 'D:\\Music\\writing.flac' });
    await flushStableAutoRescanTimers();

    expect(rescanPaths).not.toHaveBeenCalled();
    expect(service.getDiagnostics().recentEvents[0].sizeBytes).toBeUndefined();

    service.stop();
    vi.useRealTimers();
  });

  it('drops paths beyond the pending limit without scanning all of them', async () => {
    vi.useFakeTimers();
    const adapter = new FakeWatcherAdapter();
    const rescanPaths = vi.fn();
    const service = new LibraryWatcherService({
      enabled: true,
      autoRescanEnabled: true,
      readFolders: () => [createFolder()],
      adapter,
      debounceMs: 1,
      stabilityPollMs: 1,
      rescanDebounceMs: 50,
      maxPendingPathCount: 2,
      statFile: () => ({ sizeBytes: 64, mtimeMs: 1000 }),
      rescanCoordinator: { rescanPaths },
    });
    service.start();

    adapter.emit({ folderId: 'folder-1', eventType: 'add', path: 'D:\\Music\\one.flac' });
    adapter.emit({ folderId: 'folder-1', eventType: 'add', path: 'D:\\Music\\two.flac' });
    adapter.emit({ folderId: 'folder-1', eventType: 'add', path: 'D:\\Music\\three.flac' });
    await vi.advanceTimersByTimeAsync(2);
    await vi.advanceTimersByTimeAsync(1);

    expect(service.getDiagnostics().pendingPathCount).toBe(2);
    expect(service.getDiagnostics().droppedPathCount).toBe(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(rescanPaths).toHaveBeenCalledWith('folder-1', ['D:\\Music\\one.flac', 'D:\\Music\\two.flac']);

    service.stop();
    vi.useRealTimers();
  });

  it('delays watcher rescans while scan jobs are running and merges more changes', async () => {
    vi.useFakeTimers();
    const adapter = new FakeWatcherAdapter();
    const rescanPaths = vi.fn();
    let running = true;
    const service = new LibraryWatcherService({
      enabled: true,
      autoRescanEnabled: true,
      readFolders: () => [createFolder()],
      adapter,
      debounceMs: 5,
      stabilityPollMs: 5,
      rescanDebounceMs: 10,
      statFile: () => ({ sizeBytes: 64, mtimeMs: 1000 }),
      rescanCoordinator: {
        rescanPaths,
        hasRunningJobs: () => running,
      },
    });
    service.start();

    adapter.emit({ folderId: 'folder-1', eventType: 'change', path: 'D:\\Music\\first.flac' });
    await flushStableAutoRescanTimers();
    expect(rescanPaths).not.toHaveBeenCalled();
    expect(service.getDiagnostics().pendingPathCount).toBe(1);

    adapter.emit({ folderId: 'folder-1', eventType: 'change', path: 'D:\\Music\\second.flac' });
    await flushWatcherTimers(5, 5);
    running = false;
    await vi.advanceTimersByTimeAsync(10);

    expect(rescanPaths).toHaveBeenCalledTimes(1);
    expect(rescanPaths).toHaveBeenCalledWith('folder-1', ['D:\\Music\\first.flac', 'D:\\Music\\second.flac']);

    service.stop();
    vi.useRealTimers();
  });

  it('delays watcher rescans while audio playback is active', async () => {
    vi.useFakeTimers();
    const adapter = new FakeWatcherAdapter();
    const rescanPaths = vi.fn();
    const previewRescanPaths = vi.fn();
    let playbackActive = true;
    const service = new LibraryWatcherService({
      enabled: true,
      autoRescanEnabled: true,
      readFolders: () => [createFolder()],
      adapter,
      debounceMs: 5,
      stabilityPollMs: 5,
      rescanDebounceMs: 10,
      statFile: () => ({ sizeBytes: 64, mtimeMs: 1000 }),
      rescanCoordinator: {
        rescanPaths,
        previewRescanPaths,
        shouldDelayRescan: () => playbackActive,
      },
    });
    service.start();

    adapter.emit({ folderId: 'folder-1', eventType: 'add', path: 'D:\\Music\\new.flac' });
    await flushStableAutoRescanTimers();

    expect(rescanPaths).not.toHaveBeenCalled();
    expect(previewRescanPaths).toHaveBeenCalledTimes(1);
    expect(previewRescanPaths).toHaveBeenCalledWith('folder-1', ['D:\\Music\\new.flac']);
    expect(service.getDiagnostics().pendingPathCount).toBe(1);

    await vi.advanceTimersByTimeAsync(10);
    expect(previewRescanPaths).toHaveBeenCalledTimes(1);

    playbackActive = false;
    await vi.advanceTimersByTimeAsync(10);

    expect(rescanPaths).toHaveBeenCalledTimes(1);
    expect(rescanPaths).toHaveBeenCalledWith('folder-1', ['D:\\Music\\new.flac']);
    expect(service.getDiagnostics().pendingPathCount).toBe(0);

    service.stop();
    vi.useRealTimers();
  });

  it('previews large batches and rescans them in small chunks', async () => {
    vi.useFakeTimers();
    const adapter = new FakeWatcherAdapter();
    const rescanPaths = vi.fn();
    const previewRescanPaths = vi.fn();
    const service = new LibraryWatcherService({
      enabled: true,
      autoRescanEnabled: true,
      readFolders: () => [createFolder()],
      adapter,
      debounceMs: 5,
      stabilityPollMs: 5,
      rescanDebounceMs: 10,
      maxRescanBatchSize: 4,
      statFile: () => ({ sizeBytes: 64, mtimeMs: 1000 }),
      rescanCoordinator: {
        rescanPaths,
        previewRescanPaths,
      },
    });
    service.start();

    const paths = Array.from({ length: 10 }, (_, index) => `D:\\Music\\batch-${index + 1}.flac`);
    for (const path of paths) {
      adapter.emit({ folderId: 'folder-1', eventType: 'add', path });
    }
    await flushStableAutoRescanTimers();

    expect(previewRescanPaths).toHaveBeenCalledTimes(1);
    expect(previewRescanPaths).toHaveBeenCalledWith('folder-1', paths);
    expect(rescanPaths).toHaveBeenCalledTimes(1);
    expect(rescanPaths).toHaveBeenCalledWith('folder-1', paths.slice(0, 4));
    expect(service.getDiagnostics().pendingPathCount).toBe(6);

    await vi.advanceTimersByTimeAsync(10);
    expect(rescanPaths).toHaveBeenCalledTimes(2);
    expect(rescanPaths).toHaveBeenLastCalledWith('folder-1', paths.slice(4, 8));
    expect(service.getDiagnostics().pendingPathCount).toBe(2);

    await vi.advanceTimersByTimeAsync(10);
    expect(rescanPaths).toHaveBeenCalledTimes(3);
    expect(rescanPaths).toHaveBeenLastCalledWith('folder-1', paths.slice(8));
    expect(service.getDiagnostics().pendingPathCount).toBe(0);

    service.stop();
    vi.useRealTimers();
  });
});
