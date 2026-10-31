import { describe, expect, it, vi } from 'vitest';
import { ArtistEventsService } from './ArtistEventsService';
import { createDatabase } from '../../database/createDatabase';

describe('ArtistEventsService', () => {
  it('does not fetch Bandsintown events without an app_id', async () => {
    const fetcher = vi.fn();

    const result = await new ArtistEventsService(fetcher).getBandsintownEvents({
      artistName: 'Echo Unit',
      appId: null,
      region: 'HK',
    });

    expect(result.status).toBe('not_configured');
    expect(result.events).toEqual([]);
    expect(result.region).toBe('HK');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps Bandsintown event payloads into the shared concert event shape', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 'evt-2',
          title: 'Echo Unit Live',
          datetime: '2026-06-02T20:00:00',
          url: 'https://bandsintown.example/events/evt-2',
          venue: {
            name: 'Second Hall',
            city: 'Tokyo',
            region: 'Tokyo',
            country: 'Japan',
          },
        },
        {
          id: 'evt-1',
          datetime: '2026-06-01T20:00:00',
          venue: {
            name: 'Echo Arena',
            city: 'Hong Kong',
            region: 'HK',
            country: 'Hong Kong',
          },
        },
      ],
    });

    const result = await new ArtistEventsService(fetcher).getBandsintownEvents({
      artistName: 'Echo Unit',
      appId: 'echo-next',
      now: new Date('2026-05-20T00:00:00.000Z'),
    });

    expect(result.status).toBe('ready');
    expect(result.sources).toEqual(['bandsintown']);
    expect(result.fetchedAt).toBe('2026-05-20T00:00:00.000Z');
    expect(result.events).toEqual([
      {
        id: 'bandsintown:evt-1',
        source: 'bandsintown',
        sourceLabel: 'Bandsintown',
        title: 'Echo Arena - Hong Kong',
        startsAt: '2026-06-01T20:00:00',
        timezone: null,
        timeTbd: false,
        venueName: 'Echo Arena',
        city: 'Hong Kong',
        region: 'HK',
        country: 'Hong Kong',
        url: null,
        ticketUrl: null,
        venueUrl: null,
      },
      {
        id: 'bandsintown:evt-2',
        source: 'bandsintown',
        sourceLabel: 'Bandsintown',
        title: 'Echo Unit Live',
        startsAt: '2026-06-02T20:00:00',
        timezone: null,
        timeTbd: false,
        venueName: 'Second Hall',
        city: 'Tokyo',
        region: 'Tokyo',
        country: 'Japan',
        url: 'https://bandsintown.example/events/evt-2',
        ticketUrl: null,
        venueUrl: null,
      },
    ]);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('https://rest.bandsintown.com/artists/Echo%20Unit/events?');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('app_id=echo-next');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('date=upcoming');
  });

  it('filters Bandsintown events by manual region text', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 'hk',
          datetime: '2026-06-01T20:00:00',
          venue: { name: 'Echo Arena', city: 'Hong Kong', region: 'HK', country: 'Hong Kong' },
        },
        {
          id: 'jp',
          datetime: '2026-06-02T20:00:00',
          venue: { name: 'Second Hall', city: 'Tokyo', region: 'Tokyo', country: 'Japan' },
        },
      ],
    });

    const result = await new ArtistEventsService(fetcher).getBandsintownEvents({
      artistName: 'Echo Unit',
      appId: 'echo-next',
      region: 'tokyo',
    });

    expect(result.events.map((event) => event.id)).toEqual(['bandsintown:jp']);
  });

  it('maps Ticketmaster event payloads when a Ticketmaster key is configured', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        _embedded: {
          events: [
            {
              id: 'tm-1',
              name: 'Echo Unit Live',
              url: 'https://ticketmaster.example/events/tm-1',
              images: [
                { url: 'https://img.example/square.jpg', width: 305, height: 305 },
                { url: 'https://img.example/wide.jpg', width: 1024, height: 576 },
              ],
              dates: {
                start: {
                  dateTime: '2026-06-01T11:00:00Z',
                },
                timezone: 'Asia/Hong_Kong',
              },
              _embedded: {
                venues: [
                  {
                    name: 'Echo Arena',
                    city: { name: 'Hong Kong' },
                    state: { stateCode: 'HK' },
                    country: { countryCode: 'HK' },
                    url: 'https://ticketmaster.example/venues/echo-arena',
                  },
                ],
              },
            },
          ],
        },
      }),
    });

    const result = await new ArtistEventsService(fetcher).getTicketmasterEvents({
      artistName: 'Echo Unit',
      apiKey: 'ticketmaster-key',
      region: 'HK',
      now: new Date('2026-05-20T00:00:00.000Z'),
    });

    expect(result.status).toBe('ready');
    expect(result.sources).toEqual(['ticketmaster']);
    expect(result.events).toEqual([
      {
        id: 'ticketmaster:tm-1',
        source: 'ticketmaster',
        sourceLabel: 'Ticketmaster',
        title: 'Echo Unit Live',
        startsAt: '2026-06-01T11:00:00Z',
        timezone: 'Asia/Hong_Kong',
        timeTbd: false,
        venueName: 'Echo Arena',
        city: 'Hong Kong',
        region: 'HK',
        country: 'HK',
        url: 'https://ticketmaster.example/events/tm-1',
        ticketUrl: 'https://ticketmaster.example/events/tm-1',
        venueUrl: 'https://ticketmaster.example/venues/echo-arena',
        imageUrl: 'https://img.example/wide.jpg',
      },
    ]);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('https://app.ticketmaster.com/discovery/v2/events.json?');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('apikey=ticketmaster-key');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('classificationName=music');
  });

  it('maps SeatGeek event payloads when a SeatGeek client id is configured', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        events: [
          {
            id: 2002,
            title: 'Other Artist',
            url: 'https://seatgeek.example/events/other',
            datetime_local: '2026-06-01T20:00:00',
            venue: { name: 'Wrong Hall', city: 'Hong Kong', state: 'HK', country: 'HK' },
            performers: [{ name: 'Other Artist', slug: 'other-artist' }],
          },
          {
            id: 1001,
            title: 'Echo Unit Live',
            url: 'https://seatgeek.example/events/1001',
            datetime_local: '2026-06-02T20:00:00',
            time_tbd: true,
            venue: {
              name: 'Echo Arena',
              city: 'Hong Kong',
              state: 'HK',
              country: 'HK',
              timezone: 'Asia/Hong_Kong',
              url: 'https://seatgeek.example/venues/echo-arena',
            },
            performers: [{ name: 'Echo Unit', short_name: 'Echo Unit', slug: 'echo-unit' }],
          },
        ],
      }),
    });

    const result = await new ArtistEventsService(fetcher).getSeatGeekEvents({
      artistName: 'Echo Unit',
      clientId: 'seatgeek-id',
      region: 'HK',
      now: new Date('2026-05-20T00:00:00.000Z'),
    });

    expect(result.status).toBe('ready');
    expect(result.sources).toEqual(['seatgeek']);
    expect(result.events).toEqual([
      {
        id: 'seatgeek:1001',
        source: 'seatgeek',
        sourceLabel: 'SeatGeek',
        title: 'Echo Unit Live',
        startsAt: '2026-06-02T20:00:00',
        timezone: 'Asia/Hong_Kong',
        timeTbd: true,
        venueName: 'Echo Arena',
        city: 'Hong Kong',
        region: 'HK',
        country: 'HK',
        url: 'https://seatgeek.example/events/1001',
        ticketUrl: 'https://seatgeek.example/events/1001',
        venueUrl: 'https://seatgeek.example/venues/echo-arena',
        imageUrl: null,
      },
    ]);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('https://api.seatgeek.com/2/events?');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('client_id=seatgeek-id');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('q=Echo+Unit');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('datetime_local.gte=2026-05-20');
  });

  it('uses Ticketmaster without requiring Bandsintown in the combined artist events request', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        _embedded: {
          events: [
            {
              id: 'tm-1',
              name: 'Echo Unit Live',
              dates: { start: { localDate: '2026-06-01' } },
              _embedded: { venues: [{ name: 'Echo Arena', city: { name: 'Hong Kong' }, country: { countryCode: 'HK' } }] },
            },
          ],
        },
      }),
    });

    const result = await new ArtistEventsService(fetcher).getArtistEvents({
      artistName: 'Echo Unit',
      bandsintownAppId: null,
      ticketmasterApiKey: 'ticketmaster-key',
      region: 'Hong Kong',
      now: new Date('2026-05-20T00:00:00.000Z'),
    });

    expect(result.status).toBe('ready');
    expect(result.sources).toEqual(['ticketmaster']);
    expect(result.events.map((event) => event.id)).toEqual(['ticketmaster:tm-1']);
    expect(result.message).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses SeatGeek from the combined artist events request', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        events: [
          {
            id: 1001,
            title: 'Echo Unit Live',
            datetime_local: '2026-06-01T20:00:00',
            venue: { name: 'Echo Arena', city: 'Hong Kong', country: 'HK' },
            performers: [{ name: 'Echo Unit' }],
          },
        ],
      }),
    });

    const result = await new ArtistEventsService(fetcher).getArtistEvents({
      artistName: 'Echo Unit',
      bandsintownAppId: null,
      ticketmasterApiKey: null,
      seatGeekClientId: 'seatgeek-id',
      region: 'Hong Kong',
      now: new Date('2026-05-20T00:00:00.000Z'),
    });

    expect(result.status).toBe('ready');
    expect(result.sources).toEqual(['seatgeek']);
    expect(result.events.map((event) => event.id)).toEqual(['seatgeek:1001']);
    expect(result.message).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('falls back to Eventernote when configured providers return no events', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('ticketmaster.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ _embedded: { events: [] } }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => `
          <div class="gb_event_list clearfix">
            <ul>
              <li class="clearfix ">
                <div class="date">
                  <p class="day6">2026-07-18 (<span>土</span>)</p>
                  <p><img src="https://eventernote.example/events/454671_s.jpg" alt="MyGO!!!!! 9th LIVE"></p>
                </div>
                <div class="event">
                  <h4><a href="/events/454671">MyGO!!!!! 9th LIVE「つなぎ目の向こうに」DAY1</a></h4>
                  <div class="place">会場: <a href="/places/11340">ぴあアリーナMM</a></div>
                  <div class="place"><span class="s">開場 16:30 開演 18:00 終演 20:00</span></div>
                  <div class="actor"><ul><li><a href="/actors/MyGO%21%21%21%21%21/66346">MyGO!!!!!</a></li></ul></div>
                </div>
              </li>
            </ul>
          </div>
        `,
      };
    });

    const result = await new ArtistEventsService(fetcher).getArtistEvents({
      artistName: 'MyGO!!!!!',
      ticketmasterApiKey: 'ticketmaster-key',
      now: new Date('2026-05-25T00:00:00.000Z'),
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('https://www.eventernote.com/actors/MyGO%21%21%21%21%21/66346');
    expect(result.sources).toEqual(['ticketmaster', 'eventernote']);
    expect(result.events).toEqual([
      {
        id: 'eventernote:454671',
        source: 'eventernote',
        sourceLabel: 'Eventernote',
        title: 'MyGO!!!!! 9th LIVE「つなぎ目の向こうに」DAY1',
        startsAt: '2026-07-18T18:00:00',
        timezone: 'Asia/Tokyo',
        timeTbd: false,
        venueName: 'ぴあアリーナMM',
        city: null,
        region: null,
        country: 'Japan',
        url: 'https://www.eventernote.com/events/454671',
        ticketUrl: 'https://www.eventernote.com/events/454671',
        venueUrl: null,
        imageUrl: 'https://eventernote.example/events/454671_s.jpg',
      },
    ]);
  });

  it('finds upcoming Roselia events from Eventernote instead of being trapped on old history pages', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('ticketmaster.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ _embedded: { events: [] } }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => `
          <div class="gb_event_list clearfix">
            <ul>
              <li class="clearfix ">
                <div class="date">
                  <p class="day6">2026-08-29 (<span class="wday6">土</span>)</p>
                  <p><img src="https://eventernote.example/events/463596_s.jpg" alt="Roselia Lehre der Rose"></p>
                </div>
                <div class="event">
                  <h4><a href="/events/463596">Roselia「Lehre der Rose」- Roselia 10th Anniversary Best Album「Lehre der Rose」リリース記念ライブ DAY1</a></h4>
                  <div class="place">会場: <a href="/places/11572">有明アリーナ</a></div>
                  <div class="place"><span class="s">開場 16:30 開演 18:00 終演 20:00</span></div>
                  <div class="actor"><ul><li><a href="/actors/Roselia/24401">Roselia</a></li></ul></div>
                </div>
              </li>
            </ul>
          </div>
        `,
      };
    });

    const result = await new ArtistEventsService(fetcher).getArtistEvents({
      artistName: 'Roselia',
      ticketmasterApiKey: 'ticketmaster-key',
      now: new Date('2026-05-25T00:00:00.000Z'),
    });

    expect(String(fetcher.mock.calls[1]?.[0])).toContain('https://www.eventernote.com/events/search?');
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('year=2026');
    expect(result.sources).toEqual(['ticketmaster', 'eventernote']);
    expect(result.events).toEqual([
      {
        id: 'eventernote:463596',
        source: 'eventernote',
        sourceLabel: 'Eventernote',
        title: 'Roselia「Lehre der Rose」- Roselia 10th Anniversary Best Album「Lehre der Rose」リリース記念ライブ DAY1',
        startsAt: '2026-08-29T18:00:00',
        timezone: 'Asia/Tokyo',
        timeTbd: false,
        venueName: '有明アリーナ',
        city: null,
        region: null,
        country: 'Japan',
        url: 'https://www.eventernote.com/events/463596',
        ticketUrl: 'https://www.eventernote.com/events/463596',
        venueUrl: null,
        imageUrl: 'https://eventernote.example/events/463596_s.jpg',
      },
    ]);
  });

  it('uses no-key Japanese fallbacks even when no paid event provider is configured', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => `
        <div class="gb_event_list clearfix">
          <ul>
            <li class="clearfix ">
              <div class="date"><p class="day4">2026-07-02 (<span class="wday4">木</span>)</p></div>
              <div class="event">
                <h4><a href="/events/476970">J-POP SOUND CAPSULE 2026</a></h4>
                <div class="place">会場: <a href="/places/25763">Crypto.com Arena</a></div>
                <div class="place"><span class="s">開場 18:30 開演 20:00 終演 23:00</span></div>
                <div class="actor"><ul><li><a href="/actors/Roselia/24401">Roselia</a></li></ul></div>
              </div>
            </li>
          </ul>
        </div>
      `,
    });

    const result = await new ArtistEventsService(fetcher).getArtistEvents({
      artistName: 'Roselia',
      now: new Date('2026-05-25T00:00:00.000Z'),
      region: 'JP',
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('https://www.eventernote.com/events/search?');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('year=2026');
    expect(result.status).toBe('ready');
    expect(result.sources).toEqual(['eventernote']);
    expect(result.events.map((event) => event.id)).toEqual(['eventernote:476970']);
  });

  it('maps eplus ticket pages as a Japanese event fallback', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => `
        <main>
          <h1>Poppin’Party のチケット情報</h1>
          <a href="/sf/detail/2330760002">
            <h3>New Year LIVE「Happy BanG Year!!」 2026/1/3(土)18:00～</h3>
          </a>
          <p>Streaming+</p>
        </main>
      `,
    });

    const result = await new ArtistEventsService(fetcher).getEplusEvents({
      artistName: "Poppin'Party",
      now: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(result.status).toBe('ready');
    expect(result.sources).toEqual(['eplus']);
    expect(result.events).toEqual([
      {
        id: 'eplus:new year live happy bang year 2026 01 03t18 00 00',
        source: 'eplus',
        sourceLabel: 'eplus',
        title: 'New Year LIVE「Happy BanG Year!!」',
        startsAt: '2026-01-03T18:00:00',
        timezone: 'Asia/Tokyo',
        timeTbd: false,
        venueName: null,
        city: null,
        region: null,
        country: 'Japan',
        url: 'https://eplus.jp/sf/detail/2330760002',
        ticketUrl: 'https://eplus.jp/sf/detail/2330760002',
        venueUrl: null,
        imageUrl: null,
      },
    ]);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("https://eplus.jp/sf/search?keyword=Poppin'Party");
  });

  it('falls back to eplus when Ticketmaster and Eventernote have no Japanese artist matches', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('ticketmaster.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ _embedded: { events: [] } }),
        };
      }

      if (url.includes('eventernote.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '<div class="gb_event_list clearfix"><ul></ul></div>',
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => `
          <main>
            <h1>Poppin’Party のチケット情報</h1>
            <a href="/sf/detail/2330760002">New Year LIVE「Happy BanG Year!!」 2026/1/3(土)18:00～</a>
          </main>
        `,
      };
    });

    const result = await new ArtistEventsService(fetcher).getArtistEvents({
      artistName: "Poppin'Party",
      ticketmasterApiKey: 'ticketmaster-key',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('https://www.eventernote.com/events/search?');
    expect(String(fetcher.mock.calls[2]?.[0])).toContain('year=2027');
    expect(String(fetcher.mock.calls[4]?.[0])).toContain("https://eplus.jp/sf/search?keyword=Poppin'Party");
    expect(result.sources).toEqual(['ticketmaster', 'eventernote', 'eplus']);
    expect(result.events.map((event) => event.id)).toEqual(['eplus:new year live happy bang year 2026 01 03t18 00 00']);
  });

  it('degrades to unavailable when Bandsintown fails', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    });

    const result = await new ArtistEventsService(fetcher).getBandsintownEvents({
      artistName: 'Echo Unit',
      appId: 'echo-next',
      region: 'HK',
      now: new Date('2026-05-20T00:00:00.000Z'),
    });

    expect(result.status).toBe('unavailable');
    expect(result.sources).toEqual(['bandsintown']);
    expect(result.events).toEqual([]);
    expect(result.fetchedAt).toBe('2026-05-20T00:00:00.000Z');
    expect(result.message).toBe('bandsintown_request_failed:429');
  });

  it('reuses cached Bandsintown events for the same artist and region', async () => {
    const database = createDatabase(':memory:');
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 'hk',
          datetime: '2026-06-01T20:00:00',
          venue: { name: 'Echo Arena', city: 'Hong Kong', region: 'HK', country: 'Hong Kong' },
        },
      ],
    });
    const service = new ArtistEventsService(fetcher, database);

    const first = await service.getBandsintownEvents({
      artistId: 'artist-1',
      artistName: 'Echo Unit',
      appId: 'echo-next',
      region: 'HK',
      now: new Date('2026-05-20T00:00:00.000Z'),
    });
    const second = await service.getBandsintownEvents({
      artistId: 'artist-1',
      artistName: 'Echo Unit',
      appId: 'echo-next',
      region: 'HK',
      now: new Date('2026-05-20T00:10:00.000Z'),
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first.events).toHaveLength(1);
    expect(second.events).toEqual(first.events);
    database.close();
  });
});
