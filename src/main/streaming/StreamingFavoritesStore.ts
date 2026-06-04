import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import type {
  StreamingFavoriteCollection,
  StreamingFavoriteProviderName,
  StreamingFavoritesSnapshot,
  StreamingFavoriteTrack,
  StreamingTrack,
} from '../../shared/types/streaming';
import { streamingStableKey } from '../../shared/types/streaming';

const favoriteProviders: StreamingFavoriteProviderName[] = ['bilibili', 'youtube', 'soundcloud'];

type PersistedFavoriteFile = Partial<StreamingFavoritesSnapshot> & {
  providers?: Partial<Record<StreamingFavoriteProviderName, unknown>>;
  collections?: unknown;
};

export const isStreamingFavoriteProvider = (provider: string): provider is StreamingFavoriteProviderName =>
  provider === 'bilibili' || provider === 'youtube' || provider === 'soundcloud';

export const streamingFavoriteWebUrl = (track: Pick<StreamingTrack, 'provider' | 'providerTrackId' | 'title' | 'artist'>): string => {
  if (track.provider === 'bilibili') {
    return `https://www.bilibili.com/video/${encodeURIComponent(track.providerTrackId)}`;
  }

  if (track.provider === 'youtube') {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(track.providerTrackId)}`;
  }

  if (track.provider === 'soundcloud') {
    return track.providerTrackId.startsWith('http')
      ? track.providerTrackId
      : `https://soundcloud.com/search/sounds?q=${encodeURIComponent(track.title ? `${track.artist} ${track.title}` : track.providerTrackId)}`;
  }

  return track.providerTrackId;
};

const emptySnapshot = (updatedAt = new Date().toISOString()): StreamingFavoritesSnapshot => ({
  version: 1,
  updatedAt,
  providers: {
    bilibili: [],
    youtube: [],
    soundcloud: [],
  },
  collections: [],
});

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

const nullableText = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

const nullableNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

const favoriteCollectionId = (provider: StreamingFavoriteProviderName, providerPlaylistId: string): string =>
  `streaming-favorites:${provider}:${encodeURIComponent(providerPlaylistId)}`;

const normalizeFavoriteItem = (
  provider: StreamingFavoriteProviderName,
  value: unknown,
): StreamingFavoriteTrack | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const input = value as Partial<StreamingFavoriteTrack>;
  const providerTrackId = text(input.providerTrackId).trim();
  if (!providerTrackId) {
    return null;
  }

  const stableKey = text(input.stableKey).trim() || streamingStableKey(provider, providerTrackId);
  const now = new Date().toISOString();
  const qualities = Array.isArray(input.qualities)
    ? input.qualities.filter((quality) => quality === 'standard' || quality === 'high' || quality === 'lossless' || quality === 'hires')
    : [];

  return {
    id: text(input.id).trim() || stableKey,
    provider,
    providerTrackId,
    stableKey,
    title: text(input.title, 'Untitled').trim() || 'Untitled',
    artist: text(input.artist, 'Unknown Artist').trim() || 'Unknown Artist',
    album: text(input.album, 'Unknown Album').trim() || 'Unknown Album',
    albumArtist: nullableText(input.albumArtist),
    duration: nullableNumber(input.duration),
    coverUrl: nullableText(input.coverUrl),
    coverThumb: nullableText(input.coverThumb),
    qualities,
    playable: input.playable !== false,
    unavailableReason: nullableText(input.unavailableReason),
    lyricsStatus: input.lyricsStatus === 'available' || input.lyricsStatus === 'missing' ? input.lyricsStatus : 'unknown',
    mvStatus: input.mvStatus === 'available' || input.mvStatus === 'missing' ? input.mvStatus : 'unknown',
    webUrl: text(input.webUrl).trim() || streamingFavoriteWebUrl({ provider, providerTrackId, title: text(input.title), artist: text(input.artist) }),
    addedAt: text(input.addedAt).trim() || now,
    updatedAt: text(input.updatedAt).trim() || now,
  };
};

const normalizeFavoriteCollection = (value: unknown): StreamingFavoriteCollection | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const input = value as Partial<StreamingFavoriteCollection>;
  const provider = text(input.provider).trim();
  if (!isStreamingFavoriteProvider(provider)) {
    return null;
  }

  const providerPlaylistId = text(input.providerPlaylistId).trim();
  if (!providerPlaylistId) {
    return null;
  }

  const now = new Date().toISOString();
  const name = text(input.name).trim() || text(input.sourceName).trim() || `${provider} favorites`;
  const seen = new Set<string>();
  const tracks = (Array.isArray(input.tracks) ? input.tracks : [])
    .map((item) => normalizeFavoriteItem(provider, item))
    .filter((item): item is StreamingFavoriteTrack => {
      if (!item || seen.has(item.providerTrackId)) {
        return false;
      }
      seen.add(item.providerTrackId);
      return true;
    });

  return {
    id: text(input.id).trim() || favoriteCollectionId(provider, providerPlaylistId),
    provider,
    providerPlaylistId,
    name,
    sourceName: nullableText(input.sourceName),
    tracks,
    createdAt: text(input.createdAt).trim() || now,
    updatedAt: text(input.updatedAt).trim() || now,
  };
};

const normalizeSnapshot = (value: unknown): StreamingFavoritesSnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return emptySnapshot();
  }

  const input = value as PersistedFavoriteFile;
  const updatedAt = text(input.updatedAt).trim() || new Date().toISOString();
  const snapshot = emptySnapshot(updatedAt);
  for (const provider of favoriteProviders) {
    const items = Array.isArray(input.providers?.[provider]) ? input.providers[provider] : [];
    const seen = new Set<string>();
    snapshot.providers[provider] = items
      .map((item) => normalizeFavoriteItem(provider, item))
      .filter((item): item is StreamingFavoriteTrack => {
        if (!item || seen.has(item.providerTrackId)) {
          return false;
        }
        seen.add(item.providerTrackId);
        return true;
      });
  }
  const seenCollections = new Set<string>();
  snapshot.collections = (Array.isArray(input.collections) ? input.collections : [])
    .map((item) => normalizeFavoriteCollection(item))
    .filter((item): item is StreamingFavoriteCollection => {
      if (!item) {
        return false;
      }
      const key = `${item.provider}:${item.providerPlaylistId}`;
      if (seenCollections.has(key)) {
        return false;
      }
      seenCollections.add(key);
      return true;
    });
  return snapshot;
};

const favoriteItemFromTrack = (
  provider: StreamingFavoriteProviderName,
  track: StreamingTrack,
  existing: StreamingFavoriteTrack | undefined,
  now: string,
): StreamingFavoriteTrack => ({
  id: track.stableKey || streamingStableKey(provider, track.providerTrackId),
  provider,
  providerTrackId: track.providerTrackId,
  stableKey: track.stableKey || streamingStableKey(provider, track.providerTrackId),
  title: track.title,
  artist: track.artist,
  album: track.album,
  albumArtist: track.albumArtist,
  duration: track.duration,
  coverUrl: track.coverUrl,
  coverThumb: track.coverThumb,
  qualities: track.qualities,
  playable: track.playable,
  unavailableReason: track.unavailableReason,
  lyricsStatus: track.lyricsStatus,
  mvStatus: track.mvStatus,
  webUrl: streamingFavoriteWebUrl(track),
  addedAt: existing?.addedAt ?? now,
  updatedAt: now,
});

export class StreamingFavoritesStore {
  constructor(private readonly filePath = join(app?.getPath?.('userData') ?? join(tmpdir(), 'echo-next'), 'streaming-favorites.json')) {}

  getSnapshot(): StreamingFavoritesSnapshot {
    if (!existsSync(this.filePath)) {
      return emptySnapshot();
    }

    try {
      return normalizeSnapshot(JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown);
    } catch {
      return emptySnapshot();
    }
  }

  setFavorite(track: StreamingTrack, favorite: boolean): { favorite: boolean; item: StreamingFavoriteTrack | null; snapshot: StreamingFavoritesSnapshot } {
    if (!isStreamingFavoriteProvider(track.provider)) {
      throw new Error('This streaming provider does not support local favorites.');
    }

    const snapshot = this.getSnapshot();
    const now = new Date().toISOString();
    const items = snapshot.providers[track.provider].filter((item) => item.providerTrackId !== track.providerTrackId);
    let item: StreamingFavoriteTrack | null = null;

    if (favorite) {
      item = favoriteItemFromTrack(
        track.provider,
        track,
        snapshot.providers[track.provider].find((existing) => existing.providerTrackId === track.providerTrackId),
        now,
      );
      items.unshift(item);
    }

    snapshot.providers[track.provider] = items;
    snapshot.updatedAt = now;
    this.writeSnapshot(snapshot);
    return { favorite, item, snapshot };
  }

  importTracks(tracks: StreamingTrack[]): { importedCount: number; addedCount: number; snapshot: StreamingFavoritesSnapshot } {
    const favoriteTracks = tracks.filter((track) => isStreamingFavoriteProvider(track.provider));
    if (favoriteTracks.length === 0) {
      return { importedCount: 0, addedCount: 0, snapshot: this.getSnapshot() };
    }

    const snapshot = this.getSnapshot();
    const now = new Date().toISOString();
    let importedCount = 0;
    let addedCount = 0;

    for (const provider of favoriteProviders) {
      const providerTracks = favoriteTracks.filter((track) => track.provider === provider);
      if (providerTracks.length === 0) {
        continue;
      }

      const existingById = new Map(snapshot.providers[provider].map((item) => [item.providerTrackId, item]));
      const importedById = new Map<string, StreamingFavoriteTrack>();
      for (const track of providerTracks) {
        const existing = existingById.get(track.providerTrackId);
        const item = favoriteItemFromTrack(provider, track, existing, now);
        if (!existing && !importedById.has(track.providerTrackId)) {
          addedCount += 1;
        }
        importedById.set(track.providerTrackId, item);
      }

      importedCount += importedById.size;
      const importedIds = new Set(importedById.keys());
      snapshot.providers[provider] = [
        ...importedById.values(),
        ...snapshot.providers[provider].filter((item) => !importedIds.has(item.providerTrackId)),
      ];
    }

    snapshot.updatedAt = now;
    this.writeSnapshot(snapshot);
    return { importedCount, addedCount, snapshot };
  }

  importCollection(
    provider: StreamingFavoriteProviderName,
    providerPlaylistId: string,
    name: string,
    tracks: StreamingTrack[],
  ): { collection: StreamingFavoriteCollection; importedCount: number; addedCount: number; snapshot: StreamingFavoritesSnapshot } {
    if (!isStreamingFavoriteProvider(provider)) {
      throw new Error('This streaming provider does not support local favorites.');
    }

    const normalizedProviderPlaylistId = providerPlaylistId.trim();
    if (!normalizedProviderPlaylistId) {
      throw new Error('Favorite collection source id is required.');
    }

    const snapshot = this.getSnapshot();
    const now = new Date().toISOString();
    const existingIndex = snapshot.collections.findIndex(
      (collection) => collection.provider === provider && collection.providerPlaylistId === normalizedProviderPlaylistId,
    );
    const existing = existingIndex >= 0 ? snapshot.collections[existingIndex] : null;
    const existingById = new Map((existing?.tracks ?? []).map((item) => [item.providerTrackId, item]));
    const importedById = new Map<string, StreamingFavoriteTrack>();
    let addedCount = 0;

    for (const track of tracks) {
      if (track.provider !== provider || !track.providerTrackId) {
        continue;
      }

      const existingTrack = existingById.get(track.providerTrackId);
      const item = favoriteItemFromTrack(provider, track, existingTrack, now);
      if (!existingTrack && !importedById.has(track.providerTrackId)) {
        addedCount += 1;
      }
      importedById.set(track.providerTrackId, item);
    }

    const sourceName = name.trim() || existing?.sourceName || `${provider} favorites`;
    const collection: StreamingFavoriteCollection = {
      id: existing?.id ?? favoriteCollectionId(provider, normalizedProviderPlaylistId),
      provider,
      providerPlaylistId: normalizedProviderPlaylistId,
      name: existing?.name.trim() || sourceName,
      sourceName,
      tracks: [...importedById.values()],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (existingIndex >= 0) {
      snapshot.collections[existingIndex] = collection;
    } else {
      snapshot.collections = [collection, ...snapshot.collections];
    }
    snapshot.updatedAt = now;
    this.writeSnapshot(snapshot);
    return { collection, importedCount: importedById.size, addedCount, snapshot };
  }

  renameCollection(collectionId: string, name: string): { collection: StreamingFavoriteCollection; snapshot: StreamingFavoritesSnapshot } {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('Favorite collection name is required.');
    }

    const snapshot = this.getSnapshot();
    const collectionIndex = snapshot.collections.findIndex((collection) => collection.id === collectionId);
    if (collectionIndex < 0) {
      throw new Error('Favorite collection was not found.');
    }

    const now = new Date().toISOString();
    const collection = {
      ...snapshot.collections[collectionIndex],
      name: trimmedName,
      updatedAt: now,
    };
    snapshot.collections[collectionIndex] = collection;
    snapshot.updatedAt = now;
    this.writeSnapshot(snapshot);
    return { collection, snapshot };
  }

  deleteCollection(collectionId: string): { collectionId: string; snapshot: StreamingFavoritesSnapshot } {
    const trimmedCollectionId = collectionId.trim();
    if (!trimmedCollectionId) {
      throw new Error('Favorite collection id is required.');
    }

    const snapshot = this.getSnapshot();
    const nextCollections = snapshot.collections.filter((collection) => collection.id !== trimmedCollectionId);
    if (nextCollections.length === snapshot.collections.length) {
      throw new Error('Favorite collection was not found.');
    }

    snapshot.collections = nextCollections;
    snapshot.updatedAt = new Date().toISOString();
    this.writeSnapshot(snapshot);
    return { collectionId: trimmedCollectionId, snapshot };
  }

  getExportContent(): string {
    return `${JSON.stringify(this.getSnapshot(), null, 2)}\n`;
  }

  private writeSnapshot(snapshot: StreamingFavoritesSnapshot): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    renameSync(tempPath, this.filePath);
  }
}
