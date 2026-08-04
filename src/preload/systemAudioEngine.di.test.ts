// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSystemAudioEngine } from './systemAudioEngine';
import { createMockIpcChannels, createMockIpcRenderer } from '../test-utils/electronMocks';
import { IpcChannels as ActualIpcChannels } from '../shared/constants/ipcChannels';
import type { AudioStatus } from '../shared/types/audio';

const createTestLocalStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => values.set(key, String(value))),
  };
};

describe('createSystemAudioEngine DI', () => {
  let ipcRenderer: ReturnType<typeof createMockIpcRenderer>;
  let IpcChannels: typeof ActualIpcChannels;
  let localStorage: Storage;

  beforeEach(() => {
    ipcRenderer = createMockIpcRenderer();
    IpcChannels = { ...ActualIpcChannels, ...createMockIpcChannels() };
    localStorage = createTestLocalStorage();
    vi.stubGlobal('window', {
      localStorage,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
      location: { search: '' },
    });
  });

  it('returns an object with all public API members', () => {
    const engine = createSystemAudioEngine(ipcRenderer, IpcChannels);

    // Handler registration (4)
    expect(engine.onAudioStatus).toBeTypeOf('function');
    expect(engine.onTrackChange).toBeTypeOf('function');
    expect(engine.onLocalAudioFilesOpened).toBeTypeOf('function');
    expect(engine.onAutomixAdvance).toBeTypeOf('function');

    // Status queries (2)
    expect(engine.getSystemAudioStatus).toBeTypeOf('function');
    expect(engine.getSystemPlaybackStatus).toBeTypeOf('function');

    // State access properties
    expect(engine.systemAudioModeActive).toBeTypeOf('boolean');
    expect(engine.lastNativeAudioStatus).toBeNull();

    // Playback lifecycle (6)
    expect(engine.handoffNativePlaybackToSystemAudio).toBeTypeOf('function');
    expect(engine.stopSystemPlayback).toBeTypeOf('function');
    expect(engine.refreshSystemAudioModeActive).toBeTypeOf('function');
    expect(engine.play).toBeTypeOf('function');
    expect(engine.pause).toBeTypeOf('function');
    expect(engine.stop).toBeTypeOf('function');
    expect(engine.seek).toBeTypeOf('function');

    // Direct system-audio playback entry (2)
    expect(engine.playLocalFileWithSystemAudio).toBeTypeOf('function');
    expect(engine.playMediaItemWithSystemAudio).toBeTypeOf('function');

    // Decision helpers (5)
    expect(engine.shouldUseSystemAudioForPlayback).toBeTypeOf('function');
    expect(engine.requiresNativeChainedPlayback).toBeTypeOf('function');
    expect(engine.requiresNativeSystemLocalPlayback).toBeTypeOf('function');
    expect(engine.requiresNativeSystemMediaPlayback).toBeTypeOf('function');
    expect(engine.isExplicitNativeOutputRequest).toBeTypeOf('function');

    // Output / DSP (2)
    expect(engine.applySystemOutputSettings).toBeTypeOf('function');
    expect(engine.applySystemChannelBalanceState).toBeTypeOf('function');

    // Persistence
    expect(engine.readPersistedSystemAudioMode).toBeTypeOf('function');
  });

  it('onAudioStatus subscribes: handler is called when audio status changes', () => {
    const engine = createSystemAudioEngine(ipcRenderer, IpcChannels);
    const handler = vi.fn();

    engine.onAudioStatus(handler);

    // stopSystemPlayback with emitStatus=true triggers emitSystemAudioStatus
    engine.stopSystemPlayback('stopped', true);

    expect(handler).toHaveBeenCalledTimes(1);
    const status: AudioStatus = handler.mock.calls[0][0];
    expect(status).toMatchObject({
      host: 'ready',
      state: 'stopped',
      outputMode: 'system',
    });
  });

  it('onAudioStatus returns an unsubscribe function that removes the handler', () => {
    const engine = createSystemAudioEngine(ipcRenderer, IpcChannels);
    const handler = vi.fn();

    const unsubscribe = engine.onAudioStatus(handler);
    expect(unsubscribe).toBeTypeOf('function');

    // First emission: handler is called
    engine.stopSystemPlayback('stopped', true);
    expect(handler).toHaveBeenCalledTimes(1);

    // Unsubscribe
    unsubscribe();

    // Second emission: handler should NOT be called
    engine.stopSystemPlayback('stopped', true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('systemAudioModeActive getter returns false by default (no localStorage)', () => {
    const engine = createSystemAudioEngine(ipcRenderer, IpcChannels);
    expect(engine.systemAudioModeActive).toBe(false);
  });

  it('systemAudioModeActive getter returns true when localStorage has persisted system mode', () => {
    window.localStorage.setItem(
      'echo-next.audio-output-memory',
      JSON.stringify({ enabled: true, outputMode: 'system' }),
    );

    const engine = createSystemAudioEngine(ipcRenderer, IpcChannels);
    expect(engine.systemAudioModeActive).toBe(true);
  });

  it('readPersistedSystemAudioMode() returns false when no localStorage entry', () => {
    const engine = createSystemAudioEngine(ipcRenderer, IpcChannels);
    expect(engine.readPersistedSystemAudioMode()).toBe(false);
  });

  it('readPersistedSystemAudioMode() returns true when localStorage has { enabled: true, outputMode: "system" }', () => {
    window.localStorage.setItem(
      'echo-next.audio-output-memory',
      JSON.stringify({ enabled: true, outputMode: 'system' }),
    );

    const engine = createSystemAudioEngine(ipcRenderer, IpcChannels);
    expect(engine.readPersistedSystemAudioMode()).toBe(true);
  });

  it('readPersistedSystemAudioMode() returns false when outputMode is not "system"', () => {
    window.localStorage.setItem(
      'echo-next.audio-output-memory',
      JSON.stringify({ enabled: true, outputMode: 'exclusive' }),
    );

    const engine = createSystemAudioEngine(ipcRenderer, IpcChannels);
    expect(engine.readPersistedSystemAudioMode()).toBe(false);
  });

  it('applySystemOutputSettings({ volume: 0.5 }) updates internal state visible via getSystemAudioStatus', () => {
    const engine = createSystemAudioEngine(ipcRenderer, IpcChannels);

    engine.applySystemOutputSettings({ volume: 0.5 });

    const status = engine.getSystemAudioStatus();
    expect(status.volume).toBe(0.5);
  });

  it('applySystemOutputSettings clamps volume to [0, 1] range', () => {
    const engine = createSystemAudioEngine(ipcRenderer, IpcChannels);

    engine.applySystemOutputSettings({ volume: 2.5 });
    expect(engine.getSystemAudioStatus().volume).toBe(1);

    engine.applySystemOutputSettings({ volume: -1 });
    expect(engine.getSystemAudioStatus().volume).toBe(0);
  });
});
