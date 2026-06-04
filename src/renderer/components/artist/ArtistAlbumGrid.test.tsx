// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LibraryAlbum, LibraryPage } from '../../../shared/types/library';
import { I18nProvider } from '../../i18n/I18nProvider';
import { ArtistAlbumGrid } from './ArtistAlbumGrid';

const album = (overrides: Partial<LibraryAlbum> = {}): LibraryAlbum => ({
  id: 'album-1',
  albumKey: 'echo/unit',
  title: 'Refrain',
  albumArtist: 'Archouchou',
  year: 2024,
  trackCount: 18,
  duration: 4200,
  coverId: null,
  coverThumb: null,
  ...overrides,
});

const page = (items: LibraryAlbum[], overrides: Partial<LibraryPage<LibraryAlbum>> = {}): LibraryPage<LibraryAlbum> => ({
  items,
  page: 1,
  pageSize: 12,
  total: items.length,
  hasMore: false,
  ...overrides,
});

const installLibrary = (getArtistAlbums: ReturnType<typeof vi.fn>): void => {
  window.echo = {
    library: {
      getArtistAlbums,
    },
  } as unknown as Window['echo'];
};

const renderAlbumGrid = ({
  artistId = 'artist-1',
  artistName = 'Archouchou',
  albumCount,
  onAlbumSelect = vi.fn(),
}: {
  artistId?: string;
  artistName?: string;
  albumCount?: number;
  onAlbumSelect?: (album: LibraryAlbum) => void;
} = {}) =>
  render(
    <I18nProvider>
      <ArtistAlbumGrid artistId={artistId} artistName={artistName} albumCount={albumCount} onAlbumSelect={onAlbumSelect} />
    </I18nProvider>,
  );

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ArtistAlbumGrid', () => {
  it('shows stable album placeholders while the first artist album page is loading', async () => {
    let resolvePage!: (value: LibraryPage<LibraryAlbum>) => void;
    const pendingPage = new Promise<LibraryPage<LibraryAlbum>>((resolve) => {
      resolvePage = resolve;
    });
    installLibrary(vi.fn().mockReturnValue(pendingPage));

    const { container } = renderAlbumGrid();

    expect(container.querySelector('.artist-album-strip[data-loading="true"]')).toBeTruthy();
    expect(container.querySelectorAll('.artist-album-card-skeleton')).toHaveLength(6);

    resolvePage(page([album()]));

    await waitFor(() => expect(container.querySelector('.artist-album-strip[data-loading="true"]')).toBeNull());
    expect(await screen.findByRole('button', { name: /Refrain/i })).toBeTruthy();
  });

  it('selects an artist album by click and keyboard', async () => {
    const selected = vi.fn();
    installLibrary(vi.fn().mockResolvedValue(page([album()])));

    renderAlbumGrid({ onAlbumSelect: selected });

    const card = await screen.findByRole('button', { name: /Refrain/i });
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });

    await waitFor(() => expect(selected).toHaveBeenCalledTimes(3));
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({ id: 'album-1', title: 'Refrain' }));
  });

  it('uses original album artwork for artist album cards', async () => {
    installLibrary(vi.fn().mockResolvedValue(page([album({
      coverId: 'cover 1',
      coverThumb: 'echo-cover://album/cover%201',
    })])));

    const { container } = renderAlbumGrid();

    await screen.findByRole('button', { name: /Refrain/i });
    expect((container.querySelector('.artist-album-cover img') as HTMLImageElement | null)?.getAttribute('src')).toBe('echo-cover://original/cover%201');
  });

  it('reserves scroll height for unloaded artist albums', async () => {
    installLibrary(vi.fn().mockResolvedValue(page([album()], { total: 24, hasMore: true })));

    const { container } = renderAlbumGrid();

    await screen.findByRole('button', { name: /Refrain/i });
    await waitFor(() => expect(container.querySelector('.media-wall-scroll-spacer')).toBeTruthy());
    expect((container.querySelector('.media-wall-scroll-spacer') as HTMLElement).style.height).toBe('5244px');
  });
});
