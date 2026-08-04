import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeezerArtistImageProvider } from './DeezerArtistImageProvider';
import { DoubanArtistImageProvider } from './DoubanArtistImageProvider';
import { LastFmArtistImageProvider } from './LastFmArtistImageProvider';
import { MiguArtistImageProvider } from './MiguArtistImageProvider';
import { MusicBrainzFanartArtistImageProvider } from './MusicBrainzFanartArtistImageProvider';
import { QianqianArtistImageProvider } from './QianqianArtistImageProvider';

describe('additional artist image providers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('maps Migu singer search and resource images to candidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({
          code: '000000',
          singerResultData: {
            result: [{ id: '1000915580', name: 'Aimer' }],
          },
        }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          code: '000000',
          resource: [{
            singerId: '1000915580',
            singer: 'Aimer',
            imgs: [
              { imgSizeType: '01', img: 'https://d.musicapp.migu.cn/aimer-small.webp' },
              { imgSizeType: '03', img: 'https://d.musicapp.migu.cn/aimer-large.webp' },
            ],
          }],
        }), { status: 200 })),
    );

    const candidates = await new MiguArtistImageProvider().searchArtistImage({ artistName: 'Aimer', artistKey: 'aimer' });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(candidates[0]).toMatchObject({
      provider: 'migu',
      providerArtistId: '1000915580',
      artistName: 'Aimer',
      imageUrl: 'https://d.musicapp.migu.cn/aimer-large.webp',
      quality: 1000,
      confidence: 0.96,
    });
  });

  it('maps Qianqian artist search images to candidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({
        state: true,
        errno: 22000,
        data: {
          typeArtist: [{
            name: '周杰伦',
            artistCode: 'A10047663',
            pic: 'https://img01.dmhmusic.com/0206/M00/70/D2/jay.jpg',
            pictorialList: ['/0206/M00/70/D2/jay-alt.jpg'],
          }],
        },
      }), { status: 200 })),
    );

    const candidates = await new QianqianArtistImageProvider().searchArtistImage({ artistName: '周杰伦', artistKey: '周杰伦' });

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('music.91q.com/v1/search'), expect.objectContaining({
      headers: expect.objectContaining({
        from: 'web',
      }),
    }));
    expect(candidates[0]).toMatchObject({
      provider: 'qianqian',
      providerArtistId: 'A10047663',
      artistName: '周杰伦',
      imageUrl: 'https://img01.dmhmusic.com/0206/M00/70/D2/jay.jpg',
      confidence: 0.96,
    });
  });

  it('maps Douban celebrity suggestions to candidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify([{
        img: 'https://img9.doubanio.com/view/celebrity/m/public/p18606.jpg',
        title: '周杰伦',
        url: 'https://movie.douban.com/celebrity/1048000/?suggest=周杰伦',
        sub_title: 'Jay Chou',
        type: 'celebrity',
        id: '1048000',
      }]), { status: 200 })),
    );

    const candidates = await new DoubanArtistImageProvider().searchArtistImage({ artistName: '周杰伦', artistKey: '周杰伦' });

    expect(candidates[0]).toMatchObject({
      provider: 'douban',
      providerArtistId: '1048000',
      artistName: '周杰伦',
      imageUrl: 'https://img9.doubanio.com/view/celebrity/l/public/p18606.jpg',
      quality: 800,
      confidence: 0.96,
    });
  });

  it('maps Deezer artist pictures to candidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({
        data: [{
          id: 8623006,
          name: 'Aimer',
          link: 'https://www.deezer.com/artist/8623006',
          picture_xl: 'https://cdn-images.dzcdn.net/images/artist/hash/1000x1000-000000-80-0-0.jpg',
          picture_big: 'https://cdn-images.dzcdn.net/images/artist/hash/500x500-000000-80-0-0.jpg',
        }],
      }), { status: 200 })),
    );

    const candidates = await new DeezerArtistImageProvider().searchArtistImage({ artistName: 'Aimer', artistKey: 'aimer' });

    expect(candidates[0]).toMatchObject({
      provider: 'deezer',
      providerArtistId: '8623006',
      artistName: 'Aimer',
      imageUrl: 'https://cdn-images.dzcdn.net/images/artist/hash/1000x1000-000000-80-0-0.jpg',
      quality: 1000,
      confidence: 0.96,
    });
  });

  it('filters Last.fm default placeholders and keeps real artist images', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({
        artist: {
          name: 'Aimer',
          mbid: '9388cee2-7d57-4598-905f-106019b267d3',
          url: 'https://www.last.fm/music/Aimer',
          image: [
            { '#text': 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png', size: 'mega' },
            { '#text': 'https://lastfm.freetls.fastly.net/i/u/300x300/aimer-real.png', size: 'mega' },
          ],
        },
      }), { status: 200 })),
    );

    const candidates = await new LastFmArtistImageProvider().searchArtistImage({ artistName: 'Aimer', artistKey: 'aimer' });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      provider: 'lastfm',
      providerArtistId: '9388cee2-7d57-4598-905f-106019b267d3',
      imageUrl: 'https://lastfm.freetls.fastly.net/i/u/300x300/aimer-real.png',
    });
  });

  it('maps MusicBrainz artist IDs through fanart.tv when an API key is configured', async () => {
    vi.stubEnv('ECHO_FANARTTV_API_KEY', 'fanart-key');
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({
          artists: [{
            id: '9388cee2-7d57-4598-905f-106019b267d3',
            name: 'Aimer',
            score: 100,
          }],
        }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          artistthumb: [{
            url: 'https://assets.fanart.tv/fanart/music/9388cee2/aimer-thumb.jpg',
            likes: '4',
          }],
        }), { status: 200 })),
    );

    const candidates = await new MusicBrainzFanartArtistImageProvider().searchArtistImage({ artistName: 'Aimer', artistKey: 'aimer' });

    expect(fetch).toHaveBeenNthCalledWith(1, expect.stringContaining('musicbrainz.org/ws/2/artist'), expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(2, expect.stringContaining('webservice.fanart.tv/v3/music/9388cee2-7d57-4598-905f-106019b267d3'), expect.any(Object));
    expect(candidates[0]).toMatchObject({
      provider: 'musicbrainz_fanarttv',
      providerArtistId: '9388cee2-7d57-4598-905f-106019b267d3',
      artistName: 'Aimer',
      imageUrl: 'https://assets.fanart.tv/fanart/music/9388cee2/aimer-thumb.jpg',
      quality: 1004,
    });
  });

  it('skips fanart.tv lookups when no API key is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const candidates = await new MusicBrainzFanartArtistImageProvider().searchArtistImage({ artistName: 'Aimer', artistKey: 'aimer' });

    expect(candidates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
