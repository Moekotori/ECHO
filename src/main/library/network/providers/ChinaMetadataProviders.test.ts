import { afterEach, describe, expect, it, vi } from 'vitest';
import { NeteaseCloudMusicProvider } from './NeteaseCloudMusicProvider';
import { QQMusicProvider } from './QQMusicProvider';
import type { NetworkTrackLookup } from '../networkTypes';

const track: NetworkTrackLookup = {
  trackId: 'track-1',
  title: '测试歌曲',
  artist: '测试歌手',
  album: '',
  albumArtist: '',
  duration: 180,
  trackNo: null,
  year: null,
  filename: '测试歌曲.wav',
  folder: 'Music',
  fieldSources: { title: 'filename_fallback', artist: 'unknown' },
  embeddedMetadataStatus: 'missing',
  embeddedCoverStatus: 'missing',
};

const mockJsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('China-friendly network metadata providers', () => {
  it('maps NetEase Cloud Music search results to metadata candidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockJsonResponse({
          result: {
            songs: [
              {
                id: 123,
                name: '测试歌曲',
                duration: 181000,
                artists: [{ name: '测试歌手' }],
                album: { name: '测试专辑', picUrl: 'https://p.music.126.net/cover.jpg' },
              },
            ],
          },
        }),
      ),
    );

    const candidates = await new NeteaseCloudMusicProvider().findMetadata(track);

    expect(candidates[0]).toMatchObject({
      provider: 'netease-cloud-music',
      providerItemId: 'netease:123',
      title: '测试歌曲',
      artist: '测试歌手',
      album: '测试专辑',
      duration: 181,
      coverUrl: 'https://p.music.126.net/cover.jpg?param=300y300',
    });
  });

  it('loads NetEase cover URLs from song detail when search only returns album picId', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          mockJsonResponse({
            result: {
              songs: [
                {
                  id: 123,
                  name: '娴嬭瘯姝屾洸',
                  duration: 181000,
                  artists: [{ name: '娴嬭瘯姝屾墜' }],
                  album: { name: '娴嬭瘯涓撹緫', picId: 109951168969997920 },
                },
              ],
            },
          }),
        )
        .mockResolvedValueOnce(
          mockJsonResponse({
            songs: [
              {
                id: 123,
                album: { picUrl: 'https://p.music.126.net/detail-cover.jpg' },
              },
            ],
          }),
        ),
    );

    const candidates = await new NeteaseCloudMusicProvider().findMetadata(track);

    expect(candidates[0].coverUrl).toBe('https://p.music.126.net/detail-cover.jpg?param=300y300');
  });

  it('maps QQ Music search results to metadata candidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockJsonResponse({
          data: {
            song: {
              list: [
                {
                  mid: 'song-mid',
                  name: '测试歌曲',
                  interval: 180,
                  singer: [{ name: '测试歌手' }],
                  album: { name: '测试专辑', mid: 'album-mid' },
                },
              ],
            },
          },
        }),
      ),
    );

    const candidates = await new QQMusicProvider().findMetadata(track);

    expect(candidates[0]).toMatchObject({
      provider: 'qq-music',
      providerItemId: 'qq:song-mid',
      title: '测试歌曲',
      artist: '测试歌手',
      album: '测试专辑',
      duration: 180,
      coverUrl: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000album-mid.jpg',
    });
  });
});
