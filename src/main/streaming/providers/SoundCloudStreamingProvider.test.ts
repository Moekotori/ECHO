import { afterEach, describe, expect, it, vi } from 'vitest';
import { SoundCloudStreamingProvider } from './SoundCloudStreamingProvider';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('../../accounts/AccountService', () => ({
  getAccountService: () => ({
    getStatus: (provider: string) => ({
      provider,
      connected: true,
      username: 'soundcloud-user',
      displayName: 'SoundCloud User',
      avatarUrl: null,
      lastLoginAt: '2026-01-01T00:00:00.000Z',
      lastCheckedAt: null,
      expiresAt: null,
      error: null,
    }),
    getCredentials: (provider: string) => ({
      provider,
      cookie: 'sc_anonymous_id=test; oauth_token=secret',
    }),
  }),
}));

afterEach(() => {
  execFileMock.mockReset();
});

describe('SoundCloudStreamingProvider', () => {
  it('advertises download support for SoundCloud tracks', async () => {
    expect(new SoundCloudStreamingProvider().descriptor).toMatchObject({
      supportsDownload: true,
    });
  });

  it('prefers direct MP3 playback over HLS and keeps required playback headers', async () => {
    let capturedArgs: string[] = [];
    execFileMock.mockImplementation((_file: string, args: string[], _options: unknown, callback: (...args: unknown[]) => void) => {
      capturedArgs = args;
      callback(
        null,
        JSON.stringify({
          requested_downloads: [
            {
              format_id: 'hls_aac_96k',
              protocol: 'm3u8_native',
              ext: 'm4a',
              acodec: 'mp4a.40.2',
              url: 'https://playback.media-streaming.soundcloud.cloud/audio/playlist.m3u8?expires=1779039623',
              http_headers: {
                'User-Agent': 'yt-dlp UA',
                Cookie: 'should-not-leak',
              },
            },
          ],
          formats: [
            {
              format_id: 'hls_mp3_0_1',
              protocol: 'm3u8_native',
              ext: 'mp3',
              acodec: 'mp3',
              url: 'https://cf-hls-media.sndcdn.com/audio/playlist.m3u8',
            },
            {
              format_id: 'http_mp3_0_1',
              protocol: 'http',
              ext: 'mp3',
              acodec: 'mp3',
              abr: 128,
              url: 'https://cf-media.sndcdn.com/audio.128.mp3?Policy=test&expires=1779039623',
            },
          ],
        }),
        '',
      );
    });

    const source = await new SoundCloudStreamingProvider().resolvePlayback({
      provider: 'soundcloud',
      providerTrackId: 'https://api.soundcloud.com/tracks/soundcloud%3Atracks%3A1017245335',
      quality: 'standard',
    });

    expect(capturedArgs).toContain('http_mp3_0_1/http_mp3_1_0/http_mp3_0_0/bestaudio/best');
    expect(source.url).toContain('cf-media.sndcdn.com/audio.128.mp3');
    expect(source.mimeType).toBe('audio/mpeg');
    expect(source.codec).toBe('mp3');
    expect(source.supportsRange).toBe(true);
    expect(source.bitrate).toBe(128000);
    expect(source.headers).toMatchObject({
      'User-Agent': expect.stringContaining('Mozilla/5.0'),
      Accept: '*/*',
      Referer: 'https://soundcloud.com/',
    });
    expect(source.headers.Cookie).toBeUndefined();
  });
});
