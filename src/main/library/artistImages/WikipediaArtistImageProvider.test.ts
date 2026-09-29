import { afterEach, describe, expect, it, vi } from 'vitest';
import { WikipediaArtistImageProvider } from './WikipediaArtistImageProvider';

describe('WikipediaArtistImageProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps exact summary pages with original images to artist image candidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            type: 'standard',
            title: 'Milet',
            displaytitle: 'Milet',
            originalimage: {
              source: 'https://upload.wikimedia.org/wikipedia/commons/milet.jpg',
              width: 900,
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = new WikipediaArtistImageProvider();

    const candidates = await provider.searchArtistImage({ artistName: 'Milet', artistKey: 'milet' });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(candidates[0]).toMatchObject({
      provider: 'wikipedia',
      providerArtistId: 'Milet',
      artistName: 'Milet',
      imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/milet.jpg',
      confidence: 0.96,
      quality: 900,
      sourceUrl: 'https://zh.wikipedia.org/wiki/Milet',
    });
  });

  it('ignores disambiguation and placeholder summaries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            type: 'disambiguation',
            title: 'Miku',
            thumbnail: {
              source: 'https://upload.wikimedia.org/no_image.png',
              width: 320,
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = new WikipediaArtistImageProvider();

    const candidates = await provider.searchArtistImage({ artistName: 'Miku', artistKey: 'miku' });

    expect(candidates).toEqual([]);
  });
});
