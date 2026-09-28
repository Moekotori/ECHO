// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerSpeedControl } from './PlayerSpeedControl';
import { PlayerVolumeControl } from './PlayerVolumeControl';

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
});
