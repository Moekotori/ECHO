// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TrackList } from './TrackList';
import type { LibraryTrack } from '../../../shared/types/library';

vi.mock('../../i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        'songs.trackList.aria': '歌曲列表',
        'songs.trackList.empty': '没有可显示的歌曲。导入音乐文件夹后，这里会显示曲库列表。',
      }[key] ?? key),
  }),
}));

const track = (index: number): LibraryTrack => ({
  id: `track-${index}`,
  path: `D:\\Music\\song-${index}.flac`,
  title: `Song ${index}`,
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album Artist',
  trackNo: index,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 900000,
  coverId: null,
  coverThumb: null,
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  networkMetadataStatus: 'none',
  fieldSources: {},
});

afterEach(() => {
  cleanup();
});

describe('TrackList', () => {
  it('renders the polished empty list without a table header', () => {
    render(<TrackList currentTrackId={null} tracks={[]} />);

    expect(screen.getByRole('list').getAttribute('data-estimated-row-height')).toBe('76');
    expect(screen.getByText(/没有可显示的歌曲/)).toBeTruthy();
    expect(screen.queryByText('专辑艺术家')).toBeNull();
    expect(screen.queryByText('发行年份')).toBeNull();
  });

  it('keeps virtualization enabled for large track sets', () => {
    const tracks = Array.from({ length: 120 }, (_, index) => track(index + 1));

    render(<TrackList currentTrackId="track-3" tracks={tracks} />);

    expect(screen.getByRole('list').getAttribute('data-virtualized')).toBe('true');
    expect(screen.queryByText(/没有可显示的歌曲/)).toBeNull();
  });

  it('marks the requested loading track without requiring it to be the current track', () => {
    const tracks = [track(1), track(2)];

    render(<TrackList currentTrackId={null} loadingTrackId="track-2" tracks={tracks} />);

    expect(screen.getByText('Song 2').closest('.track-row')?.getAttribute('data-loading')).toBe('true');
    expect(screen.getByText('加载中')).toBeTruthy();
  });

  it('reports loaded track ids in the rendered virtual window', async () => {
    const onVisibleTrackIdsChange = vi.fn();
    const tracks = Array.from({ length: 5 }, (_, index) => track(index + 1));

    render(<TrackList currentTrackId={null} tracks={tracks} onVisibleTrackIdsChange={onVisibleTrackIdsChange} />);

    await vi.waitFor(() => expect(onVisibleTrackIdsChange).toHaveBeenCalled());
    expect(onVisibleTrackIdsChange.mock.calls.at(-1)?.[0]).toEqual(tracks.map((item) => item.id));
  });

  it('sizes the virtual spacer from totalCount when only part of the library is loaded', () => {
    const tracks = Array.from({ length: 2 }, (_, index) => track(index + 1));
    const { container } = render(<TrackList currentTrackId={null} tracks={tracks} totalCount={100} loadedCount={2} />);

    expect(screen.getByRole('list').getAttribute('data-total-count')).toBe('100');
    expect(screen.getByRole('list').getAttribute('data-loaded-count')).toBe('2');
    expect((container.querySelector('.track-virtual-spacer') as HTMLElement).style.height).toBe('7600px');
  });

  it('renders a loaded middle page at its absolute virtual row positions', () => {
    const tracks = [track(51), track(52)];
    render(<TrackList currentTrackId={null} tracks={tracks} totalCount={100} loadedCount={2} loadedStartIndex={50} />);

    expect(screen.getByRole('list').getAttribute('data-loaded-start-index')).toBe('50');
    expect(screen.getByRole('list').getAttribute('data-total-count')).toBe('100');
    expect(screen.getByRole('list').getAttribute('data-loaded-count')).toBe('2');
  });

  it('renders unloaded rows as lightweight skeletons without row action buttons', () => {
    render(<TrackList currentTrackId={null} tracks={[]} totalCount={20} loadedCount={0} />);

    expect(screen.queryByText(/没有可显示的歌曲/)).toBeNull();
    expect(document.querySelector('.track-row-skeleton')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not render inline liked buttons in track rows', () => {
    const tracks = [track(1)];

    render(
      <TrackList
        currentTrackId={null}
        likedTrackIds={{ 'track-1': true }}
        tracks={tracks}
        onToggleLiked={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /Like Song 1|Unlike Song 1/ })).toBeNull();
  });

  it('marks selected rows and forwards Ctrl+click selection toggles', () => {
    const onToggleSelected = vi.fn();
    const tracks = [track(1), track(2)];

    render(
      <TrackList
        currentTrackId={null}
        tracks={tracks}
        selectedTrackIds={{ 'track-2': true }}
        onToggleSelected={onToggleSelected}
      />,
    );

    expect(screen.getByText('Song 2').closest('.track-row')?.getAttribute('data-selected')).toBe('true');

    fireEvent.click(screen.getByText('Song 1').closest('.track-row')!, { ctrlKey: true });

    expect(onToggleSelected).toHaveBeenCalledWith(expect.objectContaining({ id: 'track-1' }));
  });

  it('only requests one next page while the loaded boundary is still the same', () => {
    const onEndReached = vi.fn();
    const tracks = Array.from({ length: 2 }, (_, index) => track(index + 1));
    const { rerender } = render(
      <TrackList currentTrackId={null} tracks={tracks} totalCount={100} loadedCount={2} canLoadMore onEndReached={onEndReached} />,
    );
    const list = screen.getByRole('list');

    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 7600 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 500 });
    list.scrollTop = 7100;
    fireEvent.scroll(list);
    fireEvent.scroll(list);

    expect(onEndReached).toHaveBeenCalledTimes(1);

    const nextTracks = Array.from({ length: 4 }, (_, index) => track(index + 1));
    rerender(<TrackList currentTrackId={null} tracks={nextTracks} totalCount={100} loadedCount={4} canLoadMore onEndReached={onEndReached} />);
    fireEvent.scroll(list);

    expect(onEndReached).toHaveBeenCalledTimes(2);
  });

});
