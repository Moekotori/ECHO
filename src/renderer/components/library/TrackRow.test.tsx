// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TrackRow } from './TrackRow';
import type { LibraryTrack } from '../../../shared/types/library';

const track = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'track-1',
  path: 'D:\\Music\\song.flac',
  title: 'Afraid',
  artist: '2hollis / Nate Sib',
  album: 'afraid',
  albumArtist: '2hollis / Nate Sib',
  trackNo: 7,
  discNo: 1,
  year: 2025,
  genre: null,
  duration: 178,
  codec: 'flac',
  sampleRate: 96000,
  bitDepth: 24,
  bitrate: 900000,
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

describe('TrackRow', () => {
  it('renders the polished row with cover, copy, hifi tags, duration, and actions', () => {
    render(<TrackRow isPlaying={false} track={track()} onAddToQueue={vi.fn()} onOpenMenu={vi.fn()} />);

    expect(screen.getByText('Afraid')).toBeTruthy();
    expect(screen.getByText('2hollis / Nate Sib')).toBeTruthy();
    expect(screen.getByText('afraid')).toBeTruthy();
    expect(screen.getByText('FLAC')).toBeTruthy();
    expect(screen.getByText('24bit / 96kHz')).toBeTruthy();
    expect(screen.getByText('24bit / 96kHz').className).toContain('tag-hires');
    expect(screen.getByText('900kbps')).toBeTruthy();
    expect(screen.getByText('2:58')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add to queue Afraid|加入队列 Afraid/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /More Afraid|更多 Afraid/ })).toBeTruthy();
  });

  it('hides row actions when no action handlers are provided', () => {
    render(<TrackRow isPlaying={false} track={track()} />);

    expect(screen.queryByRole('button', { name: /Add to queue Afraid|加入队列 Afraid/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Download Afraid|下载 Afraid/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /More Afraid|更多 Afraid/ })).toBeNull();
  });

  it('does not style 24bit 48kHz files as Hi-Res', () => {
    render(<TrackRow isPlaying={false} track={track({ sampleRate: 48000, bitDepth: 24, bitrate: 1884000 })} />);

    const specTag = screen.getByText('24bit / 48kHz');
    expect(specTag.className).toContain('tag-depth');
    expect(specTag.className).not.toContain('tag-hires');
  });

  it('shows detected BPM tags only after reliable analysis', () => {
    const { rerender } = render(<TrackRow isPlaying={false} track={track({ bpm: 128, bpmConfidence: 0.92, analysisStatus: 'complete' })} />);

    expect(screen.getByText('128 BPM')).toBeTruthy();

    rerender(<TrackRow isPlaying={false} track={track({ bpm: 128, bpmConfidence: 0.2, analysisStatus: 'low_confidence' })} />);

    expect(screen.queryByText('128 BPM')).toBeNull();

    rerender(<TrackRow isPlaying={false} track={track({ bpm: 128, bpmConfidence: null, analysisStatus: 'analyzing' })} />);

    expect(screen.queryByText('128 BPM')).toBeNull();
  });

  it('handles missing cover and playing state safely', () => {
    render(<TrackRow isPlaying track={track({ coverThumb: null })} />);

    expect(screen.getByRole('listitem').getAttribute('data-playing')).toBe('true');
    expect(screen.getByText('Afraid')).toBeTruthy();
    expect(screen.getByText(/Playing|播放中/)).toBeTruthy();
  });

  it('shows loading instead of playing while a remote row is preparing playback', () => {
    render(<TrackRow isPlaying isLoading track={track({ mediaType: 'remote', sourceDisplayName: '百度网盘' })} />);

    expect(screen.getByRole('listitem').getAttribute('data-loading')).toBe('true');
    expect(screen.getByText('加载中')).toBeTruthy();
    expect(screen.queryByText('Playing')).toBeNull();
  });

  it('renders coverThumb as a lazy async image and falls back after load error', () => {
    const coverThumb = 'echo-cover://thumb/cover-1';
    const { container, rerender } = render(<TrackRow isPlaying={false} track={track({ coverThumb })} />);
    const img = container.querySelector('.track-cover img') as HTMLImageElement | null;

    expect(img?.getAttribute('src')).toBe(coverThumb);
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('decoding')).toBe('async');
    expect(img?.getAttribute('width')).toBe('96');
    expect(img?.getAttribute('height')).toBe('96');
    expect(img?.draggable).toBe(false);

    fireEvent.error(img!);
    expect(container.querySelector('.track-cover img')).toBeNull();
    expect(container.querySelector('.track-cover')?.getAttribute('data-empty')).toBe('true');

    rerender(<TrackRow isPlaying={false} track={track({ coverThumb })} />);
    expect(container.querySelector('.track-cover img')).toBeNull();
  });

  it('loads Subsonic proxy covers eagerly once the row is rendered', () => {
    const coverThumb = 'echo-image://subsonic-cover/remote-track-1?size=512';
    const { container } = render(<TrackRow isPlaying={false} track={track({ coverThumb, mediaType: 'remote', provider: 'subsonic' })} />);
    const img = container.querySelector('.track-cover img') as HTMLImageElement | null;

    expect(img?.getAttribute('src')).toBe(coverThumb);
    expect(img?.getAttribute('loading')).toBe('eager');
    expect(img?.getAttribute('decoding')).toBe('async');
  });

  it('hides Subsonic internal remote path tags', () => {
    render(
      <TrackRow
        isPlaying={false}
        track={track({
          mediaType: 'remote',
          provider: 'subsonic',
          remotePath: 'subsonic:song:p5Bw9bP7actay9UXpwJ7xv',
        })}
      />,
    );

    expect(screen.queryByText('subsonic:song:p5Bw9bP7actay9UXpwJ7xv')).toBeNull();
    expect(screen.getByText('subsonic')).toBeTruthy();
  });

  it('calls onPlay once from row click without action button bubbling', () => {
    const onPlay = vi.fn();
    render(<TrackRow isPlaying={false} track={track()} onAddToQueue={vi.fn()} onPlay={onPlay} />);

    fireEvent.click(screen.getByRole('listitem'));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: 'track-1' }));

    onPlay.mockClear();
    fireEvent.doubleClick(screen.getByRole('listitem'));
    expect(onPlay).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Add to queue Afraid|加入队列 Afraid/ }));
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('toggles selection on Ctrl+click without playing the row', () => {
    const onPlay = vi.fn();
    const onToggleSelected = vi.fn();
    const item = track();
    render(<TrackRow isPlaying={false} track={item} onPlay={onPlay} onToggleSelected={onToggleSelected} />);

    fireEvent.click(screen.getByRole('listitem'), { ctrlKey: true });

    expect(onToggleSelected).toHaveBeenCalledTimes(1);
    expect(onToggleSelected).toHaveBeenCalledWith(item);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('opens artist and album links without playing the row', () => {
    const onPlay = vi.fn();
    const onOpenArtist = vi.fn();
    const onOpenAlbum = vi.fn();
    const item = track();
    render(<TrackRow isPlaying={false} track={item} onPlay={onPlay} onOpenArtist={onOpenArtist} onOpenAlbum={onOpenAlbum} />);

    fireEvent.click(screen.getByRole('button', { name: '2hollis / Nate Sib' }));
    expect(onOpenArtist).toHaveBeenCalledWith(item);
    expect(onPlay).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'afraid' }));
    expect(onOpenAlbum).toHaveBeenCalledWith(item);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('adds a track to the queue from the row action without playing it', () => {
    const onPlay = vi.fn();
    const onAddToQueue = vi.fn();
    render(<TrackRow isPlaying={false} track={track()} onAddToQueue={onAddToQueue} onPlay={onPlay} />);

    fireEvent.click(screen.getByRole('button', { name: /Add to queue Afraid|加入队列 Afraid/ }));

    expect(onAddToQueue).toHaveBeenCalledTimes(1);
    expect(onAddToQueue).toHaveBeenCalledWith(expect.objectContaining({ id: 'track-1' }));
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('uses the row list action for playlists when provided', () => {
    const onPlay = vi.fn();
    const onAddToQueue = vi.fn();
    const onAddToPlaylist = vi.fn();
    render(
      <TrackRow
        isPlaying={false}
        track={track()}
        onAddToQueue={onAddToQueue}
        onAddToPlaylist={onAddToPlaylist}
        onPlay={onPlay}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加到歌单 Afraid' }));

    expect(onAddToPlaylist).toHaveBeenCalledTimes(1);
    expect(onAddToPlaylist).toHaveBeenCalledWith(expect.objectContaining({ id: 'track-1' }));
    expect(onAddToQueue).not.toHaveBeenCalled();
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('shows streaming download progress inside the download action', () => {
    render(<TrackRow isPlaying={false} track={track()} onDownload={vi.fn()} isDownloading downloadProgress={42} />);

    expect(screen.getByRole('button', { name: /Downloading Afraid 42%|正在下载 Afraid 42%/ })).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
  });

  it('hides the download action for Spotify streaming tracks', () => {
    render(
      <TrackRow
        isPlaying={false}
        track={track({ mediaType: 'streaming', provider: 'spotify', providerTrackId: 'spotify-track-id' })}
        onDownload={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Download Afraid' })).toBeNull();
  });

  it('marks clickable rows without adding a cover play affordance', () => {
    const { container } = render(<TrackRow isPlaying={false} track={track()} onPlay={vi.fn()} />);

    expect(screen.getByRole('listitem').getAttribute('data-clickable')).toBe('true');
    expect(container.querySelector('.track-cover-play')).toBeNull();
  });
});
