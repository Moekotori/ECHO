// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AudioStatus } from '../../../shared/types/audio';
import { PlayerSpeedControl } from './PlayerSpeedControl';
import { PlayerVolumeControl } from './PlayerVolumeControl';

const createAudioStatus = (overrides: Partial<AudioStatus> = {}): AudioStatus => ({
  host: 'ready',
  state: 'playing',
  volume: 1,
  playbackRate: 1,
  playbackSpeedMode: 'nightcore',
  currentTrackId: 'track-1',
  currentFilePath: 'D:\\Music\\song.flac',
  durationSeconds: 180,
  positionSeconds: 4,
  ...overrides,
} as AudioStatus);

const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as unknown as { echo?: unknown }).echo;
});

describe('player slider controls', () => {
  it('keeps a dragged playback speed visible when the initial settings load finishes late', async () => {
    const settingsRequest = deferred<{ playbackSpeed: number; playbackSpeedMode: AudioStatus['playbackSpeedMode'] }>();
    const staleStatus = createAudioStatus({ playbackRate: 1, playbackSpeedMode: 'nightcore' });
    const setOutput = vi.fn().mockResolvedValue(staleStatus);

    window.echo = {
      app: {
        getSettings: vi.fn().mockReturnValue(settingsRequest.promise),
        setSettings: vi.fn().mockResolvedValue({ playbackSpeed: 1.5 }),
      },
      audio: {
        setOutput,
      },
    } as unknown as Window['echo'];

    const Harness = (): JSX.Element => {
      const [status, setStatus] = useState<AudioStatus | null>(createAudioStatus());
      return (
        <PlayerSpeedControl
          status={status}
          isOpen
          onError={vi.fn()}
          onOpenChange={vi.fn()}
          onStatusChange={setStatus}
        />
      );
    };

    render(<Harness />);

    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '1.5' } });
    fireEvent.keyUp(slider, { key: 'Enter' });

    await waitFor(() => expect(setOutput).toHaveBeenCalledWith({ playbackRate: 1.5, playbackSpeedMode: 'nightcore' }));

    await act(async () => {
      settingsRequest.resolve({ playbackSpeed: 1, playbackSpeedMode: 'nightcore' });
      await settingsRequest.promise;
    });

    expect(slider.value).toBe('1.5');
  });

  it('keeps a committed volume visible when the bridge returns a stale status', async () => {
    const settingsRequest = deferred<{ playerVolume: number; fixedVolumeEnabled: boolean }>();
    const staleStatus = createAudioStatus({ volume: 1 });
    const setOutput = vi.fn().mockResolvedValue(staleStatus);

    window.echo = {
      app: {
        getSettings: vi.fn().mockReturnValue(settingsRequest.promise),
        setSettings: vi.fn().mockResolvedValue({ playerVolume: 0.42 }),
      },
      audio: {
        setOutput,
      },
    } as unknown as Window['echo'];

    const Harness = (): JSX.Element => {
      const [status, setStatus] = useState<AudioStatus | null>(createAudioStatus());
      return (
        <PlayerVolumeControl
          status={status}
          isOpen
          onError={vi.fn()}
          onOpenChange={vi.fn()}
          onStatusChange={setStatus}
        />
      );
    };

    render(<Harness />);

    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0.42' } });
    fireEvent.keyUp(slider, { key: 'Enter' });

    await waitFor(() => expect(setOutput).toHaveBeenCalledWith({ volume: 0.42 }));
    await waitFor(() => expect(slider.value).toBe('0.42'));

    await act(async () => {
      settingsRequest.resolve({ playerVolume: 1, fixedVolumeEnabled: false });
      await settingsRequest.promise;
    });

    expect(slider.value).toBe('0.42');
  });
});
