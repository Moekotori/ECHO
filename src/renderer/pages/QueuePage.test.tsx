// @vitest-environment jsdom
import { useEffect, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LibraryTrack } from '../../shared/types/library';
import { I18nProvider } from '../i18n/I18nProvider';
import { PlaybackQueueProvider, usePlaybackQueue } from '../stores/PlaybackQueueProvider';
import { QueuePage } from './QueuePage';

const { scrollToIndexMock } = vi.hoisted(() => ({
  scrollToIndexMock: vi.fn(),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 64,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 64 })),
    measureElement: vi.fn(),
    scrollToIndex: scrollToIndexMock,
  }),
}));

vi.mock('../components/library/OsuTimingPanel', () => ({
  OsuTimingPanel: () => null,
}));

vi.mock('../components/library/TrackTagEditorDrawer', () => ({
  TrackTagEditorDrawer: () => null,
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
  duration: 180,
  codec: 'flac',
  sampleRate: 44100,
  bitDepth: 16,
  bitrate: 320000,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
});

const QueueSeeder = ({ startTrackId, tracks }: { startTrackId?: string; tracks: LibraryTrack[] }): null => {
  const queue = usePlaybackQueue();
  const didSeedRef = useRef(false);

  useEffect(() => {
    if (didSeedRef.current) {
      return;
    }

    didSeedRef.current = true;
    queue.replaceQueue(tracks, startTrackId ? { startTrackId } : undefined);
  }, [queue, startTrackId, tracks]);

  return null;
};

const QueueSourceProbe = (): JSX.Element => {
  const queue = usePlaybackQueue();

  return (
    <output aria-label="queue-sources">
      {queue.items.map((item) => `${item.source.type}:${'sort' in item.source ? item.source.sort ?? '' : ''}`).join(',')}
    </output>
  );
};

const QueueOrderProbe = (): JSX.Element => {
  const queue = usePlaybackQueue();

  return <output aria-label="queue-order">order:{queue.items.map((item) => item.track.title).join('>')}</output>;
};

const renderQueuePage = (tracks: LibraryTrack[], options: { startTrackId?: string } = {}): void => {
  render(
    <I18nProvider>
      <PlaybackQueueProvider>
        <QueueSeeder startTrackId={options.startTrackId} tracks={tracks} />
        <QueueSourceProbe />
        <QueueOrderProbe />
        <QueuePage />
      </PlaybackQueueProvider>
    </I18nProvider>,
  );
};

const enterQueueSelectionMode = (): void => {
  expect(document.querySelector('.queue-row-select input')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^(Select|选择)$/u }));
  expect(document.querySelector('.queue-row-select input')).toBeTruthy();
};

const openQueueActionsMenu = (): void => {
  fireEvent.click(screen.getByRole('button', { name: '队列管理' }));
};

const findQueueRowByTrackTitle = async (title: string): Promise<HTMLElement> => {
  let matchedRow: HTMLElement | null = null;

  await waitFor(() => {
    matchedRow =
      Array.from(document.querySelectorAll<HTMLElement>('.queue-row'))
        .find((row) => row.querySelector('.queue-row-copy strong')?.textContent === title) ?? null;
    expect(matchedRow).toBeTruthy();
  });

  return matchedRow!;
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  scrollToIndexMock.mockClear();
  vi.restoreAllMocks();
});

describe('QueuePage', () => {
  it('uses one exclusive transition mode and exposes the complete playback strategy', async () => {
    const setSettings = vi.fn().mockImplementation(async (settings: { gaplessPlaybackEnabled: boolean }) => settings);
    window.echo = {
      app: {
        getSettings: vi.fn().mockResolvedValue({ gaplessPlaybackEnabled: false }),
        setSettings,
      },
    } as unknown as Window['echo'];

    renderQueuePage([makeTrack(1)]);

    const normalButton = await screen.findByRole('radio', { name: '普通' });
    const gaplessButton = screen.getByRole('radio', { name: '无缝' });
    const smartButton = screen.getByRole('radio', { name: '智能' });
    expect(normalButton.getAttribute('aria-checked')).toBe('true');
    expect(gaplessButton.getAttribute('aria-checked')).toBe('false');
    expect(smartButton.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(smartButton);
    await waitFor(() => expect(smartButton.getAttribute('aria-checked')).toBe('true'));

    fireEvent.click(gaplessButton);
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ gaplessPlaybackEnabled: true }));
    await waitFor(() => expect(gaplessButton.getAttribute('aria-checked')).toBe('true'));
    expect(smartButton.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(normalButton);
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ gaplessPlaybackEnabled: false }));
    await waitFor(() => expect(normalButton.getAttribute('aria-checked')).toBe('true'));

    const repeatGroup = screen.getByRole('group', { name: /Cycle mode|循环模式/u });
    expect(within(repeatGroup).getByRole('button', { name: /Single track|单曲/u })).toBeTruthy();
    expect(within(repeatGroup).getByRole('button', { name: /Queue|队列/u })).toBeTruthy();
  });

  it('filters a long queue and locates the current track after clearing the search', async () => {
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3)];
    renderQueuePage(tracks, { startTrackId: tracks[0].id });

    await findQueueRowByTrackTitle('Track 3');
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索队列' }), { target: { value: 'Track 3' } });

    await waitFor(() =>
      expect(Array.from(document.querySelectorAll('.queue-row-copy strong')).map((node) => node.textContent)).toEqual(['Track 3']),
    );

    fireEvent.click(screen.getByRole('button', { name: '定位当前播放' }));

    await waitFor(() => expect(screen.getByRole('searchbox', { name: '搜索队列' }).getAttribute('value')).toBe(''));
    await waitFor(() => expect(scrollToIndexMock).toHaveBeenCalledWith(0, { align: 'center' }));
  });

  it('supports keyboard queue reordering from the drag handle', async () => {
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3), makeTrack(4)];
    renderQueuePage(tracks, { startTrackId: tracks[0].id });

    await findQueueRowByTrackTitle('Track 4');
    fireEvent.keyDown(screen.getByRole('button', { name: '调整 Track 3 的位置' }), {
      altKey: true,
      key: 'ArrowUp',
    });
    await waitFor(() => expect(screen.getByLabelText('queue-order').textContent).toBe('order:Track 1>Track 3>Track 2>Track 4'));

    fireEvent.keyDown(screen.getByRole('button', { name: '调整 Track 4 的位置' }), {
      altKey: true,
      key: 'n',
    });
    await waitFor(() => expect(screen.getByLabelText('queue-order').textContent).toBe('order:Track 1>Track 4>Track 3>Track 2'));
  });

  it('shows row checkboxes only while selection mode is active', async () => {
    const tracks = [makeTrack(1), makeTrack(2)];
    renderQueuePage(tracks, { startTrackId: tracks[0].id });

    await findQueueRowByTrackTitle('Track 2');
    expect(screen.queryByLabelText('选择 Track 2')).toBeNull();
    enterQueueSelectionMode();
    expect(screen.getByLabelText('选择 Track 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Select all|全选/u })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^(Done|完成)$/u }));
    expect(screen.queryByLabelText('选择 Track 2')).toBeNull();
  });

  it('uses static large artwork for the large now-playing cover only', async () => {
    const track: LibraryTrack = {
      ...makeTrack(1),
      coverId: 'cover 1',
      coverThumb: 'echo-cover://thumb/cover%201',
    };

    renderQueuePage([track], { startTrackId: track.id });

    await waitFor(() =>
      expect(document.querySelector('.queue-now-cover img')?.getAttribute('src')).toBe('echo-cover://large/cover%201'),
    );
    expect(document.querySelector('.queue-row-cover img')?.getAttribute('src')).toBe('echo-cover://thumb/cover%201');
  });

  it('plays a queued item when its row is double-clicked', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
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

    renderQueuePage([first, second]);

    const secondRow = await findQueueRowByTrackTitle('Track 2');

    fireEvent.doubleClick(secondRow!);

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: second.id })));
  });

  it('starts playback from a queued row action', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
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

    renderQueuePage([first, second]);

    fireEvent.click(await screen.findByRole('button', { name: 'Start from here: Track 2' }));

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: second.id })));
  });

  it('shows the next queued track in the now-playing card', async () => {
    const first = makeTrack(1);
    const second = { ...makeTrack(2), coverThumb: 'echo-cover://thumb/cover-2' };
    renderQueuePage([first, second], { startTrackId: first.id });

    await findQueueRowByTrackTitle('Track 2');

    const preview = document.querySelector('.queue-next-preview');
    expect(preview?.textContent ?? '').toContain('Next Up');
    expect(preview?.textContent ?? '').toContain('Track 2');
    expect(preview?.textContent ?? '').toContain('Artist 2');
    expect(preview?.querySelector('img')?.getAttribute('src')).toBe('echo-cover://large/cover-2');
  });

  it('confirms before clearing the queue', async () => {
    const tracks = [makeTrack(1), makeTrack(2)];
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderQueuePage(tracks, { startTrackId: tracks[0].id });

    await findQueueRowByTrackTitle('Track 2');
    openQueueActionsMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear queue' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('2 waiting tracks'));
    expect(screen.getByLabelText('queue-order').textContent).toBe('order:Track 1>Track 2');

    confirm.mockReturnValue(true);
    openQueueActionsMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear queue' }));

    await waitFor(() => expect(screen.getByLabelText('queue-order').textContent).toBe('order:'));
  });

  it('shows a receipt when the context menu queues a track next', async () => {
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3)];
    renderQueuePage(tracks, { startTrackId: tracks[0].id });

    const thirdRow = await findQueueRowByTrackTitle('Track 3');

    fireEvent.contextMenu(thirdRow!);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Play next' }));

    await waitFor(() => expect(screen.getByLabelText('queue-order').textContent).toBe('order:Track 1>Track 3>Track 2>Track 3'));
    expect(document.querySelector('.queue-action-receipt')?.textContent ?? '').toContain('Queued next');
    expect(document.querySelector('.queue-action-receipt')?.textContent ?? '').toContain('Track 3');
  });

  it('moves selected tracks after the current item and can undo the queue move', async () => {
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3), makeTrack(4)];
    renderQueuePage(tracks, { startTrackId: tracks[0].id });

    await findQueueRowByTrackTitle('Track 4');
    enterQueueSelectionMode();
    fireEvent.click(screen.getByLabelText('选择 Track 3'));
    fireEvent.click(screen.getByLabelText('选择 Track 4'));
    fireEvent.click(screen.getByRole('button', { name: '下一首播放' }));

    await waitFor(() => expect(screen.getByLabelText('queue-order').textContent).toBe('order:Track 1>Track 3>Track 4>Track 2'));
    const receipt = document.querySelector('.queue-action-receipt');
    expect(receipt?.textContent ?? '').toMatch(/Inserted 2 tracks next|已临时插播 2 首/u);
    expect(receipt?.textContent ?? '').toContain('Track 3');
    expect(receipt?.textContent ?? '').toContain('Track 4');
    expect(document.querySelectorAll('.queue-row[data-recent-change="true"]').length).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: /Undo this action|撤销这次操作/u }));
    await waitFor(() => expect(screen.getByLabelText('queue-order').textContent).toBe('order:Track 1>Track 2>Track 3>Track 4'));
    expect(screen.getByText(/Undone|已撤销/u)).toBeTruthy();
  });

  it('removes selected queue items and restores them with undo', async () => {
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3), makeTrack(4)];
    renderQueuePage(tracks, { startTrackId: tracks[0].id });

    await findQueueRowByTrackTitle('Track 4');
    enterQueueSelectionMode();
    fireEvent.click(screen.getByLabelText('选择 Track 2'));
    fireEvent.click(screen.getByLabelText('选择 Track 3'));
    fireEvent.click(screen.getByRole('button', { name: '移出队列' }));

    await waitFor(() => expect(screen.getByLabelText('queue-order').textContent).toBe('order:Track 1>Track 4'));
    const receipt = document.querySelector('.queue-action-receipt');
    expect(receipt?.textContent ?? '').toMatch(/Removed 2 tracks|已移除 2 首/u);
    expect(receipt?.textContent ?? '').toContain('Track 2');
    expect(receipt?.textContent ?? '').toContain('Track 3');

    fireEvent.click(screen.getByRole('button', { name: /Undo this action|撤销这次操作/u }));
    await waitFor(() => expect(screen.getByLabelText('queue-order').textContent).toBe('order:Track 1>Track 2>Track 3>Track 4'));
  });

  it('removes a marked queue item after playback moves away from it', async () => {
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

    renderQueuePage([first, second, third], { startTrackId: first.id });

    await findQueueRowByTrackTitle('Track 3');
    enterQueueSelectionMode();
    fireEvent.click(screen.getByLabelText('选择 Track 1'));
    openQueueActionsMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Remove after play|播放后移除/u }));
    expect(screen.getByText(/Remove after play|播完移除/u)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Start from here: Track 2' }));

    await waitFor(() => expect(playLocalFile).toHaveBeenCalledWith(expect.objectContaining({ trackId: second.id })));
    await waitFor(() => expect(screen.getByLabelText('queue-order').textContent).toBe('order:Track 2>Track 3'));
  });

  it('generates random queues as refreshable song-library random queues', async () => {
    const first = makeTrack(1);
    const second = makeTrack(2);
    const getTracks = vi.fn().mockResolvedValue({
      items: [first, second],
      page: 1,
      pageSize: 96,
      total: 2,
      hasMore: false,
    });

    window.echo = {
      library: {
        getTracks,
      },
    } as unknown as Window['echo'];

    renderQueuePage([]);

    openQueueActionsMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Generate random queue' }));

    await waitFor(() =>
      expect(getTracks).toHaveBeenCalledWith({
        page: 1,
        pageSize: 96,
        sort: 'random',
        randomWindow: true,
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('queue-sources').textContent).toBe('songs:random,songs:random'));
  });

  it('does not treat double-clicks inside the action group as row playback', async () => {
    const first = makeTrack(1);
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

    renderQueuePage([first]);

    const firstRow = await findQueueRowByTrackTitle('Track 1');
    const actionGroup = firstRow.querySelector('.queue-row-actions');
    expect(actionGroup).toBeTruthy();

    fireEvent.doubleClick(actionGroup!);

    expect(playLocalFile).not.toHaveBeenCalled();
  });

  it('does not create a local playlist from remote-only queue items', async () => {
    const remoteTrack: LibraryTrack = {
      ...makeTrack(1),
      id: 'remote-track-1',
      path: 'webdav://source/music/track-1.flac',
      sourceId: 'remote-source-1',
      remotePath: '/music/track-1.flac',
      stableKey: 'remote:source-1:/music/track-1.flac',
    };
    const createPlaylist = vi.fn().mockResolvedValue({
      id: 'playlist-queue',
      name: 'Queue Playlist',
    });
    const addTracksToPlaylist = vi.fn().mockResolvedValue([{ id: 'playlist-item-1' }]);
    const deletePlaylist = vi.fn();

    window.echo = {
      library: {
        createPlaylist,
        addTracksToPlaylist,
        deletePlaylist,
      },
    } as unknown as Window['echo'];

    renderQueuePage([remoteTrack]);

    await findQueueRowByTrackTitle('Track 1');
    openQueueActionsMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '保存为歌单' }));

    await waitFor(() => expect(screen.getByText(/No library tracks in the queue can be saved to a local playlist|当前队列没有可保存到本地歌单的已入库歌曲/u)).toBeTruthy());
    expect(createPlaylist).not.toHaveBeenCalled();
    expect(addTracksToPlaylist).not.toHaveBeenCalled();
    expect(deletePlaylist).not.toHaveBeenCalled();
  });

  it('does not create a playlist from streaming-only queue items', async () => {
    const streamingTrack: LibraryTrack = {
      ...makeTrack(2),
      id: 'streaming:netease:200',
      mediaType: 'streaming',
      path: 'streaming:netease:200',
      provider: 'netease',
      providerTrackId: '200',
      stableKey: 'streaming:netease:200',
      codec: null,
      sampleRate: null,
      bitDepth: null,
      bitrate: null,
    };
    const createPlaylist = vi.fn().mockResolvedValue({
      id: 'playlist-queue',
      name: 'Queue Playlist',
    });
    const addStreamingTrackToPlaylist = vi.fn().mockResolvedValue({ id: 'playlist-item-streaming' });

    window.echo = {
      library: {
        createPlaylist,
        addTracksToPlaylist: vi.fn(),
        addStreamingTrackToPlaylist,
      },
    } as unknown as Window['echo'];

    renderQueuePage([streamingTrack]);

    await findQueueRowByTrackTitle('Track 2');
    openQueueActionsMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '保存为歌单' }));

    await waitFor(() => expect(screen.getByText(/No library tracks in the queue can be saved to a local playlist|当前队列没有可保存到本地歌单的已入库歌曲/u)).toBeTruthy());
    expect(createPlaylist).not.toHaveBeenCalled();
    expect(addStreamingTrackToPlaylist).not.toHaveBeenCalled();
  });

  it('skips remote and streaming items when saving a mixed queue to a local playlist', async () => {
    const localTrack = makeTrack(1);
    const remoteTrack: LibraryTrack = {
      ...makeTrack(3),
      id: 'remote-track-3',
      mediaType: 'remote',
      path: 'webdav://source/music/track-3.flac',
      sourceId: 'remote-source-1',
      remotePath: '/music/track-3.flac',
      stableKey: 'remote:source-1:/music/track-3.flac',
    };
    const streamingTrack: LibraryTrack = {
      ...makeTrack(2),
      id: 'streaming:netease:200',
      mediaType: 'streaming',
      path: 'streaming:netease:200',
      provider: 'netease',
      providerTrackId: '200',
      stableKey: 'streaming:netease:200',
    };
    const createPlaylist = vi.fn().mockResolvedValue({
      id: 'playlist-queue',
      name: 'Queue Playlist',
    });
    const addTracksToPlaylist = vi.fn().mockResolvedValue([{ id: 'playlist-item-local' }]);
    const addStreamingTrackToPlaylist = vi.fn();

    window.echo = {
      library: {
        createPlaylist,
        addTracksToPlaylist,
        addStreamingTrackToPlaylist,
      },
    } as unknown as Window['echo'];

    renderQueuePage([localTrack, remoteTrack, streamingTrack]);

    await findQueueRowByTrackTitle('Track 2');
    openQueueActionsMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '保存为歌单' }));

    await waitFor(() => expect(addTracksToPlaylist).toHaveBeenCalledWith('playlist-queue', ['track-1']));
    expect(addStreamingTrackToPlaylist).not.toHaveBeenCalled();
  });
});
