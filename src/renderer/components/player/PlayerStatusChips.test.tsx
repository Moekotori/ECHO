// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PlayerStatusChips } from './PlayerStatusChips';
import type { LibraryTrack } from '../../../shared/types/library';

const track = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'track-1',
  path: 'D:\\Music\\song.flac',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Artist',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180,
  codec: 'flac',
  sampleRate: 48000,
  bitDepth: 24,
  bitrate: 1884000,
  bpm: null,
  bpmConfidence: null,
  beatOffsetMs: null,
  analysisStatus: 'none',
  coverId: null,
  coverThumb: null,
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  networkMetadataStatus: 'none',
  fieldSources: {},
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe('PlayerStatusChips', () => {
  it('does not add Hi-Res to high-bitrate 24bit 48kHz tracks', () => {
    render(<PlayerStatusChips status={null} state="playing" track={track()} />);

    expect(screen.queryByText('Hi-Res')).toBeNull();
    expect(screen.getByText('24bit / 48kHz')).toBeTruthy();
    expect(screen.getByText('1884kbps')).toBeTruthy();
  });

  it('adds Hi-Res only when the audio spec is clearly high resolution', () => {
    render(<PlayerStatusChips status={null} state="playing" track={track({ sampleRate: 96000, bitDepth: 24 })} />);

    expect(screen.getByText('Hi-Res')).toBeTruthy();
  });

  it('surfaces remote playback loading even when codec chips are available', () => {
    render(<PlayerStatusChips status={null} state="loading" track={track({ mediaType: 'remote', sourceDisplayName: '百度网盘' })} />);

    expect(screen.getByText('加载中')).toBeTruthy();
    expect(screen.getByText('FLAC')).toBeTruthy();
  });

  it('shows detected BPM in the player tags only when confidence is reliable', () => {
    const { rerender } = render(
      <PlayerStatusChips
        status={null}
        state="playing"
        track={track({ bpm: 128, bpmConfidence: 0.9, analysisStatus: 'complete' })}
      />,
    );

    expect(screen.getByText('128 BPM')).toBeTruthy();

    rerender(
      <PlayerStatusChips
        status={null}
        state="playing"
        track={track({ bpm: 128, bpmConfidence: 0.2, analysisStatus: 'low_confidence' })}
      />,
    );

    expect(screen.queryByText('128 BPM')).toBeNull();

    rerender(<PlayerStatusChips status={null} state="playing" track={track({ bpm: 128, analysisStatus: 'analyzing' })} />);

    expect(screen.queryByText('128 BPM')).toBeNull();
  });

  it('labels AirPlay receiver temporary tracks', () => {
    render(
      <PlayerStatusChips
        status={null}
        state="playing"
        track={track({
          id: 'airplay-receiver:session-1',
          mediaType: 'remote',
          isTemporary: true,
          codec: null,
          fieldSources: { title: 'airplay' },
        })}
      />,
    );

    expect(screen.getByText('AIRPLAY')).toBeTruthy();
  });

  it('does not duplicate AirPlay source labels when codec still contains AirPlay', () => {
    render(
      <PlayerStatusChips
        status={{ codec: 'AirPlay', sampleRateMismatch: false } as never}
        state="playing"
        track={track({
          id: 'airplay-receiver:session-1',
          mediaType: 'remote',
          isTemporary: true,
          codec: 'AirPlay',
          fieldSources: { title: 'airplay' },
        })}
      />,
    );

    expect(screen.getAllByText('AIRPLAY')).toHaveLength(1);
  });

  it('does not show stale AirPlay codec labels on local tracks', () => {
    render(
      <PlayerStatusChips
        status={{ codec: 'AirPlay', sampleRateMismatch: false } as never}
        state="playing"
        track={track({ codec: null })}
      />,
    );

    expect(screen.queryByText('AIRPLAY')).toBeNull();
  });

  it('surfaces unusual Windows audio default format warnings', () => {
    render(
      <PlayerStatusChips
        status={{ sampleRateMismatch: false, warnings: ['windows_audio_default_format_unusual:96000'] } as never}
        state="playing"
        track={track()}
      />,
    );

    expect(screen.getByText('Windows Rate High')).toBeTruthy();
  });

  it('shows a FIR chip when Room Correction is active', () => {
    render(
      <PlayerStatusChips
        status={{ sampleRateMismatch: false, roomCorrectionEnabled: true } as never}
        state="playing"
        track={track()}
      />,
    );

    expect(screen.getByText('FIR')).toBeTruthy();
  });

  it('shows an Automix chip only when the engine has an active transition plan', () => {
    const { rerender } = render(
      <PlayerStatusChips
        status={{
          sampleRateMismatch: false,
          automix: {
            enabled: true,
            active: false,
            mode: 'off',
            transitionSeconds: null,
            transitionStartedAtSeconds: null,
            nextTrackId: null,
          },
        } as never}
        state="playing"
        track={track()}
      />,
    );

    expect(screen.queryByText(/Automix/u)).toBeNull();

    rerender(
      <PlayerStatusChips
        status={{
          sampleRateMismatch: false,
          automix: {
            enabled: false,
            active: true,
            mode: 'armed',
            transitionSeconds: 0,
            transitionStartedAtSeconds: null,
            nextTrackId: 'track-2',
            transitionMode: 'gaplessFallback',
            engine: 'nativeGapless',
            gapless: true,
            overlapSeconds: 0,
          },
        } as never}
        state="playing"
        track={track()}
      />,
    );

    expect(screen.queryByText(/Automix/u)).toBeNull();

    rerender(
      <PlayerStatusChips
        status={{
          sampleRateMismatch: false,
          automix: {
            enabled: true,
            active: true,
            mode: 'armed',
            transitionSeconds: 16,
            transitionStartedAtSeconds: 72,
            nextTrackId: 'track-2',
            transitionMode: 'beatAligned',
            beatAligned: true,
            overlapSeconds: 15.8,
          },
        } as never}
        state="playing"
        track={track()}
      />,
    );

    expect(screen.getByText('Automix beat 16s')).toBeTruthy();
  });
});
