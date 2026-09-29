import { describe, expect, it, vi } from 'vitest';
import { fetchOsuAccountCollection, fetchOsuAccountProfile } from './OsuAccountLibraryService';

const profileHtml = (overrides: Record<string, unknown> = {}): string => `
  <html>
    <body>
      <script id="json-current-user" type="application/json">
        ${JSON.stringify({
          id: 12345,
          username: 'EchoPlayer',
          avatar_url: 'https://a.ppy.sh/12345',
          country_code: 'CN',
          is_online: true,
          is_supporter: true,
          playmode: 'mania',
          statistics_rulesets: {
            mania: {
              global_rank: 8246,
              country_rank: 312,
              pp: 9842.4,
              hit_accuracy: 98.67,
              level: { current: 101, progress: 18 },
              play_count: 42918,
              maximum_combo: 3214,
              play_time: 3153600,
            },
          },
          scores_best_count: 100,
          favourite_beatmapset_count: 101,
          beatmap_playcounts_count: 2048,
          ...overrides,
        })}
      </script>
    </body>
  </html>
`;

const detailedProfileHtml = (overrides: Record<string, unknown> = {}): string => `
  <html>
    <body>
      <script id="json-user" type="application/json">
        ${JSON.stringify({
          id: 12345,
          username: 'EchoPlayer',
          avatar_url: 'https://a.ppy.sh/12345',
          country_code: 'CN',
          is_online: false,
          is_supporter: true,
          playmode: 'mania',
          statistics: {
            global_rank: 8246,
            country_rank: 312,
            pp: 9842.4,
            hit_accuracy: 98.67,
            level: { current: 101, progress: 18 },
            play_count: 42918,
            maximum_combo: 3214,
            play_time: 3153600,
          },
          ...overrides,
        })}
      </script>
    </body>
  </html>
`;

const beatmapset = (id: number) => ({
  id,
  artist: `Artist ${id}`,
  title: `Song ${id}`,
  creator: `Mapper ${id}`,
  covers: {
    'card@2x': `https://assets.ppy.sh/beatmaps/${id}/covers/card@2x.jpg`,
  },
  beatmaps: [{ total_length: 180 }],
});

describe('OsuAccountLibraryService', () => {
  it('reads the signed-in profile without exposing the cookie', async () => {
    const fetcher = vi.fn(async () => new Response(profileHtml(), { status: 200 }));

    await expect(fetchOsuAccountProfile('osu_session=secret', fetcher)).resolves.toEqual({
      userId: 12345,
      username: 'EchoPlayer',
      avatarUrl: 'https://a.ppy.sh/12345',
      countryCode: 'CN',
      isOnline: true,
      isSupporter: true,
      defaultRuleset: 'mania',
      globalRank: 8246,
      countryRank: 312,
      performancePoints: 9842.4,
      hitAccuracy: 98.67,
      level: 101,
      playCount: 42918,
      maximumCombo: 3214,
      playTimeSeconds: 3153600,
      bestScoreCount: 100,
      favouriteBeatmapsetCount: 101,
      mostPlayedBeatmapCount: 2048,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://osu.ppy.sh/',
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: 'osu_session=secret' }),
      }),
    );
  });

  it('loads the requested BP range and maps score metadata', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === 'https://osu.ppy.sh/') {
        return new Response(profileHtml(), { status: 200 });
      }
      return Response.json([
        {
          id: 999,
          pp: 321.45,
          accuracy: 0.9876,
          rank: 'S',
          mods: [{ acronym: 'HD' }, { acronym: 'DT' }],
          beatmapset: beatmapset(2468),
          beatmap: {
            id: 8642,
            total_length: 201,
            version: 'Insane',
            difficulty_rating: 6.25,
          },
        },
      ]);
    });

    const result = await fetchOsuAccountCollection(
      'osu_session=secret',
      { kind: 'best', ruleset: 'osu', start: 21, end: 40 },
      fetcher,
    );

    expect(fetcher.mock.calls[1]?.[0].toString()).toBe(
      'https://osu.ppy.sh/users/12345/scores/best?mode=osu&limit=20&offset=20',
    );
    expect(result.items[0]).toEqual(expect.objectContaining({
      key: 'best:999:21',
      beatmapsetId: '2468',
      beatmapId: '8642',
      title: 'Song 2468',
      artist: 'Artist 2468',
      position: 21,
      pp: 321.45,
      accuracy: 0.9876,
      mods: ['HD', 'DT'],
      difficultyName: 'Insane',
      starRating: 6.25,
    }));
  });

  it('derives the BP count after loading the complete top-100 window', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString() === 'https://osu.ppy.sh/') {
        return new Response(profileHtml({
          scores_best_count: undefined,
          favourite_beatmapset_count: undefined,
        }), { status: 200 });
      }
      return Response.json([
        {
          id: 999,
          beatmapset: beatmapset(2468),
          beatmap: { id: 8642 },
        },
      ]);
    });

    const result = await fetchOsuAccountCollection(
      'osu_session=secret',
      { kind: 'best', ruleset: 'mania', start: 1, end: 100 },
      fetcher,
    );

    expect(result.profile.bestScoreCount).toBe(1);
    expect(result.total).toBe(1);
  });

  it('paginates until every favourite beatmapset is loaded', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => beatmapset(index + 1));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === 'https://osu.ppy.sh/') {
        return new Response(profileHtml(), { status: 200 });
      }
      return Response.json(url.includes('offset=100') ? [beatmapset(101)] : firstPage);
    });

    const result = await fetchOsuAccountCollection('osu_session=secret', { kind: 'favourites' }, fetcher);

    expect(result.items).toHaveLength(101);
    expect(result.profile.favouriteBeatmapsetCount).toBe(101);
    expect(result.total).toBe(101);
    expect(result.items[100]).toEqual(expect.objectContaining({
      beatmapsetId: '101',
      position: 101,
    }));
    expect(fetcher.mock.calls.map(([input]) => input.toString())).toEqual([
      'https://osu.ppy.sh/',
      'https://osu.ppy.sh/users/12345/beatmapsets/favourite?limit=100&offset=0',
      'https://osu.ppy.sh/users/12345/beatmapsets/favourite?limit=100&offset=100',
    ]);
  });

  it('loads the signed-in user page when the homepage only contains lightweight identity data', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      input.toString() === 'https://osu.ppy.sh/'
        ? new Response(profileHtml({ statistics_rulesets: undefined }), { status: 200 })
        : new Response(detailedProfileHtml(), { status: 200 }),
    );

    const profile = await fetchOsuAccountProfile('osu_session=secret', fetcher);

    expect(fetcher.mock.calls.map(([input]) => input.toString())).toEqual([
      'https://osu.ppy.sh/',
      'https://osu.ppy.sh/users/12345/mania',
    ]);
    expect(profile).toEqual(expect.objectContaining({
      userId: 12345,
      globalRank: 8246,
      performancePoints: 9842.4,
      playCount: 42918,
      playTimeSeconds: 3153600,
      favouriteBeatmapsetCount: 101,
      mostPlayedBeatmapCount: 2048,
    }));
  });

  it('keeps the lightweight profile when the detailed user page is unavailable', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      input.toString() === 'https://osu.ppy.sh/'
        ? new Response(profileHtml({ statistics_rulesets: undefined }), { status: 200 })
        : new Response('unavailable', { status: 503 }),
    );

    await expect(fetchOsuAccountProfile('osu_session=secret', fetcher)).resolves.toEqual(
      expect.objectContaining({
        userId: 12345,
        username: 'EchoPlayer',
        globalRank: null,
        playCount: null,
      }),
    );
  });

  it('loads the most-played beatmaps and preserves each difficulty play count', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString() === 'https://osu.ppy.sh/') {
        return new Response(profileHtml(), { status: 200 });
      }
      return Response.json([{
        beatmap_id: 3142619,
        count: 68,
        beatmap: {
          id: 3142619,
          beatmapset_id: 1535462,
          mode: 'mania',
          total_length: 134,
          version: '[4K] A B A B B A B',
          difficulty_rating: 4.36795,
        },
        beatmapset: beatmapset(1535462),
      }]);
    });

    const result = await fetchOsuAccountCollection('osu_session=secret', { kind: 'most_played' }, fetcher);

    expect(fetcher.mock.calls[1]?.[0].toString()).toBe(
      'https://osu.ppy.sh/users/12345/beatmapsets/most_played?limit=100&offset=0',
    );
    expect(result.total).toBe(2048);
    expect(result.items[0]).toEqual(expect.objectContaining({
      key: 'most_played:3142619',
      beatmapsetId: '1535462',
      beatmapId: '3142619',
      position: 1,
      playCount: 68,
      difficultyName: '[4K] A B A B B A B',
      webpageUrl: 'https://osu.ppy.sh/beatmapsets/1535462#mania/3142619',
    }));
  });

  it('loads a later most-played page with continuous positions', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString() === 'https://osu.ppy.sh/') {
        return new Response(profileHtml(), { status: 200 });
      }
      return Response.json([{
        beatmap_id: 3142619,
        count: 42,
        beatmap: {
          id: 3142619,
          beatmapset_id: 1535462,
          mode: 'mania',
        },
        beatmapset: beatmapset(1535462),
      }]);
    });

    const result = await fetchOsuAccountCollection(
      'osu_session=secret',
      { kind: 'most_played', offset: 100, limit: 50 },
      fetcher,
    );

    expect(fetcher.mock.calls[1]?.[0].toString()).toBe(
      'https://osu.ppy.sh/users/12345/beatmapsets/most_played?limit=50&offset=100',
    );
    expect(result.items[0]?.position).toBe(101);
  });

  it('rejects an expired login session', async () => {
    const fetcher = vi.fn(async () => new Response(profileHtml({ id: null, username: null }), { status: 200 }));
    await expect(fetchOsuAccountProfile('osu_session=expired', fetcher)).rejects.toThrow('osu_account_login_expired');
  });
});
