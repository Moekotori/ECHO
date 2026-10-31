import { afterEach, describe, expect, it, vi } from 'vitest';
import { KugouArtistImageProvider } from './KugouArtistImageProvider';

describe('KugouArtistImageProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps Kugou singer search results and author avatars to candidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: 1,
              data: [
                {
                  singername: 'Abyssmare',
                  singerid: 10502372,
                },
              ],
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: 1,
              data: [
                {
                  base: {
                    author_id: 10502372,
                    author_name: 'Abyssmare',
                    avatar: 'http://singerimg.kugou.com/uploadpic/softhead/{size}/20230311/20230311132814697531.png',
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        ),
    );
    const provider = new KugouArtistImageProvider();

    const candidates = await provider.searchArtistImage({ artistName: 'Abyssmare', artistKey: 'abyssmare' });

    expect(fetch).toHaveBeenNthCalledWith(1, expect.stringContaining('mobilecdn.kugou.com/api/v3/search/singer'), expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(2, expect.stringContaining('openapicdnretry.kugou.com/kmr/v1/author/extend'), expect.any(Object));
    expect(candidates[0]).toMatchObject({
      provider: 'kugou',
      providerArtistId: '10502372',
      artistName: 'Abyssmare',
      imageUrl: 'https://singerimg.kugou.com/uploadpic/softhead/1000/20230311/20230311132814697531.png',
      confidence: 0.96,
      quality: 1000,
      sourceUrl: 'https://www.kugou.com/singer/10502372.html',
    });
  });

  it('uses portrait image fallbacks and skips low confidence search results before detail lookup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: 1,
              data: [
                {
                  singername: 'Aimer tribute',
                  singerid: 1,
                },
                {
                  singername: 'Aimer',
                  singerid: 11301,
                },
              ],
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: 1,
              data: [
                {
                  base: {
                    avatar: '',
                  },
                  imgs: [
                    {
                      file: 'http://imge.kugou.com/v2/mobile_portrait/1890cfb648e480a9997c37cbbcae8dcd.jpg',
                    },
                  ],
                },
              ],
            }),
            { status: 200 },
          ),
        ),
    );
    const provider = new KugouArtistImageProvider();

    const candidates = await provider.searchArtistImage({ artistName: 'Aimer', artistKey: 'aimer' });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      providerArtistId: '11301',
      artistName: 'Aimer',
      imageUrl: 'https://imge.kugou.com/v2/mobile_portrait/1890cfb648e480a9997c37cbbcae8dcd.jpg',
      quality: 700,
    });
  });

  it('returns no candidates for obvious placeholder image URLs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: 1,
              data: [{ singername: 'Empty Artist', singerid: 9 }],
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: 1,
              data: [
                {
                  base: {
                    avatar: 'http://singerimg.kugou.com/uploadpic/softhead/{size}/default.jpg',
                  },
                  imgs: [
                    {
                      file: 'http://imge.kugou.com/v2/mobile_portrait/placeholder.jpg',
                    },
                  ],
                },
              ],
            }),
            { status: 200 },
          ),
        ),
    );
    const provider = new KugouArtistImageProvider();

    const candidates = await provider.searchArtistImage({ artistName: 'Empty Artist', artistKey: 'empty artist' });

    expect(candidates).toEqual([]);
  });
});
