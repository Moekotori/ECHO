import type { IpcRenderer } from 'electron';
import type { EchoApi } from '../apiTypes';

export function createLyricsApi(
  ipcRenderer: IpcRenderer,
  IpcChannels: typeof import('../../shared/constants/ipcChannels').IpcChannels,
): EchoApi['lyrics'] {
  return {
    getForTrack: (trackId) => ipcRenderer.invoke(IpcChannels.LyricsGetForTrack, trackId),
    getForSnapshot: (request) => ipcRenderer.invoke(IpcChannels.LyricsGetForSnapshot, request),
    getStoredCandidates: (trackId, durationSeconds) =>
      ipcRenderer.invoke(IpcChannels.LyricsGetStoredCandidates, trackId, durationSeconds),
    searchCandidates: (trackId, searchText, providerId, trigger) =>
      trigger === undefined
        ? ipcRenderer.invoke(IpcChannels.LyricsSearchCandidates, trackId, searchText, providerId)
        : ipcRenderer.invoke(IpcChannels.LyricsSearchCandidates, trackId, searchText, providerId, trigger),
    searchCandidatesForSnapshot: (request, searchText, providerId, trigger) =>
      ipcRenderer.invoke(IpcChannels.LyricsSearchCandidatesForSnapshot, request, searchText, providerId, trigger),
    previewCandidate: (trackId, candidateId) => ipcRenderer.invoke(IpcChannels.LyricsPreviewCandidate, trackId, candidateId),
    applyCandidate: (trackId, candidateId, origin) =>
      origin === undefined
        ? ipcRenderer.invoke(IpcChannels.LyricsApplyCandidate, trackId, candidateId)
        : ipcRenderer.invoke(IpcChannels.LyricsApplyCandidate, trackId, candidateId, origin),
    applyCandidateForSnapshot: (request, candidateId, origin) =>
      origin === undefined
        ? ipcRenderer.invoke(IpcChannels.LyricsApplyCandidateForSnapshot, request, candidateId)
        : ipcRenderer.invoke(IpcChannels.LyricsApplyCandidateForSnapshot, request, candidateId, origin),
    embedToTrack: (trackId, request) => ipcRenderer.invoke(IpcChannels.LyricsEmbedToTrack, trackId, request),
    applyCustomLrc: (trackId, lrcText, fileName) => ipcRenderer.invoke(IpcChannels.LyricsApplyCustomLrc, trackId, lrcText, fileName),
    markInstrumental: (trackId) => ipcRenderer.invoke(IpcChannels.LyricsMarkInstrumental, trackId),
    rejectCandidate: (candidateId) => ipcRenderer.invoke(IpcChannels.LyricsRejectCandidate, candidateId),
    setOffset: (trackId, offsetMs) => ipcRenderer.invoke(IpcChannels.LyricsSetOffset, trackId, offsetMs),
    clearCache: (trackId) => ipcRenderer.invoke(IpcChannels.LyricsClearCache, trackId),
    onChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
        if (payload && typeof payload === 'object' && typeof (payload as { trackId?: unknown }).trackId === 'string') {
          const { trackId, reason } = payload as { trackId: string; reason?: unknown };
          handler(
            trackId,
            reason === 'manual' || reason === 'auto-apply' ? reason : undefined,
          );
        }
      };
      ipcRenderer.on(IpcChannels.LyricsChanged, listener);
      return () => ipcRenderer.off(IpcChannels.LyricsChanged, listener);
    },
  };
}
