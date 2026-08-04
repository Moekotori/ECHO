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

const getChip = (label: string): HTMLElement => {
  const chip = screen.getByText(label).closest('.hifi-tag');
  if (!(chip instanceof HTMLElement)) {
    throw new Error(`Chip not found: ${label}`);
  }

  return chip;
};

describe('PlayerStatusChips', () => {
  it('does not add Hi-Res to high-bitrate 24bit 48kHz tracks', () => {
    render(<PlayerStatusChips status={null} state="playing" track={track()} />);

    expect(screen.queryByText('Hi-Res')).toBeNull();
    expect(screen.getByText('24bit / 48kHz')).toBeTruthy();
    expect(screen.getByText('1884kbps')).toBeTruthy();
  });

  it('can hide secondary bitrate and channel chips for compact player surfaces', () => {
    render(
      <PlayerStatusChips
        showSecondarySpecs={false}
        status={{ channels: 2, playbackRate: 1, sampleRateMismatch: false } as never}
        state="playing"
        track={track()}
      />,
    );

    expect(screen.getByText('FLAC')).toBeTruthy();
    expect(screen.getByText('24bit / 48kHz')).toBeTruthy();
    expect(screen.queryByText('1884kbps')).toBeNull();
    expect(screen.queryByText('Stereo')).toBeNull();
  });

  it('adds Hi-Res only when the audio spec is clearly high resolution', () => {
    render(<PlayerStatusChips status={null} state="playing" track={track({ sampleRate: 96000, bitDepth: 24 })} />);

    expect(screen.getByText('Hi-Res')).toBeTruthy();
  });

  it('adds restrained HQPlayer output chips when HQPlayer upsamples the source', () => {
    render(<PlayerStatusChips hqPlayerActiveRate={22579200} status={null} state="playing" track={track({ sampleRate: 48000 })} />);

    expect(screen.queryByText('Rate Lift')).toBeNull();
    expect(getChip('HQPlayer').className).toContain('tag-hqplayer');
    expect(getChip('22.58MHz').className).toContain('tag-hqplayer');
    expect(screen.getByText('24bit / 48kHz')).toBeTruthy();
  });

  it('does not add HQPlayer output chips when the active rate matches the source', () => {
    render(<PlayerStatusChips hqPlayerActiveRate={48000} status={null} state="playing" track={track({ sampleRate: 48000 })} />);

    expect(screen.queryByText('HQPlayer')).toBeNull();
  });

  it('shows playback path tags for bit-perfect, upsampling, and EQ', () => {
    render(
      <PlayerStatusChips
        status={{
          bitPerfectCandidate: true,
          echoSrcActive: true,
          eqEnabled: true,
          playbackRate: 1,
          resampling: true,
          sampleRateMismatch: false,
        } as never}
        state="playing"
        track={track()}
      />,
    );

    expect(screen.queryByText('Rate Lift')).toBeNull();
    expect(getChip('Bit-Perfect').className).toContain('tag-bit-perfect');
    expect(getChip('EQ').className).toContain('tag-eq');
  });

  it('shows the SRC output sample rate in the compact spec chip while upsampling', () => {
    render(
      <PlayerStatusChips
        showSecondarySpecs={false}
        status={{
          decoderOutputSampleRate: 352800,
          echoSrcActive: true,
          echoSrcTargetSampleRate: 352800,
          playbackRate: 1,
          requestedOutputSampleRate: 352800,
          resampling: true,
          sampleRateMismatch: false,
        } as never}
        state="playing"
        track={track({ sampleRate: 44100, bitDepth: null })}
      />,
    );

    expect(screen.queryByText('Rate Lift')).toBeNull();
    const rateChip = getChip('44.1->352.8kHz');
    expect(rateChip.className).toContain('tag-depth');
    expect(rateChip.className).toContain('tag-rate-lift-output');
    expect(rateChip.getAttribute('title')).toBe('44.1kHz to 352.8kHz');
    expect(screen.queryByText('44.1kHz')).toBeNull();
  });

  it('keeps bit depth SRC lift chips compact while preserving the full rate title', () => {
    render(
      <PlayerStatusChips
        showSecondarySpecs={false}
        status={{
          decoderOutputSampleRate: 352800,
          echoSrcActive: true,
          echoSrcTargetSampleRate: 352800,
          playbackRate: 1,
          requestedOutputSampleRate: 352800,
          resampling: true,
          sampleRateMismatch: false,
        } as never}
        state="playing"
        track={track({ sampleRate: 44100, bitDepth: 16 })}
      />,
    );

    const rateChip = getChip('16bit / 44.1->352.8kHz');
    expect(rateChip.className).toContain('tag-rate-lift-output');
    expect(rateChip.getAttribute('title')).toBe('16bit / 44.1kHz to 352.8kHz');
  });

  it('shows the current output mode as a compact player chip', () => {
    render(
      <PlayerStatusChips
        status={{
          outputMode: 'exclusive',
          playbackRate: 1,
          sampleRateMismatch: false,
        } as never}
        state="playing"
        track={track()}
      />,
    );

    expect(getChip('Exclusive').className).toContain('tag-output-mode');
  });

  it('shows the playback speed chip only when playback is not 1x', () => {
    const { rerender } = render(
      <PlayerStatusChips status={{ playbackRate: 1.25, sampleRateMismatch: false } as never} state="playing" track={track()} />,
    );

    expect(getChip('1.25x').className).toContain('tag-speed');
    expect(screen.getByText('FLAC')).toBeTruthy();

    rerender(<PlayerStatusChips status={{ playbackRate: 1, sampleRateMismatch: false } as never} state="playing" track={track()} />);

    expect(screen.queryByText('1x')).toBeNull();
  });

  it('hides KuGou source chips while keeping audio spec chips', () => {
    render(
      <PlayerStatusChips
        status={null}
        state="playing"
        track={track({
          mediaType: 'streaming',
          provider: 'kugou',
          codec: 'mp3',
          bitDepth: null,
          bitrate: 128000,
        })}
      />,
    );

    expect(screen.queryByText('kugou')).toBeNull();
    expect(screen.getByText('MP3')).toBeTruthy();
    expect(screen.getByText('128kbps')).toBeTruthy();
  });

  it('surfaces remote playback loading even when codec chips are available', () => {
    render(<PlayerStatusChips status={null} state="loading" track={track({ mediaType: 'remote', sourceDisplayName: '百度网盘' })} />);

    expect(screen.getByText('加载中')).toBeTruthy();
    expect(screen.getByText('FLAC')).toBeTruthy();
  });

  it('shows detected BPM in the player tags for reliable and displayable estimated analysis', () => {
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
        track={track({ bpm: 121, bpmConfidence: 0.51, analysisStatus: 'low_confidence' })}
      />,
    );

    expect(screen.getByText('121 BPM')).toBeTruthy();

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
