// @vitest-environment jsdom
import { useEffect, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LibraryTrack } from '../../../shared/types/library';
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

const QueueSeeder = ({ tracks, currentTrackId }: { tracks: LibraryTrack[]; currentTrackId?: string }): null => {
  const queue = usePlaybackQueue();
  const didSeedRef = useRef(false);

  useEffect(() => {
    if (didSeedRef.current) {
      return;
    }

    didSeedRef.current = true;
    queue.replaceQueue(tracks, { startTrackId: currentTrackId });
    if (currentTrackId) {
      queue.setCurrentTrackId(currentTrackId);
    }
  }, [currentTrackId, queue, tracks]);

  return null;
};

const renderDrawer = (isOpen: boolean, tracks: LibraryTrack[], currentTrackId?: string): void => {
  render(
    <PlaybackQueueProvider>
      <QueueSeeder tracks={tracks} currentTrackId={currentTrackId} />
      <PlaybackQueueDrawer isOpen={isOpen} onClose={vi.fn()} onOpenFullQueue={vi.fn()} />
    </PlaybackQueueProvider>,
  );
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('PlaybackQueueDrawer', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '播放 Track 2' }));
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
});
