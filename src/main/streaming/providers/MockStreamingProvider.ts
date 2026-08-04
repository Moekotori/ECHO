import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import electron from 'electron';
import type {
  StreamingAlbum,
  StreamingArtist,
  StreamingLyricsResult,
  StreamingMvResult,
  StreamingPlaybackRequest,
  StreamingPlaybackSource,
  StreamingSearchRequest,
  StreamingSearchResult,
  StreamingTrack,
} from '../../../shared/types/streaming';
import { streamingStableKey } from '../../../shared/types/streaming';
import type { StreamingProvider } from '../StreamingProvider';
import { rankByFuzzySearch } from '../StreamingFuzzySearch';

const provider = 'mock' as const;

const mockArtists = {
  echoLab: {
    id: 'mock-artist-echo-lab',
    provider,
    providerArtistId: 'echo-lab',
    name: 'ECHO Lab',
  },
  nightDesk: {
    id: 'mock-artist-night-desk',
    provider,
    providerArtistId: 'night-desk',
    name: 'Night Desk',
  },
};

const createTrack = (input: {
  providerTrackId: string;
  title: string;
  artist: string;
  artists: StreamingTrack['artists'];
  album: string;
  albumId: string | null;
  duration: number | null;
  coverHue: string;
  qualities?: StreamingTrack['qualities'];
  mvStatus?: StreamingTrack['mvStatus'];
}): StreamingTrack => ({
  id: streamingStableKey(provider, input.providerTrackId),
  provider,
  providerTrackId: input.providerTrackId,
  stableKey: streamingStableKey(provider, input.providerTrackId),
  title: input.title,
  artist: input.artist,
  artists: input.artists,
  album: input.album,
  albumId: input.albumId,
  albumArtist: input.artist,
  duration: input.duration,
  coverUrl: null,
  // TODO(StreamingImageCache): replace mock data URLs and provider hotlinks with cached image URLs.
  coverThumb: `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="12" fill="${input.coverHue}"/><circle cx="66" cy="30" r="14" fill="rgba(255,255,255,.3)"/><path d="M24 67c12-24 24-24 48 0" fill="none" stroke="white" stroke-width="8" stroke-linecap="round"/></svg>`,
  )}`,
  qualities: input.qualities ?? ['standard', 'high'],
  explicit: false,
  playable: true,
  unavailableReason: null,
  lyricsStatus: 'available',
  mvStatus: input.mvStatus ?? 'missing',
});

const tracks: StreamingTrack[] = [
  createTrack({
    providerTrackId: 'mock-aurora-cache',
    title: 'Mock Playable',
    artist: 'ECHO Lab',
    artists: [mockArtists.echoLab],
    album: 'Streaming Foundations',
    albumId: 'mock-album-foundations',
    duration: 6,
    coverHue: '#52796f',
    qualities: ['standard', 'high', 'lossless'],
    mvStatus: 'available',
  }),
  createTrack({
    providerTrackId: 'mock-no-duration',
    title: 'Mock Duration Backfill',
    artist: 'Night Desk',
    artists: [mockArtists.nightDesk],
    album: 'Queue Safe',
    albumId: 'mock-album-queue-safe',
    duration: null,
    coverHue: '#8f5d46',
  }),
  createTrack({
    providerTrackId: 'mock-offline-example',
    title: 'Mock Unavailable',
    artist: 'ECHO Lab',
    artists: [mockArtists.echoLab],
    album: 'Provider Edges',
    albumId: 'mock-album-provider-edges',
    duration: 5,
    coverHue: '#7d5b8c',
  }),
].map((track) =>
  track.providerTrackId === 'mock-offline-example'
    ? { ...track, playable: false, unavailableReason: '需要会员或版权不可用' }
    : track,
);

const albums: StreamingAlbum[] = [
  {
    id: streamingStableKey(provider, 'album:mock-album-foundations'),
    provider,
    providerAlbumId: 'mock-album-foundations',
    title: 'Streaming Foundations',
    artist: 'ECHO Lab',
    artists: [mockArtists.echoLab],
    coverUrl: null,
    coverThumb: tracks[0]?.coverThumb ?? null,
    releaseDate: '2026-05-15',
    trackCount: 1,
  },
  {
    id: streamingStableKey(provider, 'album:mock-album-queue-safe'),
    provider,
    providerAlbumId: 'mock-album-queue-safe',
    title: 'Queue Safe',
    artist: 'Night Desk',
    artists: [mockArtists.nightDesk],
    coverUrl: null,
    coverThumb: tracks[1]?.coverThumb ?? null,
    releaseDate: '2026-05-15',
    trackCount: 1,
  },
];

const artists: StreamingArtist[] = [
  {
    ...mockArtists.echoLab,
    avatarUrl: tracks[0]?.coverThumb ?? null,
    coverUrl: tracks[0]?.coverThumb ?? null,
  },
  {
    ...mockArtists.nightDesk,
    avatarUrl: tracks[1]?.coverThumb ?? null,
    coverUrl: tracks[1]?.coverThumb ?? null,
  },
];

const normalizeQuery = (query: string): string => query.trim().toLocaleLowerCase();

const trackSearchFields = (track: StreamingTrack): string[] => [
  track.title,
  track.artist,
  track.album,
  track.providerTrackId,
  ...track.artists.map((artist) => artist.name),
];

const albumSearchFields = (album: StreamingAlbum): string[] => [
  album.title,
  album.artist,
  album.providerAlbumId,
  ...album.artists.map((artist) => artist.name),
];

const artistSearchFields = (artist: StreamingArtist): string[] => [
  artist.name,
  artist.providerArtistId,
];

const getTrack = (providerTrackId: string): StreamingTrack => {
  const track = tracks.find((item) => item.providerTrackId === providerTrackId);
  if (!track) {
    throw new Error(`Mock streaming track not found: ${providerTrackId}`);
  }

  return track;
};

const mockAssetPath = (): string => {
  const electronApp = (electron as unknown as { app?: { getPath: (name: string) => string } }).app;
  return join(electronApp?.getPath('userData') ?? tmpdir(), 'echo-next-mock-streaming', 'mock-tone.wav');
};

const createMockWav = (filePath: string): void => {
  if (existsSync(filePath)) {
    return;
  }

  const sampleRate = 44100;
  const durationSeconds = 6;
  const channels = 1;
  const bitsPerSample = 16;
  const sampleCount = sampleRate * durationSeconds;
  const dataSize = sampleCount * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = Math.min(1, index / 800, (sampleCount - index) / 1200);
    const sample = Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * 440) * 0.22 * envelope * 32767);
    buffer.writeInt16LE(sample, 44 + index * 2);
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, buffer);
};

export class MockStreamingProvider implements StreamingProvider {
  readonly name = provider;

  readonly descriptor = {
    displayName: 'Mock',
    enabled: true,
    supportsSearch: true,
    supportsLyrics: true,
    supportsMv: true,
    requiresAccount: false,
  };

  async search(request: StreamingSearchRequest): Promise<StreamingSearchResult> {
    const query = normalizeQuery(request.query);
    const page = Math.max(1, Math.floor(request.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(request.pageSize ?? 20)));
    const mediaType = request.mediaTypes?.[0] ?? 'track';
    const filteredTracks = query ? rankByFuzzySearch(tracks, query, trackSearchFields) : tracks;
    const filteredAlbums = query ? rankByFuzzySearch(albums, query, albumSearchFields) : albums;
    const filteredArtists = query ? rankByFuzzySearch(artists, query, artistSearchFields) : artists;
    const filtered = mediaType === 'album' ? filteredAlbums : mediaType === 'artist' ? filteredArtists : filteredTracks;
    const offset = (page - 1) * pageSize;
    const pageItems = filtered.slice(offset, offset + pageSize);

    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });

    return {
      provider,
      query: request.query,
      page,
      pageSize,
      total: filtered.length,
      hasMore: offset + pageItems.length < filtered.length,
      tracks: mediaType === 'track' ? pageItems as StreamingTrack[] : [],
      albums: mediaType === 'album' ? pageItems as StreamingAlbum[] : [],
      artists: mediaType === 'artist' ? pageItems as StreamingArtist[] : [],
      playlists: [],
      mvs: [],
    };
  }

  async getTrack(input: { providerTrackId: string }): Promise<StreamingTrack> {
    return getTrack(input.providerTrackId);
  }

  async getAlbum(input: { providerAlbumId: string }): Promise<StreamingAlbum & { tracks: StreamingTrack[] }> {
    const album = albums.find((item) => item.providerAlbumId === input.providerAlbumId);
    if (!album) {
      throw new Error(`Mock streaming album not found: ${input.providerAlbumId}`);
    }

    return {
      ...album,
      tracks: tracks.filter((track) => track.albumId === input.providerAlbumId),
    };
  }

  async getArtist(input: { providerArtistId: string }) {
    const artist = artists.find((item) => item.providerArtistId === input.providerArtistId);
    if (!artist) {
      throw new Error(`Mock streaming artist not found: ${input.providerArtistId}`);
    }

    return {
      ...artist,
      topTracks: tracks.filter((track) => track.artists.some((item) => item.providerArtistId === input.providerArtistId)).slice(0, 20),
      albums: albums.filter((album) => album.artists.some((item) => item.providerArtistId === input.providerArtistId)),
    };
  }

  async getLyrics(input: { providerTrackId: string }): Promise<StreamingLyricsResult> {
    const track = getTrack(input.providerTrackId);

    return {
      provider,
      providerTrackId: track.providerTrackId,
      status: track.lyricsStatus,
      plainLyrics: `Mock lyrics for ${track.title}\nBuilt to validate streaming metadata without touching local files.`,
      syncedLyrics: null,
      lines: [
        { timeMs: 0, text: `Mock lyrics for ${track.title}` },
        { timeMs: 12000, text: 'Built to validate streaming metadata without touching local files.' },
      ],
      sourceLabel: 'Mock lyrics',
    };
  }

  async getMv(input: { providerTrackId: string }): Promise<StreamingMvResult> {
    const track = getTrack(input.providerTrackId);

    if (track.mvStatus !== 'available') {
      return {
        provider,
        providerTrackId: track.providerTrackId,
        status: 'missing',
        items: [],
      };
    }

    return {
      provider,
      providerTrackId: track.providerTrackId,
      status: 'available',
      items: [
        {
          id: `mock-mv:${track.providerTrackId}`,
          provider,
          providerMvId: `mv-${track.providerTrackId}`,
          providerTrackId: track.providerTrackId,
          title: `${track.title} MV`,
          artist: track.artist,
          duration: track.duration,
          thumbnailUrl: track.coverThumb,
        },
      ],
    };
  }

  async resolvePlayback(request: StreamingPlaybackRequest): Promise<StreamingPlaybackSource> {
    const track = getTrack(request.providerTrackId);
    if (!track.playable) {
      throw new Error(track.unavailableReason ?? 'Mock track is unavailable.');
    }

    const filePath = mockAssetPath();
    createMockWav(filePath);

    return {
      provider,
      providerTrackId: track.providerTrackId,
      url: filePath,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      mimeType: 'audio/wav',
      bitrate: 705600,
      sampleRate: 44100,
      bitDepth: 16,
      codec: 'wav',
      headers: {},
      requiresProxy: false,
      supportsRange: true,
    };
  }
}
