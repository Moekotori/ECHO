// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerSpeedControl } from './PlayerSpeedControl';
import { PlayerVolumeControl } from './PlayerVolumeControl';
import type { AudioStatus } from '../../../shared/types/audio';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('UltraLight output restore', () => {
  it('mounts volume and speed controls without overwriting the running host', async () => {
    const getSettings = vi.fn(async () => ({ playerVolume: 0.8, playbackSpeed: 1 }));
    const setOutput = vi.fn();
    Object.defineProperty(window, 'echo', { configurable: true, value: { app: { getSettings }, audio: { setOutput } } });
    window.history.replaceState(null, '', '/?echoUltraLightRestore=1');
    const props = { status: null, onStatusChange: vi.fn(), onError: vi.fn(), isOpen: false, onOpenChange: vi.fn() };
    render(<><PlayerSpeedControl {...props} /><PlayerVolumeControl {...props} /></>);
    await Promise.resolve();
    expect(getSettings).not.toHaveBeenCalled();
    expect(setOutput).not.toHaveBeenCalled();
  });

  it.each(['playing', 'loading', 'paused'])('observes a resident %s host after an ordinary control remount', async (state) => {
    const liveStatus = { host: 'ready', state, volume: 0.21, playbackRate: 1.25, playbackSpeedMode: 'speed' } as AudioStatus;
    const getSettings = vi.fn(async () => ({ playerVolume: 0.8, playbackSpeed: 0.5 }));
    const setOutput = vi.fn();
    const onStatusChange = vi.fn();
    Object.defineProperty(window, 'echo', { configurable: true, value: { app: { getSettings }, audio: { setOutput, getStatus: vi.fn(async () => liveStatus) } } });
    const props = { status: null, onStatusChange, onError: vi.fn(), isOpen: false, onOpenChange: vi.fn() };
    render(<><PlayerSpeedControl {...props} /><PlayerVolumeControl {...props} /></>);
    await act(async () => undefined);
    expect(setOutput).not.toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenCalledTimes(2);
    expect(onStatusChange).toHaveBeenCalledWith(liveStatus);
  });

  it('does not overwrite playback that began while persisted controls were still loading', async () => {
    let finishSettings!: (value: { playerVolume: number; playbackSpeed: number }) => void;
    const pendingSettings = new Promise<{ playerVolume: number; playbackSpeed: number }>((resolve) => { finishSettings = resolve; });
    const liveStatus = { host: 'ready', state: 'playing', volume: 0.3, playbackRate: 1.5 } as AudioStatus;
    const setOutput = vi.fn();
    const onStatusChange = vi.fn();
    Object.defineProperty(window, 'echo', { configurable: true, value: { app: { getSettings: () => pendingSettings }, audio: { setOutput, getStatus: vi.fn(async () => liveStatus) } } });
    const props = { status: null, onStatusChange, onError: vi.fn(), isOpen: false, onOpenChange: vi.fn() };
    render(<><PlayerSpeedControl {...props} /><PlayerVolumeControl {...props} /></>);
    await act(async () => { finishSettings({ playerVolume: 1, playbackSpeed: 0.5 }); });
    expect(setOutput).not.toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenCalledWith(liveStatus);
  });
});
