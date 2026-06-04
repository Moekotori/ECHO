import { afterEach, describe, expect, it, vi } from 'vitest';
import { YouTubeStreamingProvider } from './YouTubeStreamingProvider';

const execFileMock = vi.hoisted(() => vi.fn());
let selectedBrowser: 'edge' | 'chrome' | 'firefox' | 'none' = 'none';

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('../../accounts/AccountService', () => ({
  getAccountService: () => ({
    getStatus: (provider: string) => ({
      provider,
      connected: selectedBrowser !== 'none',
      username: null,
      displayName: selectedBrowser === 'none' ? null : `System browser: ${selectedBrowser}`,
      avatarUrl: null,
      lastLoginAt: null,
      lastCheckedAt: null,
      expiresAt: null,
      error: null,
    }),
    getCredentials: (provider: string) => ({
      provider,
      browser: selectedBrowser,
    }),
  }),
}));

afterEach(() => {
  selectedBrowser = 'none';
  execFileMock.mockReset();
});

describe('YouTubeStreamingProvider', () => {
  it('advertises YouTube as audio playback with MV support and no downloads', () => {
    expect(new YouTubeStreamingProvider().descriptor).toMatchObject({
      supportsPlayback: true,
      supportsDownload: false,
      supportsLyrics: false,
      supportsMv: true,
      requiresAccount: false,
    });
  });

  it('searches YouTube and maps results to playable audio tracks with covers', async () => {
    selectedBrowser = 'edge';
    let capturedArgs: string[] = [];
    execFileMock.mockImplementation((_file: string, args: string[], _options: unknown, callback: (...args: unknown[]) => void) => {
      capturedArgs = args;
      callback(
        null,
        JSON.stringify({
          entries: [
            {
              id: 'abc123DEF45',
              title: 'Echo Song',
              channel: 'Echo Artist',
              channel_id: 'UC123',
              duration: 205,
              thumbnails: [
                { url: 'https://i.ytimg.com/vi/abc123DEF45/default.jpg', width: 120 },
                { url: 'https://i.ytimg.com/vi/abc123DEF45/hqdefault.jpg', width: 480 },
              ],
            },
          ],
        }),
        '',
      );
    });

    const result = await new YouTubeStreamingProvider().search({
      provider: 'youtube',
      query: 'echo',
      mediaTypes: ['track'],
      page: 1,
      pageSize: 10,
    });

    expect(capturedArgs).toContain('ytsearch10:echo');
    expect(capturedArgs).not.toContain('--cookies-from-browser');
    expect(result.tracks[0]).toMatchObject({
      provider: 'youtube',
      providerTrackId: 'abc123DEF45',
      stableKey: 'streaming:youtube:abc123DEF45',
      title: 'Echo Song',
      artist: 'Echo Artist',
      album: 'YouTube',
      duration: 205,
      playable: true,
      lyricsStatus: 'unknown',
      mvStatus: 'available',
      coverUrl: 'https://i.ytimg.com/vi/abc123DEF45/hqdefault.jpg',
      coverThumb: 'https://i.ytimg.com/vi/abc123DEF45/default.jpg',
    });
  });

  it('imports YouTube playlist pages with flat metadata', async () => {
    let capturedArgs: string[] = [];
    execFileMock.mockImplementation((_file: string, args: string[], _options: unknown, callback: (...args: unknown[]) => void) => {
      capturedArgs = args;
      callback(
        null,
        JSON.stringify({
          id: 'PL123',
          title: 'YouTube Favorites',
          playlist_count: 1,
          channel: 'Akkariin',
          entries: [
            {
              id: 'abc123DEF45',
              title: 'Echo Song',
              channel: 'Echo Artist',
              duration: 205,
            },
          ],
        }),
        '',
      );
    });

    const result = await new YouTubeStreamingProvider().getPlaylist({
      providerPlaylistId: 'PL123',
      page: 2,
      pageSize: 25,
    });

    expect(capturedArgs).toContain('--flat-playlist');
    expect(capturedArgs).toContain('--playlist-start');
    expect(capturedArgs).toContain('26');
    expect(capturedArgs).toContain('--playlist-end');
    expect(capturedArgs).toContain('50');
    expect(result).toMatchObject({
      provider: 'youtube',
      providerPlaylistId: 'PL123',
      title: 'YouTube Favorites',
      creator: 'Akkariin',
      total: 1,
    });
    expect(result.tracks[0]).toMatchObject({
      providerTrackId: 'abc123DEF45',
      title: 'Echo Song',
    });
  });

  it('uses YouTube video thumbnails when flat search results omit thumbnail metadata', async () => {
    execFileMock.mockImplementation((_file: string, _args: string[], _options: unknown, callback: (...args: unknown[]) => void) => {
      callback(
        null,
        JSON.stringify({
          entries: [
            {
              id: 'abc123DEF45',
              title: 'Echo Song',
              channel: 'Echo Artist',
              duration: 205,
            },
          ],
        }),
        '',
      );
    });

    const result = await new YouTubeStreamingProvider().search({
      provider: 'youtube',
      query: 'echo',
      mediaTypes: ['track'],
      page: 1,
      pageSize: 10,
    });

    expect(result.tracks[0]).toMatchObject({
      coverUrl: 'https://i.ytimg.com/vi/abc123DEF45/hqdefault.jpg',
      coverThumb: 'https://i.ytimg.com/vi/abc123DEF45/default.jpg',
    });
  });

  it('resolves only the best audio format and reuses the selected browser login when configured', async () => {
    selectedBrowser = 'edge';
    let capturedArgs: string[] = [];
    execFileMock.mockImplementation((_file: string, args: string[], _options: unknown, callback: (...args: unknown[]) => void) => {
      capturedArgs = args;
      callback(
        null,
        JSON.stringify({
          formats: [
            {
              format_id: 'video',
              vcodec: 'avc1',
              acodec: 'none',
              url: 'https://rr.youtube.com/video.mp4',
            },
            {
              format_id: 'audio-low',
              vcodec: 'none',
              acodec: 'opus',
              ext: 'webm',
              abr: 70,
              url: 'https://rr.youtube.com/audio-low.webm?expire=1779039623',
            },
            {
              format_id: 'audio-high',
              vcodec: 'none',
              acodec: 'mp4a.40.2',
              ext: 'm4a',
              abr: 128,
              asr: 44100,
              url: 'https://rr.youtube.com/audio-high.m4a?expire=1779039623',
              http_headers: {
                Referer: 'https://www.youtube.com/watch?v=abc123DEF45',
                Cookie: 'do-not-leak',
              },
            },
          ],
        }),
        '',
      );
    });

    const source = await new YouTubeStreamingProvider().resolvePlayback({
      provider: 'youtube',
      providerTrackId: 'abc123DEF45',
      quality: 'high',
    });

    expect(capturedArgs).toContain('--cookies-from-browser');
    expect(capturedArgs).toContain('edge');
    expect(capturedArgs).toContain('-f');
    expect(capturedArgs).toContain('ba/bestaudio');
    expect(capturedArgs).toContain('https://www.youtube.com/watch?v=abc123DEF45');
    expect(source.url).toContain('audio-high.m4a');
    expect(source.mimeType).toBe('audio/mp4');
    expect(source.codec).toBe('mp4a.40.2');
    expect(source.bitrate).toBe(128000);
    expect(source.sampleRate).toBe(44100);
    expect(source.requiresProxy).toBe(false);
    expect(source.headers).toMatchObject({
      'User-Agent': expect.stringContaining('Mozilla/5.0'),
      Accept: '*/*',
      Referer: 'https://www.youtube.com/watch?v=abc123DEF45',
    });
    expect(source.headers.Cookie).toBeUndefined();
  });

  it('falls back to anonymous extraction when browser cookies cannot be read', async () => {
    selectedBrowser = 'edge';
    const calls: string[][] = [];
    execFileMock.mockImplementation((_file: string, args: string[], _options: unknown, callback: (...args: unknown[]) => void) => {
      calls.push(args);
      if (calls.length === 1) {
        callback(new Error('exit 1'), '', 'ERROR: Could not copy Chrome cookie database');
        return;
      }

      callback(
        null,
        JSON.stringify({
          formats: [
            {
              format_id: 'audio',
              vcodec: 'none',
              acodec: 'mp4a.40.2',
              ext: 'm4a',
              abr: 128,
              url: 'https://rr.youtube.com/audio.m4a?expire=1779039623',
            },
          ],
        }),
        '',
      );
    });

    const source = await new YouTubeStreamingProvider().resolvePlayback({
      provider: 'youtube',
      providerTrackId: 'abc123DEF45',
      quality: 'high',
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(expect.arrayContaining(['--cookies-from-browser', 'edge']));
    expect(calls[1]).not.toContain('--cookies-from-browser');
    expect(source.url).toContain('audio.m4a');
  });
});
