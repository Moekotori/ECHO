import { describe, expect, it } from 'vitest';
import { MockStreamingProvider } from './MockStreamingProvider';

describe('MockStreamingProvider search', () => {
  it('matches abbreviated and typo-tolerant track queries', async () => {
    const result = await new MockStreamingProvider().search({
      provider: 'mock',
      query: 'mck plybl',
      page: 1,
      pageSize: 10,
    });

    expect(result.tracks.map((track) => track.title)).toEqual(['Mock Playable']);
  });

  it('matches tokens across artist and album fields', async () => {
    const result = await new MockStreamingProvider().search({
      provider: 'mock',
      query: 'night queue',
      page: 1,
      pageSize: 10,
    });

    expect(result.tracks.map((track) => track.title)).toEqual(['Mock Duration Backfill']);
  });

  it('supports fuzzy album and artist searches', async () => {
    const provider = new MockStreamingProvider();
    const albums = await provider.search({
      provider: 'mock',
      query: 'strm fnd',
      mediaTypes: ['album'],
      page: 1,
      pageSize: 10,
    });
    const artists = await provider.search({
      provider: 'mock',
      query: 'ech lb',
      mediaTypes: ['artist'],
      page: 1,
      pageSize: 10,
    });

    expect(albums.albums.map((album) => album.title)).toEqual(['Streaming Foundations']);
    expect(artists.artists.map((artist) => artist.name)).toEqual(['ECHO Lab']);
  });

  it('loads album details with tracks for clickable album results', async () => {
    const detail = await new MockStreamingProvider().getAlbum({
      providerAlbumId: 'mock-album-foundations',
    });

    expect(detail).toMatchObject({
      provider: 'mock',
      providerAlbumId: 'mock-album-foundations',
      title: 'Streaming Foundations',
    });
    expect(detail.tracks.map((track) => track.title)).toEqual(['Mock Playable']);
  });
});
