import { app, dialog, ipcMain } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import { getAppSettings } from '../app/appSettings';
import type {
  StreamingMediaType,
  StreamingFavoriteProviderName,
  StreamingPlaybackRequest,
  StreamingPlaybackSource,
  StreamingProviderName,
  StreamingSearchRequest,
} from '../../shared/types/streaming';
import { streamingProviderNames, streamingStableKey, type StreamingTrack } from '../../shared/types/streaming';
import {
  getStreamingProviderDescriptors,
  getStreamingService,
  readDefaultStreamingFavoritesSnapshot,
} from '../streaming/StreamingService';

const providerNames = new Set<StreamingProviderName>(streamingProviderNames);
const likedProviderNames = new Set<Extract<StreamingProviderName, 'netease' | 'qqmusic'>>(['netease', 'qqmusic']);
const favoriteProviderNames = new Set<StreamingFavoriteProviderName>(['bilibili', 'youtube', 'soundcloud']);
const mediaTypes = new Set<StreamingMediaType>(['track', 'album', 'artist', 'playlist', 'mv']);
const sensitiveHeaderPattern = /^(authorization|cookie|x-api-key|x-auth-token|set-cookie)$/iu;

const friendlyError = (error: unknown, fallback: string): Error => {
  if (error instanceof Error && error.message.trim()) {
    return new Error(error.message);
  }

  return new Error(fallback);
};

const requireObject = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }

  return value as Record<string, unknown>;
};

const requireProvider = (value: unknown): StreamingProviderName => {
  if (typeof value !== 'string' || !providerNames.has(value as StreamingProviderName)) {
    throw new Error('Streaming provider is not supported.');
  }

  return value as StreamingProviderName;
};

const requireFavoriteProvider = (value: unknown): StreamingFavoriteProviderName => {
  const provider = requireProvider(value);
  if (!favoriteProviderNames.has(provider as StreamingFavoriteProviderName)) {
    throw new Error('Streaming favorite provider is not supported.');
  }

  return provider as StreamingFavoriteProviderName;
};

const optionalLikedProvider = (value: unknown): Extract<StreamingProviderName, 'netease' | 'qqmusic'> | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string' || !likedProviderNames.has(value as Extract<StreamingProviderName, 'netease' | 'qqmusic'>)) {
    throw new Error('Liked songs sync provider is not supported.');
  }

  return value as Extract<StreamingProviderName, 'netease' | 'qqmusic'>;
};

const requireLikedProvider = (value: unknown): Extract<StreamingProviderName, 'netease' | 'qqmusic'> => {
  const provider = optionalLikedProvider(value);
  if (!provider) {
    throw new Error('Streaming provider is required.');
  }

  return provider;
};

const requireText = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }

  return value.trim();
};

const optionalPage = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;

const optionalMediaTypes = (value: unknown): StreamingMediaType[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value.filter((item): item is StreamingMediaType => typeof item === 'string' && mediaTypes.has(item as StreamingMediaType));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
};

const normalizeSearchRequest = (value: unknown): StreamingSearchRequest => {
  const input = requireObject(value, 'streaming search request');

  return {
    provider: requireProvider(input.provider),
    query: requireText(input.query, 'query'),
    mediaTypes: optionalMediaTypes(input.mediaTypes),
    page: optionalPage(input.page, 1),
    pageSize: Math.min(50, optionalPage(input.pageSize, 20)),
  };
};

const normalizeTrackRequest = (value: unknown): { provider: StreamingProviderName; providerTrackId: string } => {
  const input = requireObject(value, 'streaming track request');

  return {
    provider: requireProvider(input.provider),
    providerTrackId: requireText(input.providerTrackId, 'providerTrackId'),
  };
};

const normalizeAlbumRequest = (value: unknown): { provider: StreamingProviderName; providerAlbumId: string } => {
  const input = requireObject(value, 'streaming album request');

  return {
    provider: requireProvider(input.provider),
    providerAlbumId: requireText(input.providerAlbumId, 'providerAlbumId'),
  };
};

const normalizeArtistRequest = (value: unknown): { provider: StreamingProviderName; providerArtistId: string } => {
  const input = requireObject(value, 'streaming artist request');

  return {
    provider: requireProvider(input.provider),
    providerArtistId: requireText(input.providerArtistId, 'providerArtistId'),
  };
};

const normalizeLikedTrackRequest = (
  value: unknown,
): { provider: Extract<StreamingProviderName, 'netease' | 'qqmusic'>; providerTrackId: string; liked: boolean } => {
  const input = requireObject(value, 'streaming liked track request');

  return {
    provider: requireLikedProvider(input.provider),
    providerTrackId: requireText(input.providerTrackId, 'providerTrackId'),
    liked: input.liked === true,
  };
};

const optionalString = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

const optionalDuration = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

const normalizeFavoriteTrack = (value: unknown): StreamingTrack => {
  const input = requireObject(value, 'streaming favorite track');
  const provider = requireFavoriteProvider(input.provider);
  const providerTrackId = requireText(input.providerTrackId, 'providerTrackId');
  const stableKey = optionalString(input.stableKey) ?? streamingStableKey(provider, providerTrackId);
  const qualities = Array.isArray(input.qualities)
    ? input.qualities.filter((quality): quality is StreamingTrack['qualities'][number] =>
      quality === 'standard' || quality === 'high' || quality === 'lossless' || quality === 'hires')
    : [];

  return {
    id: optionalString(input.id) ?? stableKey,
    provider,
    providerTrackId,
    stableKey,
    title: requireText(input.title, 'title'),
    artist: optionalString(input.artist) ?? 'Unknown Artist',
    artists: [],
    album: optionalString(input.album) ?? 'Unknown Album',
    albumId: optionalString(input.albumId),
    albumArtist: optionalString(input.albumArtist),
    duration: optionalDuration(input.duration),
    coverUrl: optionalString(input.coverUrl),
    coverThumb: optionalString(input.coverThumb),
    qualities,
    explicit: input.explicit === true,
    playable: input.playable !== false,
    unavailableReason: optionalString(input.unavailableReason),
    lyricsStatus: input.lyricsStatus === 'available' || input.lyricsStatus === 'missing' ? input.lyricsStatus : 'unknown',
    mvStatus: input.mvStatus === 'available' || input.mvStatus === 'missing' ? input.mvStatus : 'unknown',
  };
};

const normalizeFavoriteSetRequest = (value: unknown): { track: StreamingTrack; favorite: boolean } => {
  const input = requireObject(value, 'streaming favorite request');
  return {
    track: normalizeFavoriteTrack(input.track),
    favorite: input.favorite === true,
  };
};

const normalizeFavoriteCollectionRenameRequest = (value: unknown): { collectionId: string; name: string } => {
  const input = requireObject(value, 'streaming favorite collection rename request');
  return {
    collectionId: requireText(input.collectionId, 'collectionId'),
    name: requireText(input.name, 'favorite collection name'),
  };
};

const normalizeFavoriteCollectionRequest = (value: unknown, label: string): { collectionId: string } => {
  const input = requireObject(value, label);
  return {
    collectionId: requireText(input.collectionId, 'collectionId'),
  };
};

const normalizePlaybackRequest = (value: unknown): StreamingPlaybackRequest => {
  const input = requireObject(value, 'streaming playback request');
  const quality = input.quality;

  return {
    provider: requireProvider(input.provider),
    providerTrackId: requireText(input.providerTrackId, 'providerTrackId'),
    quality:
      quality === 'standard' || quality === 'high' || quality === 'lossless' || quality === 'hires' ? quality : undefined,
  };
};

const sanitizePlaybackSource = (source: StreamingPlaybackSource): StreamingPlaybackSource => ({
  ...source,
  headers: Object.fromEntries(Object.entries(source.headers).filter(([name]) => !sensitiveHeaderPattern.test(name))),
});

export const registerStreamingIpc = (): void => {
  ipcMain.handle(IpcChannels.StreamingGetProviders, () => getStreamingProviderDescriptors());
  ipcMain.handle(IpcChannels.StreamingImportPlaylistFromUrl, async (_event, url: unknown) => {
    try {
      return await getStreamingService().importPlaylistFromUrl(requireText(url, 'playlist URL'));
    } catch (error) {
      throw friendlyError(error, 'Streaming playlist import failed.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingImportFavoritesFromUrl, async (_event, url: unknown) => {
    try {
      return await getStreamingService().importFavoritesFromUrl(requireText(url, 'favorites URL'));
    } catch (error) {
      throw friendlyError(error, 'Streaming favorites import failed.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingExportFavorites, async () => {
    try {
      const result = await dialog.showSaveDialog({
        title: '导出流媒体收藏',
        defaultPath: join(app.getPath('downloads'), 'streaming-favorites.json'),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) {
        return null;
      }

      writeFileSync(result.filePath, getStreamingService().getFavoritesExportContent(), 'utf8');
      return result.filePath;
    } catch (error) {
      throw friendlyError(error, 'Streaming favorites export failed.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingRefreshNeteaseDailyRecommend, async () => {
    try {
      return await getStreamingService().refreshNeteaseDailyRecommend();
    } catch (error) {
      throw friendlyError(error, 'NetEase daily recommendations refresh failed.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingSyncLikedSongs, async (_event, provider: unknown) => {
    try {
      return await getStreamingService().syncLikedSongs(optionalLikedProvider(provider));
    } catch (error) {
      throw friendlyError(error, 'Streaming liked songs sync failed.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingSetTrackLiked, async (_event, request: unknown) => {
    try {
      const input = normalizeLikedTrackRequest(request);
      return await getStreamingService().setTrackLiked(input.provider, input.providerTrackId, input.liked);
    } catch (error) {
      throw friendlyError(error, 'Streaming track like failed.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingGetFavorites, async () => {
    try {
      return readDefaultStreamingFavoritesSnapshot();
    } catch (error) {
      throw friendlyError(error, 'Streaming favorites could not be read.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingSetFavorite, async (_event, request: unknown) => {
    try {
      const input = normalizeFavoriteSetRequest(request);
      return getStreamingService().setFavorite(input.track, input.favorite);
    } catch (error) {
      throw friendlyError(error, 'Streaming favorite update failed.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingRenameFavoriteCollection, async (_event, request: unknown) => {
    try {
      const input = normalizeFavoriteCollectionRenameRequest(request);
      return getStreamingService().renameFavoriteCollection(input.collectionId, input.name);
    } catch (error) {
      throw friendlyError(error, 'Streaming favorite collection rename failed.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingSyncFavoriteCollection, async (_event, request: unknown) => {
    try {
      const input = normalizeFavoriteCollectionRequest(request, 'streaming favorite collection sync request');
      return await getStreamingService().syncFavoriteCollection(input.collectionId);
    } catch (error) {
      throw friendlyError(error, 'Streaming favorite collection sync failed.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingDeleteFavoriteCollection, async (_event, request: unknown) => {
    try {
      const input = normalizeFavoriteCollectionRequest(request, 'streaming favorite collection delete request');
      return getStreamingService().deleteFavoriteCollection(input.collectionId);
    } catch (error) {
      throw friendlyError(error, 'Streaming favorite collection delete failed.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingSearch, async (_event, request: unknown) => {
    try {
      return await getStreamingService().search(normalizeSearchRequest(request));
    } catch (error) {
      throw friendlyError(error, 'Streaming search failed.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingGetTrack, async (_event, request: unknown) => {
    try {
      const { provider, providerTrackId } = normalizeTrackRequest(request);
      return await getStreamingService().getTrack(provider, providerTrackId);
    } catch (error) {
      throw friendlyError(error, 'Streaming track lookup failed.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingGetTrackSourceInfo, async (_event, request: unknown) => {
    try {
      return getStreamingService().getTrackSourceInfo(normalizeTrackRequest(request));
    } catch (error) {
      throw friendlyError(error, 'Streaming track source lookup failed.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingGetAlbum, async (_event, request: unknown) => {
    try {
      const { provider, providerAlbumId } = normalizeAlbumRequest(request);
      return await getStreamingService().getAlbum(provider, providerAlbumId);
    } catch (error) {
      throw friendlyError(error, 'Streaming album lookup failed.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingGetArtist, async (_event, request: unknown) => {
    try {
      const { provider, providerArtistId } = normalizeArtistRequest(request);
      return await getStreamingService().getArtist(provider, providerArtistId);
    } catch (error) {
      throw friendlyError(error, 'Streaming artist lookup failed.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingResolvePlayback, async (_event, request: unknown) => {
    try {
      return sanitizePlaybackSource(await getStreamingService().resolvePlayback(normalizePlaybackRequest(request)));
    } catch (error) {
      throw friendlyError(error, 'Streaming playback URL could not be resolved.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingAnalyzeBpm, async (_event, request: unknown) => {
    try {
      if (!getAppSettings().audioAnalysisEnabled) {
        throw new Error('BPM analysis is disabled in Settings');
      }

      return await getStreamingService().analyzeBpm(normalizePlaybackRequest(request));
    } catch (error) {
      throw friendlyError(error, 'Streaming BPM analysis failed.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingGetLyrics, async (_event, request: unknown) => {
    try {
      return await getStreamingService().getLyrics(normalizeTrackRequest(request));
    } catch (error) {
      throw friendlyError(error, 'Streaming lyrics lookup failed.');
    }
  });
  ipcMain.handle(IpcChannels.StreamingGetMv, async (_event, request: unknown) => {
    try {
      return await getStreamingService().getMv(normalizeTrackRequest(request));
    } catch (error) {
      throw friendlyError(error, 'Streaming MV lookup failed.');
    }
  });
};
