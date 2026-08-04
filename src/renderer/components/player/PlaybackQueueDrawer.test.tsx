// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { useEffect, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LibraryTrack } from '../../../shared/types/library';
import type { PersistedQueueSource } from '../../../shared/types/playback';
import { PlaybackQueueProvider, usePlaybackQueue } from '../../stores/PlaybackQueueProvider';
import { PlaybackQueueDrawer } from './PlaybackQueueDrawer';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 64,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 64 })),
    measureElement: vi.fn(),
  }),
}));

const makeTrack = (index: number): LibraryTrack => ({
  id: `track-${index}`,
  path: `D:\\Music\\track-${index}.flac`,
  title: `Track ${index}`,
  artist: `Artist ${index}`,
  album: 'Album',
  albumArtist: 'Album Artist',
  trackNo: index,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180 + index,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 320000,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
});

const QueueSeeder = ({
  tracks,
  currentTrackId,
  source,
  shuffle,
}: {
  tracks: LibraryTrack[];
  currentTrackId?: string;
  source?: PersistedQueueSource;
  shuffle?: boolean;
}): null => {
  const queue = usePlaybackQueue();
  const didSeedRef = useRef(false);

  useEffect(() => {
    if (didSeedRef.current) {
      return;
    }

    didSeedRef.current = true;
    queue.replaceQueue(tracks, { source, startTrackId: currentTrackId });
    if (currentTrackId) {
      queue.setCurrentTrackId(currentTrackId);
    }
    if (shuffle && !queue.isShuffleEnabled) {
      queue.toggleShuffle();
    }
  }, [currentTrackId, queue, shuffle, source, tracks]);

  return null;
};

const renderDrawer = (isOpen: boolean, tracks: LibraryTrack[], currentTrackId?: string, source?: PersistedQueueSource, shuffle = false): void => {
  render(
    <PlaybackQueueProvider>
      <QueueSeeder tracks={tracks} currentTrackId={currentTrackId} source={source} shuffle={shuffle} />
      <PlaybackQueueDrawer isOpen={isOpen} onClose={vi.fn()} onOpenFullQueue={vi.fn()} />
    </PlaybackQueueProvider>,
  );
};

const QueueAppendSeeder = ({ track, source }: { track: LibraryTrack; source: PersistedQueueSource }): null => {
  const queue = usePlaybackQueue();
  const didSeedRef = useRef(false);

  useEffect(() => {
    if (didSeedRef.current) {
      return;
    }

    didSeedRef.current = true;
    queue.appendToQueue(track, source);
  }, [queue, source, track]);

  return null;
};

const renderDrawerWithAppendFeedback = (track: LibraryTrack, source: PersistedQueueSource): void => {
  render(
    <PlaybackQueueProvider>
      <QueueAppendSeeder track={track} source={source} />
      <PlaybackQueueDrawer isOpen onClose={vi.fn()} onOpenFullQueue={vi.fn()} />
    </PlaybackQueueProvider>,
  );
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('PlaybackQueueDrawer', () => {
  it('keeps the lightweight queue drawer animation visible without heavy shadow bloom', () => {
    const css = readFileSync('src/renderer/styles/lyrics.css', 'utf8');

    expect(css).toMatch(/\.lyrics-queue-drawer__scrim \{[\s\S]*?background: transparent;/);
    expect(css).toMatch(/\.lyrics-queue-drawer__panel \{[\s\S]*?--lyrics-queue-panel-shadow: 0 14px 34px rgba\(15, 23, 42, 0\.07\)/);
    expect(css).toMatch(/grid-template-rows: auto auto auto auto minmax\(0, 1fr\) auto;/);
    expect(css).toContain('.lyrics-queue-notices');
    expect(css).not.toContain('0 24px 64px rgba(21, 28, 38, 0.2)');
    expect(css).not.toContain('0 24px 68px rgba(0, 0, 0, 0.38)');
    expect(css).toMatch(/@keyframes lyrics-queue-panel-in \{[\s\S]*?translate3d\(26px, 0, 0\) scale\(0\.975\)[\s\S]*?translate3d\(-3px, 0, 0\) scale\(1\.002\)/);
  });

  it('does not mount the queue list while closed', () => {
    renderDrawer(false, [makeTrack(1), makeTrack(2)]);

    expect(screen.queryByRole('complementary', { name: '播放队列抽屉' })).toBeNull();
    expect(screen.queryByText('Track 1')).toBeNull();
  });

  it('renders a virtualized queue and supports focused queue actions', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const third = makeTrack(3);
    const playLocalFile = vi.fn().mockImplementation((request: { trackId: string; filePath: string }) =>
      Promise.resolve({
        state: 'playing',
        currentTrackId: request.trackId,
        positionMs: 0,
        durationMs: 180000,
        filePath: request.filePath,
      }),
    );

    window.echo = {
      playback: {
        playLocalFile,
      },
      library: {
        startPlaybackHistory: vi.fn().mockResolvedValue({ historyId: 'history-1' }),
      },
    } as unknown as Window['echo'];

    renderDrawer(true, [first, second, third], first.id);

    expect(await screen.findByText('Track 2')).toBeTruthy();
    expect(document.querySelector('.lyrics-queue-list')?.getAttribute('data-virtualized')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '从这里开始 Track 2' }));
    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: second.id })));

    const list = document.querySelector('.lyrics-queue-list') as HTMLElement;
    const secondRow = within(list).getByText('Track 2').closest('.lyrics-queue-row');
    const thirdRow = within(list).getByText('Track 3').closest('.lyrics-queue-row');
    let transferredQueueId = '';
    const dragData = {
      effectAllowed: '',
      dropEffect: '',
      getData: vi.fn(() => transferredQueueId),
      setData: vi.fn((_type: string, value: string) => {
        transferredQueueId = value;
      }),
    };

    expect(secondRow).toBeTruthy();
    expect(thirdRow).toBeTruthy();
    fireEvent.dragStart(thirdRow as HTMLElement, { dataTransfer: dragData });
    fireEvent.dragOver(secondRow as HTMLElement, { dataTransfer: dragData });
    fireEvent.drop(secondRow as HTMLElement, { dataTransfer: dragData });

    const rowsAfterMove = Array.from(document.querySelectorAll('.lyrics-queue-row-main strong')).map((element) => element.textContent);
    expect(rowsAfterMove).toEqual(['Track 1', 'Track 3', 'Track 2']);

    const movedThirdRow = within(list).getByText('Track 3').closest('.lyrics-queue-row');
    expect(movedThirdRow).toBeTruthy();
    fireEvent.click(within(movedThirdRow as HTMLElement).getByRole('button', { name: '移除 Track 3' }));
    expect(screen.queryByText('Track 3')).toBeNull();
  });

  it('shows the current source and shuffle scope', async () => {
    const first = makeTrack(1);
    const source: PersistedQueueSource = {
      type: 'folder',
      label: 'Workout',
      folderId: 'folder-1',
      path: 'D:\\Music\\Workout',
      recursive: true,
      sort: 'random',
    };

    renderDrawer(true, [first, makeTrack(2)], first.id, source, true);

    expect(await screen.findByText('来自 当前文件夹随机：Workout')).toBeTruthy();
    expect(screen.getByText('随机范围：当前文件夹随机：Workout · 避开最近 25 首')).toBeTruthy();
  });

  it('fills the drawer queue with random tracks from the current source', async () => {
    const first = makeTrack(1);
    const filled = makeTrack(20);
    const getTracks = vi.fn().mockResolvedValue({
      items: [first, filled],
      total: 2,
      page: 1,
      pageSize: 36,
      hasMore: false,
    });

    window.echo = {
      library: {
        getTracks,
      },
    } as unknown as Window['echo'];

    renderDrawer(true, [first], first.id, { type: 'songs', label: '随机队列', sort: 'random' });

    fireEvent.click(await screen.findByRole('button', { name: '补全队列' }));

    await waitFor(() => expect(getTracks).toHaveBeenCalledWith(expect.objectContaining({ sort: 'random', randomWindow: true })));
    expect(await screen.findByText(filled.title)).toBeTruthy();
    expect(screen.getByText('已补全 1 首')).toBeTruthy();
  });

  it('shows queue add feedback', async () => {
    const track = makeTrack(4);
    const source: PersistedQueueSource = {
      type: 'album',
      label: 'Album',
      albumId: 'album-1',
    };

    renderDrawerWithAppendFeedback(track, source);

    expect(await screen.findByText('已加入队尾')).toBeTruthy();
    expect(screen.getByText('Track 4 · 专辑：Album')).toBeTruthy();
  });
});
