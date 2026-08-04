import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpotifyArtistImageProvider } from './SpotifyArtistImageProvider';

const getStatus = vi.fn();

vi.mock('../../accounts/AccountService', () => ({
  getAccountService: () => ({
    getStatus,
  }),
}));

describe('SpotifyArtistImageProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('stays silent when Spotify is not connected', async () => {
    getStatus.mockReturnValue({ connected: false });
    const streamingProvider = {
      search: vi.fn(),
    };
    const provider = new SpotifyArtistImageProvider(streamingProvider as never);

    const candidates = await provider.searchArtistImage({ artistName: 'Aimer', artistKey: 'aimer' });

    expect(candidates).toEqual([]);
    expect(streamingProvider.search).not.toHaveBeenCalled();
  });

  it('maps connected Spotify artist images to fallback candidates', async () => {
    getStatus.mockReturnValue({ connected: true });
    const streamingProvider = {
      search: vi.fn().mockResolvedValue({
        artists: [
          {
            id: 'spotify:artist:remote-aimer',
            providerArtistId: 'remote-aimer',
            name: 'Aimer',
            avatarUrl: 'https://i.scdn.co/image/thumb.jpg',
            coverUrl: 'https://i.scdn.co/image/large.jpg',
          },
        ],
      }),
    };
    const provider = new SpotifyArtistImageProvider(streamingProvider as never);

    const candidates = await provider.searchArtistImage({ artistName: 'Aimer', artistKey: 'aimer' });

    expect(streamingProvider.search).toHaveBeenCalledWith({
      provider: 'spotify',
      query: 'Aimer',
      mediaTypes: ['artist'],
      page: 1,
      pageSize: 8,
    });
    expect(candidates[0]).toMatchObject({
      provider: 'spotify',
      providerArtistId: 'remote-aimer',
      artistName: 'Aimer',
      imageUrl: 'https://i.scdn.co/image/large.jpg',
      confidence: 0.96,
      sourceUrl: 'https://open.spotify.com/artist/remote-aimer',
    });
  });
});
