// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LibraryPage, LibraryTrack } from '../../../shared/types/library';
import { I18nProvider } from '../../i18n/I18nProvider';
import { ArtistTrackList } from './ArtistTrackList';

const queueMock = {
  items: [],
  removeTrackFromQueue: vi.fn(),
};

vi.mock('../../stores/PlaybackQueueProvider', () => ({
  usePlaybackQueue: () => queueMock,
}));

const track = (overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id: 'track-1',
  path: 'D:\\Music\\track-1.flac',
  title: 'Karakuri',
  artist: 'Archouchou',
  album: 'Refrain',
  albumArtist: 'Archouchou',
  trackNo: 1,
  discNo: 1,
  year: 2024,
  genre: null,
  duration: 221,
  codec: 'flac',
  sampleRate: 48000,
  bitDepth: 24,
  bitrate: 1411000,
  coverId: null,
  coverThumb: null,
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  networkMetadataStatus: 'none',
  fieldSources: {},
  ...overrides,
});

const page = (items: LibraryTrack[], overrides: Partial<LibraryPage<LibraryTrack>> = {}): LibraryPage<LibraryTrack> => ({
  items,
  page: 1,
  pageSize: 50,
  total: items.length,
  hasMore: false,
  ...overrides,
});

const installLibrary = (getArtistTracks: ReturnType<typeof vi.fn>): void => {
  window.echo = {
    library: {
      getArtistTracks,
    },
  } as unknown as Window['echo'];
};

const renderWithI18n = (element: JSX.Element) => {
  window.localStorage.setItem('echo-next.locale', 'en-US');
  return render(<I18nProvider>{element}</I18nProvider>);
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  queueMock.items = [];
  queueMock.removeTrackFromQueue.mockReset();
});

describe('ArtistTrackList', () => {
  it('opens the shared track context menu from right click and runs menu actions', async () => {
    const onAppendToQueue = vi.fn();
    const onPlayNext = vi.fn();
    installLibrary(vi.fn().mockResolvedValue(page([track()])));

    renderWithI18n(
      <ArtistTrackList
        artistId="artist-1"
        artistName="Archouchou"
        currentTrackId={null}
        onAppendToQueue={onAppendToQueue}
        onOpenAlbum={vi.fn()}
        onPlayNext={onPlayNext}
        onPlayTrack={vi.fn()}
      />,
    );

    const row = await screen.findByRole('listitem');
    fireEvent.contextMenu(row, { clientX: 120, clientY: 80 });

    await screen.findByRole('menu');
    const firstMenuItems = screen.getAllByRole('menuitem');
    fireEvent.click(firstMenuItems[1]);
    expect(onPlayNext).toHaveBeenCalledWith(expect.objectContaining({ id: 'track-1' }));

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Karakuri' }));

    await screen.findByRole('menu');
    const secondMenuItems = screen.getAllByRole('menuitem');
    fireEvent.click(secondMenuItems[2]);
    expect(onAppendToQueue).toHaveBeenCalledWith(expect.objectContaining({ id: 'track-1' }));
  });

  it('uses the artist track total for virtual height before every row is loaded', async () => {
    installLibrary(vi.fn().mockResolvedValue(page([track()], { total: 80, hasMore: false })));

    const { container } = renderWithI18n(
      <main className="page-surface">
        <ArtistTrackList
          artistId="artist-1"
          artistName="Archouchou"
          currentTrackId={null}
          onAppendToQueue={vi.fn()}
          onOpenAlbum={vi.fn()}
          onPlayNext={vi.fn()}
          onPlayTrack={vi.fn()}
        />
      </main>,
    );

    await screen.findByRole('listitem');
    const list = screen.getByRole('list');
    expect(list.getAttribute('data-total-count')).toBe('80');
    expect(list.getAttribute('data-loaded-count')).toBe('1');
    expect((container.querySelector('.artist-track-virtual-spacer') as HTMLElement).style.height).toBe('6400px');
  });
});
