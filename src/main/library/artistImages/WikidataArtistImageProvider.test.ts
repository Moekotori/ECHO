import { afterEach, describe, expect, it, vi } from 'vitest';
import { WikidataArtistImageProvider } from './WikidataArtistImageProvider';

describe('WikidataArtistImageProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps Wikidata P18 images to Wikimedia Commons redirect candidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('wbsearchentities')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                search: [
                  {
                    id: 'Q233271',
                    label: 'Aimer',
                    description: 'Japanese singer',
                  },
                ],
              }),
              { status: 200 },
            ),
          );
        }

        return Promise.resolve(
          new Response(
            JSON.stringify({
              entities: {
                Q233271: {
                  labels: {
                    en: { value: 'Aimer' },
                  },
                  claims: {
                    P18: [
                      {
                        mainsnak: {
                          datavalue: {
                            value: 'Aimer at concert.jpg',
                          },
                        },
                      },
                    ],
                  },
                },
              },
            }),
            { status: 200 },
          ),
        );
      }) as never,
    );
    const provider = new WikidataArtistImageProvider();

    const candidates = await provider.searchArtistImage({ artistName: 'Aimer', artistKey: 'aimer' });

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('wbsearchentities'), expect.any(Object));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('wbgetentities'), expect.any(Object));
    expect(candidates[0]).toMatchObject({
      provider: 'wikidata',
      providerArtistId: 'Q233271',
      artistName: 'Aimer',
      imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Aimer%20at%20concert.jpg?width=1200',
      confidence: 0.96,
      quality: 1200,
      sourceUrl: 'https://www.wikidata.org/wiki/Q233271',
    });
  });

  it('ignores obvious non-music entities', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            search: [
              {
                id: 'Q1',
                label: 'Mercury',
                description: 'chemical element',
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = new WikidataArtistImageProvider();

    const candidates = await provider.searchArtistImage({ artistName: 'Mercury', artistKey: 'mercury' });

    expect(candidates).toEqual([]);
  });
});
