import { describe, expect, it, vi } from 'vitest';
import { SpotifyStreamingProvider } from './SpotifyStreamingProvider';
import { fetchWithNetworkProxy } from '../../network/networkFetch';

vi.mock('../../accounts/AccountService', () => ({
  getAccountService: () => ({
    getStatus: () => ({
      connected: true,
      displayName: 'Spotify User',
      username: 'spotify-user',
      avatarUrl: null,
      error: null,
    }),
  }),
}));

vi.mock('../../accounts/SpotifyAuthService', () => ({
  getSpotifyAuthService: () => ({
    getAccessToken: vi.fn(async () => 'spotify-access-token'),
  }),
}));

vi.mock('../../app/appSettings', () => ({
  getAppSettings: () => ({
    lyricsNetworkEnabled: false,
    lyricsEnabledProviders: [],
  }),
}));

vi.mock('../../network/networkFetch', () => ({
  fetchWithNetworkProxy: vi.fn(),
}));

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('SpotifyStreamingProvider playlists', () => {
  it('imports playlist tracks through the current Spotify items endpoint', async () => {
    const fetchMock = vi.mocked(fetchWithNetworkProxy);
    fetchMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.endsWith('/playlists/playlist-1')) {
        return jsonResponse({
          id: 'playlist-1',
          name: 'Spotify Playlist',
          owner: { display_name: 'Spotify User' },
          images: [],
          items: { total: 1 },
        });
      }

      if (target.endsWith('/playlists/playlist-1/items?limit=50&offset=0')) {
        return jsonResponse({
          total: 1,
          items: [
            {
              item: {
                id: 'track-1',
                name: 'Spotify Song',
                artists: [{ id: 'artist-1', name: 'Spotify Artist' }],
                album: {
                  id: 'album-1',
                  name: 'Spotify Album',
                  artists: [{ id: 'artist-1', name: 'Spotify Artist' }],
                  images: [],
                },
                duration_ms: 123000,
                explicit: false,
                is_playable: true,
              },
            },
          ],
        });
      }

      return jsonResponse({ error: { message: 'unexpected URL' } }, 404);
    });

    const playlist = await new SpotifyStreamingProvider().getPlaylist({ providerPlaylistId: 'playlist-1', page: 1, pageSize: 50 });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.spotify.com/v1/playlists/playlist-1/items?limit=50&offset=0',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(playlist.trackCount).toBe(1);
    expect(playlist.total).toBe(1);
    expect(playlist.tracks[0]).toMatchObject({
      providerTrackId: 'track-1',
      title: 'Spotify Song',
      artist: 'Spotify Artist',
      album: 'Spotify Album',
    });
  });
});
