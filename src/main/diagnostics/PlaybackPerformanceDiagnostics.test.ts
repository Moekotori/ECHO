import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginMainBackgroundTask,
  getPlaybackPerformanceSnapshot,
  recordIpcMainHandlerDuration,
  runPlaybackPerformanceStepSync,
} from './PlaybackPerformanceDiagnostics';

describe('PlaybackPerformanceDiagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns when a playback phase is slow enough to matter in the console', () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    runPlaybackPerformanceStepSync('PlaybackPlayLocalFile', 'playback.playLocalFile IPC', {
      trackId: 'track-1',
      outputMode: 'system',
    }, () => {
      now = 1800;
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[playback-perf] PlaybackPlayLocalFile:playback.playLocalFile IPC 800ms'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('probableCause=slow_playback_phase'));
    expect(info).not.toHaveBeenCalled();
  });

  it('keeps a recent completed main background task in the performance snapshot', () => {
    let now = 2000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const clear = beginMainBackgroundTask('startup:ipc:downloads');
    now = 6800;
    clear();
    now = 7000;

    expect(getPlaybackPerformanceSnapshot()).toMatchObject({
      pendingBackgroundTask: null,
      lastBackgroundTask: 'startup:ipc:downloads',
      lastBackgroundTaskDurationMs: 4800,
      lastBackgroundTaskAgeMs: 200,
    });
  });

  it('keeps a recent slow IPC handler in the performance snapshot', () => {
    let now = 10_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    recordIpcMainHandlerDuration('library:scan-folder', 420);
    now = 10_250;

    expect(getPlaybackPerformanceSnapshot()).toMatchObject({
      lastSlowIpcChannel: 'library:scan-folder',
      lastSlowIpcDurationMs: 420,
      lastSlowIpcAgeMs: 250,
      lastSlowIpcFailed: false,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[ipc-perf] library:scan-folder 420ms SLOW'));
  });

  it('throttles repeated slow IPC warnings while keeping the latest snapshot', () => {
    let now = 15_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    recordIpcMainHandlerDuration('lyrics:get-for-track', 950);
    now = 15_500;
    recordIpcMainHandlerDuration('lyrics:get-for-track', 1200);
    now = 16_000;

    expect(warn).toHaveBeenCalledTimes(1);
    expect(getPlaybackPerformanceSnapshot()).toMatchObject({
      lastSlowIpcChannel: 'lyrics:get-for-track',
      lastSlowIpcDurationMs: 1200,
      lastSlowIpcAgeMs: 500,
      lastSlowIpcFailed: false,
    });
  });

  it('uses a network-aware threshold for successful MV candidate searches', () => {
    let now = 20_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    recordIpcMainHandlerDuration('mv:search-network-candidates', 372);
    expect(warn).not.toHaveBeenCalled();

    recordIpcMainHandlerDuration('mv:search-network-candidates', 1200);
    now = 20_250;

    expect(getPlaybackPerformanceSnapshot()).toMatchObject({
      lastSlowIpcChannel: 'mv:search-network-candidates',
      lastSlowIpcDurationMs: 1200,
      lastSlowIpcAgeMs: 250,
      lastSlowIpcFailed: false,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[ipc-perf] mv:search-network-candidates 1200ms SLOW'));
  });

  it('keeps the default IPC threshold for failed MV candidate searches', () => {
    vi.spyOn(Date, 'now').mockReturnValue(30_000);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    recordIpcMainHandlerDuration('mv:search-network-candidates', 372, { failed: true });

    expect(getPlaybackPerformanceSnapshot()).toMatchObject({
      lastSlowIpcChannel: 'mv:search-network-candidates',
      lastSlowIpcDurationMs: 372,
      lastSlowIpcFailed: true,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[ipc-perf] mv:search-network-candidates 372ms SLOW failed=true'));
  });
});
