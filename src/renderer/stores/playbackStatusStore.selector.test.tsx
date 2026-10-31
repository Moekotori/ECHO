// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioStatus } from '../../shared/types/audio';
import type { PlaybackStatus } from '../../shared/types/playback';
import {
  setPlaybackStatusSnapshot,
  useSharedAudioPlaybackState,
  useSharedPlaybackActivityState,
  useSharedPlaybackStatusOnly,
} from './playbackStatusStore';

const playbackStatus = (overrides: Partial<PlaybackStatus> = {}): PlaybackStatus => ({
  state: 'playing',
  currentTrackId: 'track-1',
  filePath: 'D:\\Music\\track-1.flac',
  positionMs: 0,
  durationMs: 180_000,
  ...overrides,
});

const audioStatus = (overrides: Partial<AudioStatus> = {}): AudioStatus => ({
  state: 'playing',
  currentTrackId: 'track-1',
  currentFilePath: 'D:\\Music\\track-1.flac',
  positionSeconds: 0,
  ...overrides,
} as AudioStatus);

afterEach(() => {
  cleanup();
  setPlaybackStatusSnapshot({
    audioStatus: null,
    playbackStatus: null,
    playbackVisualIntent: null,
    error: null,
  });
});

describe('playbackStatusStore narrow subscriptions', () => {
  it('does not rerender a PlaybackStatus-only subscriber for audio-only updates', () => {
    let renders = 0;
    const Probe = (): JSX.Element => {
      renders += 1;
      const status = useSharedPlaybackStatusOnly();
      return <output>{status?.positionMs ?? ''}</output>;
    };

    render(<Probe />);
    act(() => setPlaybackStatusSnapshot({ playbackStatus: playbackStatus() }));
    const rendersAfterPlaybackStatus = renders;

    act(() => setPlaybackStatusSnapshot({ audioStatus: audioStatus({ positionSeconds: 12.5 }) }));
    expect(renders).toBe(rendersAfterPlaybackStatus);

    act(() => setPlaybackStatusSnapshot({ playbackStatus: playbackStatus({ positionMs: 12_500 }) }));
    expect(renders).toBe(rendersAfterPlaybackStatus + 1);
  });

  it('keeps playback-state subscribers stable for position-only updates', () => {
    let activityRenders = 0;
    let audioRenders = 0;
    const Probe = (): JSX.Element => {
      activityRenders += 1;
      const activityState = useSharedPlaybackActivityState();
      audioRenders += 1;
      const audioState = useSharedAudioPlaybackState();
      return <output>{`${activityState}:${audioState ?? 'none'}`}</output>;
    };

    render(<Probe />);
    act(() => setPlaybackStatusSnapshot({ audioStatus: audioStatus({ positionSeconds: 1 }) }));
    const activityRendersAfterState = activityRenders;
    const audioRendersAfterState = audioRenders;

    act(() => setPlaybackStatusSnapshot({ audioStatus: audioStatus({ positionSeconds: 2 }) }));
    expect(activityRenders).toBe(activityRendersAfterState);
    expect(audioRenders).toBe(audioRendersAfterState);

    act(() => setPlaybackStatusSnapshot({ audioStatus: audioStatus({ state: 'paused', positionSeconds: 2 }) }));
    expect(activityRenders).toBe(activityRendersAfterState + 1);
    expect(audioRenders).toBe(audioRendersAfterState + 1);
  });
});
