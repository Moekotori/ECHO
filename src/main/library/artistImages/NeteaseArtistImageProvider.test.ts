import { describe, expect, it, vi } from 'vitest';
import { NeteaseArtistImageProvider } from './NeteaseArtistImageProvider';

describe('NeteaseArtistImageProvider', () => {
  it('maps NetEase artist search results to avatar candidates', async () => {
    const streamingProvider = {
      search: vi.fn().mockResolvedValue({
        artists: [
          {
            id: 'netease:artist:55240314',
            provider: 'netease',
            providerArtistId: '55240314',
            name: 'Arika',
            avatarUrl: 'https://p2.music.126.net/avatar.jpg?param=160y160',
            coverUrl: 'https://p2.music.126.net/cover.jpg',
          },
        ],
      }),
    };
    const provider = new NeteaseArtistImageProvider(streamingProvider as never);

    const candidates = await provider.searchArtistImage({ artistName: 'Arika', artistKey: 'arika' });

    expect(streamingProvider.search).toHaveBeenCalledWith({
      provider: 'netease',
      query: 'Arika',
      mediaTypes: ['artist'],
      page: 1,
      pageSize: 8,
    });
    expect(candidates[0]).toMatchObject({
      provider: 'netease',
      providerArtistId: '55240314',
      artistName: 'Arika',
      imageUrl: 'https://p2.music.126.net/cover.jpg?param=1200y1200',
      quality: 1200,
      sourceUrl: 'https://music.163.com/#/artist?id=55240314',
      confidence: 0.96,
    });
  });

  it('filters obvious default artist image URLs', async () => {
    const streamingProvider = {
      search: vi.fn().mockResolvedValue({
        artists: [
          {
            id: 'netease:artist:empty',
            provider: 'netease',
            providerArtistId: 'empty',
            name: 'Empty Artist',
            avatarUrl: 'https://p2.music.126.net/artist_default.png?param=600y600',
            coverUrl: null,
          },
        ],
      }),
    };
    const provider = new NeteaseArtistImageProvider(streamingProvider as never);

    const candidates = await provider.searchArtistImage({ artistName: 'Empty Artist', artistKey: 'empty artist' });

    expect(candidates).toEqual([]);
  });

  it('filters NetEase singer silhouette placeholder URLs', async () => {
    const streamingProvider = {
      search: vi.fn().mockResolvedValue({
        artists: [
          {
            id: 'netease:artist:177232',
            provider: 'netease',
            providerArtistId: '177232',
            name: 'Miku',
            avatarUrl: 'https://p1.music.126.net/6y-UleORITEDbvrOLV0Q8A==/5639395138885805.jpg?param=600y600',
            coverUrl: null,
          },
        ],
      }),
    };
    const provider = new NeteaseArtistImageProvider(streamingProvider as never);

    const candidates = await provider.searchArtistImage({ artistName: 'MIKU', artistKey: 'miku' });

    expect(candidates).toEqual([]);
  });
});
