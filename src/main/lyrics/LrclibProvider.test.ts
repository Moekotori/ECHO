import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithNetworkProxy } from '../network/networkFetch';
import { LrclibProvider } from './LrclibProvider';
import { buildNormalizedLyricsQuery } from './lyricsQueryBuilder';

vi.mock('../network/networkFetch', () => ({
  fetchWithNetworkProxy: vi.fn(),
}));

const fetchMock = vi.mocked(fetchWithNetworkProxy);

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('LrclibProvider', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('uses LRCLIB q search before falling back to structured search parameters', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 1,
          trackName: 'Never Gonna Give You Up',
          artistName: 'Rick Astley',
          albumName: 'Whenever You Need Somebody',
          duration: 214,
          plainLyrics: 'Line',
          syncedLyrics: '[00:01.00]Line',
        },
      ]),
    );

    const provider = new LrclibProvider();
    const candidates = await provider.searchCandidates({
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      album: null,
      durationSeconds: 214,
    });

    expect(candidates).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('/api/search?');
    expect(calledUrl).toContain('q=Never+Gonna+Give+You+Up+Rick+Astley');
    expect(calledUrl).not.toContain('track_name=');
  });

  it('falls back to structured LRCLIB search when q search is empty', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 2,
            trackName: 'Echo Song',
            artistName: 'Echo Artist',
            albumName: 'Echo Album',
            duration: 120,
            plainLyrics: 'Line',
          },
        ]),
      );

    const provider = new LrclibProvider();
    const candidates = await provider.searchCandidates({
      title: 'Echo Song',
      artist: 'Echo Artist',
      album: 'Echo Album',
      durationSeconds: 120,
    });

    expect(candidates).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('q=Echo+Song+Echo+Artist');
    expect(String(fetchMock.mock.calls[1][0])).toContain('track_name=Echo+Song');
    expect(String(fetchMock.mock.calls[1][0])).toContain('artist_name=Echo+Artist');
  });

  it('uses cached exact LRCLIB signatures before keyword search during automatic matching', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 3,
        trackName: 'Echo Song',
        artistName: 'Echo Artist',
        albumName: 'Echo Album',
        duration: 120,
        plainLyrics: 'Cached line',
        syncedLyrics: '[00:01.00]Cached line',
      }),
    );

    const provider = new LrclibProvider();
    const query = {
      title: 'Echo Song',
      artist: 'Echo Artist',
      album: 'Echo Album',
      durationSeconds: 120,
    };
    const results = await provider.search({
      query,
      normalized: buildNormalizedLyricsQuery(query),
      timeoutMs: 4500,
      collectAllCandidates: false,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      providerLyricsId: '3',
      sourceLabel: 'LRCLIB cached',
      matchReasons: ['lrclib_cached_signature'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('/api/get-cached?');
    expect(calledUrl).toContain('track_name=Echo+Song');
    expect(calledUrl).toContain('duration=120');
  });

  it('keeps collecting LRCLIB keyword candidates after an exact cached hit for manual searches', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          id: 4,
          trackName: 'Echo Song',
          artistName: 'Echo Artist',
          albumName: 'Echo Album',
          duration: 120,
          plainLyrics: 'Cached line',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 5,
            trackName: 'Echo Song Live',
            artistName: 'Echo Artist',
            albumName: 'Echo Live',
            duration: 121,
            plainLyrics: 'Live line',
          },
        ]),
      );

    const provider = new LrclibProvider();
    const query = {
      title: 'Echo Song',
      artist: 'Echo Artist',
      album: 'Echo Album',
      durationSeconds: 120,
    };
    const results = await provider.search({
      query,
      normalized: buildNormalizedLyricsQuery(query),
      timeoutMs: 4500,
      collectAllCandidates: true,
    });

    expect(results.map((result) => result.providerLyricsId)).toEqual(['4', '5']);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/get-cached?');
    expect(String(fetchMock.mock.calls[1][0])).toContain('q=Echo+Song+Echo+Artist');
  });

  it('stops after the first keyword hit during automatic matching', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"code":404}', { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 8,
            trackName: 'Echo Song',
            artistName: 'Echo Artist',
            albumName: 'Echo Album',
            duration: 120,
            syncedLyrics: '[00:01.00]Fast line',
          },
        ]),
      );

    const provider = new LrclibProvider();
    const query = {
      title: 'Echo Song (Acoustic)',
      artist: 'Echo Artist',
      album: 'Echo Album',
      durationSeconds: 120,
    };
    const normalized = buildNormalizedLyricsQuery(query);
    const results = await provider.search({
      query,
      normalized,
      timeoutMs: 4500,
      collectAllCandidates: false,
    });

    expect(results.map((result) => result.providerLyricsId)).toEqual(['8']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(normalized.searchVariants.length).toBeGreaterThan(1);
  });

  it('loads exact lyrics from LRCLIB cache before using the slower live get endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 6,
        trackName: 'Echo Song',
        artistName: 'Echo Artist',
        albumName: 'Echo Album',
        duration: 120,
        syncedLyrics: '[00:01.00]Cached line',
      }),
    );

    const provider = new LrclibProvider();
    const lyrics = await provider.getLyrics({
      title: 'Echo Song',
      artist: 'Echo Artist',
      album: 'Echo Album',
      durationSeconds: 120,
    });

    expect(lyrics?.providerLyricsId).toBe('6');
    expect(lyrics?.kind).toBe('synced');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/get-cached?');
  });

  it('falls back to LRCLIB live get when the cached exact endpoint misses', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"code":404}', { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 7,
          trackName: 'Echo Song',
          artistName: 'Echo Artist',
          albumName: 'Echo Album',
          duration: 120,
          plainLyrics: 'Live line',
        }),
      );

    const provider = new LrclibProvider();
    const lyrics = await provider.getLyrics({
      title: 'Echo Song',
      artist: 'Echo Artist',
      album: 'Echo Album',
      durationSeconds: 120,
    });

    expect(lyrics?.providerLyricsId).toBe('7');
    expect(lyrics?.kind).toBe('plain');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/get-cached?');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/get?');
  });
});
