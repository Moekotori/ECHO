import { afterEach, describe, expect, it, vi } from 'vitest';
import { KuwoArtistImageProvider } from './KuwoArtistImageProvider';

describe('KuwoArtistImageProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps Kuwo artist search results to artist image candidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          "{'BASEPICPATH':'http://img1.kuwo.cn/star/starheads/','abslist':[{'ARTIST':'Aimer','ARTISTID':'22690','PICPATH':'240/s4s20/39/258878393.png','hts_PICPATH':'https://img2.kuwo.cn/star/starheads/240/s4s20/39/258878393.png'},{'ARTIST':'Other','ARTISTID':'1','PICPATH':'240/no_pic.jpg'}]}",
          { status: 200 },
        ),
      ),
    );
    const provider = new KuwoArtistImageProvider();

    const candidates = await provider.searchArtistImage({ artistName: 'Aimer', artistKey: 'aimer' });

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('search.kuwo.cn/r.s'), expect.any(Object));
    expect(candidates[0]).toMatchObject({
      provider: 'kuwo',
      providerArtistId: '22690',
      artistName: 'Aimer',
      imageUrl: 'https://img2.kuwo.cn/star/starheads/500/s4s20/39/258878393.png',
      confidence: 0.96,
      quality: 500,
      sourceUrl: 'https://www.kuwo.cn/singer_detail/22690',
    });
  });

  it('falls back to BASEPICPATH and filters obvious placeholder images', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          "{'BASEPICPATH':'http://img1.kuwo.cn/star/starheads/','abslist':[{'ARTIST':'Abyssmare','ARTISTID':'12641742','PICPATH':'240/96/39/3155308302.jpg'},{'ARTIST':'Empty','ARTISTID':'2','PICPATH':'240/default.jpg'}]}",
          { status: 200 },
        ),
      ),
    );
    const provider = new KuwoArtistImageProvider();

    const candidates = await provider.searchArtistImage({ artistName: 'Abyssmare', artistKey: 'abyssmare' });

    expect(candidates[0]).toMatchObject({
      provider: 'kuwo',
      providerArtistId: '12641742',
      artistName: 'Abyssmare',
      imageUrl: 'https://img1.kuwo.cn/star/starheads/500/96/39/3155308302.jpg',
      confidence: 0.96,
    });
    expect(candidates.some((candidate) => candidate.artistName === 'Empty')).toBe(false);
  });
});
