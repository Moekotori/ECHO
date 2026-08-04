import { BrowserWindow, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { LyricsEmbedToTrackRequest, LyricsSearchTrigger, LyricsTrackSnapshotRequest, TrackLyrics } from '../../shared/types/lyrics';
import { getLyricsService } from '../lyrics/LyricsService';
import type { LyricsLookupOptions } from '../lyrics/LyricsService';
import { getAudioSession } from '../audioPublicApi';

const requireText = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value;
};

const requireOffset = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('offsetMs must be a number');
  }

  return parsed;
};

const optionalText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const normalizeSearchTrigger = (value: unknown): LyricsSearchTrigger =>
  value === 'missing-lyrics' || value === 'smart-alignment' || value === 'rematch'
    ? value
    : 'manual';

const normalizeSnapshotRequest = (value: unknown): LyricsTrackSnapshotRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Lyrics snapshot request must be an object');
  }

  const input = value as Record<string, unknown>;
  const durationSeconds = Number(input.durationSeconds);
  return {
    trackId: requireText(input.trackId, 'trackId'),
    title: requireText(input.title, 'title'),
    artist: optionalText(input.artist) ?? 'Unknown Artist',
    album: optionalText(input.album),
    albumArtist: optionalText(input.albumArtist),
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null,
    mediaType: input.mediaType === 'local' || input.mediaType === 'streaming' || input.mediaType === 'remote' ? input.mediaType : 'remote',
    sourceId: optionalText(input.sourceId),
    stableKey: optionalText(input.stableKey),
  };
};

const normalizeEmbedRequest = (value: unknown): LyricsEmbedToTrackRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  return {
    candidateId: optionalText(input.candidateId),
    preferSynced: input.preferSynced === false ? false : true,
  };
};

const emitLyricsChanged = (trackId: string): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.LyricsChanged, { trackId });
    }
  }
};

const runWithLyricsChanged = async <T>(trackId: string, action: () => Promise<T>): Promise<T> => {
  const result = await action();
  emitLyricsChanged(trackId);
  return result;
};

const lyricsForTrackInFlight = new Map<string, Promise<TrackLyrics | null>>();

const playbackCriticalLyricsLookupOptions: LyricsLookupOptions = {
  enabledProviders: ['local'],
  networkEnabled: false,
  autoSearch: false,
  deepSearchEnabled: false,
  providerTimeoutMs: 1000,
  totalMatchTimeoutMs: 1500,
  preferPrimaryProvider: false,
};

const isCriticalPlaybackForLyricsLookup = (): boolean => {
  try {
    const status = getAudioSession().getStatus();
    const nativeUnderrunCallbacks = Math.max(0, Number(status.nativeUnderrunCallbacks ?? 0));
    const nativeBufferedMs = Number(status.nativeBufferedMs);
    const outputIsUnderPressure =
      nativeUnderrunCallbacks > 0 ||
      (Number.isFinite(nativeBufferedMs) && nativeBufferedMs <= 30) ||
      status.warnings?.includes('exclusive_output_unstable') === true;

    return (
      (status.state === 'loading' || status.state === 'playing') &&
      (status.outputMode === 'exclusive') &&
      outputIsUnderPressure
    );
  } catch {
    return false;
  }
};

const getLyricsForTrackCoalesced = (trackId: string, options?: LyricsLookupOptions): Promise<TrackLyrics | null> => {
  const lookupMode = options ? 'playback-critical' : 'normal';
  const lookupKey = `${lookupMode}:${trackId}`;
  const existing = lyricsForTrackInFlight.get(lookupKey);
  if (existing) {
    return existing;
  }

  const lookup = getLyricsService()
    .getLyricsForTrack(trackId, options)
    .finally(() => {
      if (lyricsForTrackInFlight.get(lookupKey) === lookup) {
        lyricsForTrackInFlight.delete(lookupKey);
      }
    });
  lyricsForTrackInFlight.set(lookupKey, lookup);
  return lookup;
};

export const registerLyricsIpc = (): void => {
  ipcMain.handle(IpcChannels.LyricsGetForTrack, (_event, trackId: unknown) => {
    const normalizedTrackId = requireText(trackId, 'trackId');
    const options = isCriticalPlaybackForLyricsLookup()
      ? playbackCriticalLyricsLookupOptions
      : undefined;
    return getLyricsForTrackCoalesced(normalizedTrackId, options);
  });
  ipcMain.handle(IpcChannels.LyricsGetForSnapshot, (_event, request: unknown) =>
    getLyricsService().getLyricsForSnapshot(normalizeSnapshotRequest(request)),
  );
  ipcMain.handle(IpcChannels.LyricsSearchCandidates, (_event, trackId: unknown, searchText?: unknown, providerId?: unknown, trigger?: unknown) =>
    getLyricsService().searchLyricsCandidates(
      requireText(trackId, 'trackId'),
      typeof searchText === 'string' ? searchText : null,
      typeof providerId === 'string' ? providerId : null,
      normalizeSearchTrigger(trigger),
    ),
  );
  ipcMain.handle(IpcChannels.LyricsSearchCandidatesForSnapshot, (_event, request: unknown, searchText?: unknown, providerId?: unknown, trigger?: unknown) =>
    getLyricsService().searchLyricsCandidatesForSnapshot(
      normalizeSnapshotRequest(request),
      typeof searchText === 'string' ? searchText : null,
      typeof providerId === 'string' ? providerId : null,
      normalizeSearchTrigger(trigger),
    ),
  );
  ipcMain.handle(IpcChannels.LyricsPreviewCandidate, (_event, trackId: unknown, candidateId: unknown) =>
    getLyricsService().previewLyricsCandidate(requireText(trackId, 'trackId'), requireText(candidateId, 'candidateId')),
  );
  ipcMain.handle(IpcChannels.LyricsApplyCandidate, (_event, trackId: unknown, candidateId: unknown) => {
    const normalizedTrackId = requireText(trackId, 'trackId');
    const normalizedCandidateId = requireText(candidateId, 'candidateId');
    return runWithLyricsChanged(normalizedTrackId, () =>
      getLyricsService().applyLyricsCandidate(normalizedTrackId, normalizedCandidateId),
    );
  });
  ipcMain.handle(IpcChannels.LyricsApplyCandidateForSnapshot, (_event, request: unknown, candidateId: unknown) => {
    const normalizedRequest = normalizeSnapshotRequest(request);
    const normalizedCandidateId = requireText(candidateId, 'candidateId');
    return runWithLyricsChanged(normalizedRequest.trackId, () =>
      getLyricsService().applyLyricsCandidateForSnapshot(normalizedRequest, normalizedCandidateId),
    );
  });
  ipcMain.handle(IpcChannels.LyricsEmbedToTrack, (_event, trackId: unknown, request?: unknown) => {
    const normalizedTrackId = requireText(trackId, 'trackId');
    const normalizedRequest = normalizeEmbedRequest(request);
    return runWithLyricsChanged(normalizedTrackId, () =>
      getLyricsService().embedLyricsToTrack(normalizedTrackId, normalizedRequest),
    );
  });
  ipcMain.handle(IpcChannels.LyricsApplyCustomLrc, (_event, trackId: unknown, lrcText: unknown, fileName?: unknown) => {
    const normalizedTrackId = requireText(trackId, 'trackId');
    const normalizedLrcText = requireText(lrcText, 'lrcText');
    const normalizedFileName = typeof fileName === 'string' ? fileName : null;
    return runWithLyricsChanged(normalizedTrackId, () =>
      getLyricsService().applyCustomLrc(normalizedTrackId, normalizedLrcText, normalizedFileName),
    );
  });
  ipcMain.handle(IpcChannels.LyricsMarkInstrumental, (_event, trackId: unknown) => {
    const normalizedTrackId = requireText(trackId, 'trackId');
    return runWithLyricsChanged(normalizedTrackId, () =>
      getLyricsService().markTrackInstrumental(normalizedTrackId),
    );
  });
  ipcMain.handle(IpcChannels.LyricsRejectCandidate, (_event, candidateId: unknown) =>
    getLyricsService().rejectLyricsCandidate(requireText(candidateId, 'candidateId')),
  );
  ipcMain.handle(IpcChannels.LyricsSetOffset, (_event, trackId: unknown, offsetMs: unknown) => {
    const normalizedTrackId = requireText(trackId, 'trackId');
    const normalizedOffsetMs = requireOffset(offsetMs);
    return runWithLyricsChanged(normalizedTrackId, () =>
      getLyricsService().setLyricsOffset(normalizedTrackId, normalizedOffsetMs),
    );
  });
  ipcMain.handle(IpcChannels.LyricsClearCache, (_event, trackId: unknown) => {
    const normalizedTrackId = requireText(trackId, 'trackId');
    return runWithLyricsChanged(normalizedTrackId, () =>
      getLyricsService().clearLyricsCache(normalizedTrackId),
    );
  });
};
