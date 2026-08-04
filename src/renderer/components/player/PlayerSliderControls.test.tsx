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

  it('keeps a committed playback speed visible when a stale status echoes the previous speed', async () => {
    const staleStatus = createAudioStatus({ playbackRate: 1.15, playbackSpeedMode: 'nightcore' });
    const setOutput = vi.fn().mockResolvedValue(staleStatus);
    let pushStatus: (status: AudioStatus) => void = () => undefined;

    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ playbackSpeed: 1.15, playbackSpeedMode: 'nightcore' }),
        setSettings: vi.fn().mockResolvedValue({ playbackSpeed: 1.3 }),
      },
      audio: {
        setOutput,
      },
    } as unknown as Window['echo'];

    const Harness = (): JSX.Element => {
      const [status, setStatus] = useState<AudioStatus | null>(staleStatus);
      pushStatus = setStatus;
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
    fireEvent.change(slider, { target: { value: '1.3' } });
    fireEvent.keyUp(slider, { key: 'Enter' });

    await waitFor(() => expect(setOutput).toHaveBeenCalledWith({ playbackRate: 1.3, playbackSpeedMode: 'nightcore' }));
    await waitFor(() => expect(slider.value).toBe('1.3'));

    act(() => {
      pushStatus(createAudioStatus({ playbackRate: 1.15, playbackSpeedMode: 'nightcore' }));
    });

    expect(slider.value).toBe('1.3');

    act(() => {
      pushStatus(createAudioStatus({ playbackRate: 1.4, playbackSpeedMode: 'nightcore' }));
    });

    expect(slider.value).toBe('1.4');
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

  it('summarizes volume and output route in the footer volume button tooltip', () => {
    render(
      <PlayerVolumeControl
        status={createAudioStatus({
          outputDeviceName: 'ECHO DAC',
          outputMode: 'shared',
          volume: 0.7,
        })}
        isOpen={false}
        onError={vi.fn()}
        onOpenChange={vi.fn()}
        onStatusChange={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: 'Volume 70% · Shared · ECHO DAC' });

    expect(button.getAttribute('title')).toBe('Volume 70% · Shared · ECHO DAC');
  });
});
