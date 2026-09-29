import { afterEach, describe, expect, it, vi } from 'vitest';
import { QQMusicArtistImageProvider } from './QQMusicArtistImageProvider';

describe('QQMusicArtistImageProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to the legacy artist search endpoint when desktop search returns no artists', async () => {
    const streamingProvider = {
      search: vi.fn().mockResolvedValue({
        artists: [],
      }),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              singer: {
                list: [
                  {
                    singerName: '小问Arika',
                    singerMID: 'remote-other',
                    singerPic: 'http://y.gtimg.cn/music/photo_new/T001R150x150M000other.jpg',
                  },
                  {
                    singerName: 'Arika',
                    singerMID: 'remote-arika',
                    singerPic: 'http://y.gtimg.cn/music/photo_new/T001R150x150M000arika.jpg',
                  },
                ],
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = new QQMusicArtistImageProvider(streamingProvider as never);

    const candidates = await provider.searchArtistImage({ artistName: 'Arika', artistKey: 'arika' });

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('client_search_cp'), expect.any(Object));
    expect(candidates[0]).toMatchObject({
      provider: 'qqmusic',
      providerArtistId: 'remote-arika',
      artistName: 'Arika',
      imageUrl: 'https://y.gtimg.cn/music/photo_new/T001R800x800M000arika.jpg',
      quality: 800,
      confidence: 0.96,
    });
  });

  it('filters obvious default artist image URLs', async () => {
    const streamingProvider = {
      search: vi.fn().mockResolvedValue({
        artists: [
          {
            id: 'qqmusic:artist:empty',
            provider: 'qqmusic',
            providerArtistId: 'empty',
            name: 'Empty Artist',
            avatarUrl: 'https://y.gtimg.cn/music/photo_new/singer_default.png',
            coverUrl: null,
          },
        ],
      }),
    };
    const provider = new QQMusicArtistImageProvider(streamingProvider as never);

    const candidates = await provider.searchArtistImage({ artistName: 'Empty Artist', artistKey: 'empty artist' });

    expect(candidates).toEqual([]);
  });

  it('filters QQ Music numbered placeholder artist image URLs', async () => {
    const streamingProvider = {
      search: vi.fn().mockResolvedValue({
        artists: [
          {
            id: 'qqmusic:artist:abyssmare',
            provider: 'qqmusic',
            providerArtistId: '002gpmEG2XGULI',
            name: 'Abyssmare',
            avatarUrl: 'https://y.gtimg.cn/music/photo_new/T001R150x150M000002knSQ01Ts1vS_0.jpg',
            coverUrl: null,
          },
        ],
      }),
    };
    const provider = new QQMusicArtistImageProvider(streamingProvider as never);

    const candidates = await provider.searchArtistImage({ artistName: 'Abyssmare', artistKey: 'abyssmare' });

    expect(candidates).toEqual([]);
  });
});
