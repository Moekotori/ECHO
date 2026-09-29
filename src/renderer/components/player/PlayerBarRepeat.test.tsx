// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlaybackQueueProvider } from '../../stores/PlaybackQueueProvider';
import { PlayerBar } from './PlayerBar';

const installEcho = (): void => {
  window.echo = {
    playback: {
      getStatus: vi.fn().mockResolvedValue({
        state: 'idle',
        currentTrackId: null,
        positionMs: 0,
        durationMs: 0,
        filePath: null,
      }),
      playLocalFile: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      stop: vi.fn(),
      seek: vi.fn(),
      openLocalAudioFile: vi.fn(),
    },
    audio: {
      getStatus: vi.fn().mockResolvedValue(null),
      listDevices: vi.fn().mockResolvedValue([]),
      setOutput: vi.fn(),
    },
    app: {
      getVersion: vi.fn(),
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
    },
  } as unknown as Window['echo'];
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PlayerBar repeat mode', () => {
  it('cycles the footer repeat control between order playback and repeat one', async () => {
    installEcho();
    render(
      <PlaybackQueueProvider>
        <PlayerBar />
      </PlaybackQueueProvider>,
    );

    const repeatButton = screen.getByRole('button', { name: 'Repeat' });
    expect(repeatButton.getAttribute('title')).toBe('Play in order');

    fireEvent.click(repeatButton);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Repeat' }).getAttribute('title')).toBe('Repeat one'));

    fireEvent.click(screen.getByRole('button', { name: 'Repeat' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Repeat' }).getAttribute('title')).toBe('Play in order'));
  });
});
