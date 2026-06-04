import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginMainBackgroundTask, getPlaybackPerformanceSnapshot, runPlaybackPerformanceStepSync } from './PlaybackPerformanceDiagnostics';

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
});
