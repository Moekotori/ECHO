import { describe, expect, it, vi } from 'vitest';
import { LastFmClient, LASTFM_BASE_URL } from './LastFmClient';

describe('LastFmClient', () => {
  it('signs sorted non-empty params with md5 and skips format', () => {
    const client = new LastFmClient({ apiKey: 'key', apiSecret: 'secret', fetchImpl: vi.fn() as never });

    expect(client.sign({ b: 2, format: 'json', empty: '', method: 'x', a: 1, missing: null })).toBe('9abac4c79b2cc97d19abb9626fe0668f');
  });

  it('posts signed now playing payloads without local-only fields', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ nowplaying: { ignored: true } }), { status: 200 })) as unknown as typeof fetch & {
      mock: { calls: Array<[string, RequestInit]> };
    };
    const client = new LastFmClient({ apiKey: 'key', apiSecret: 'secret', fetchImpl });
    client.setSession('session-key', 'alice');

    await expect(client.updateNowPlaying({ artist: 'Artist', title: 'Track', album: 'Album', duration: 120 })).resolves.toMatchObject({
      ok: true,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      LASTFM_BASE_URL,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );
    const body = String(fetchImpl.mock.calls[0][1].body);
    expect(body).toContain('method=track.updateNowPlaying');
    expect(body).toContain('artist=Artist');
    expect(body).toContain('track=Track');
    expect(body).toContain('album=Album');
    expect(body).not.toContain('path=');
  });
});
