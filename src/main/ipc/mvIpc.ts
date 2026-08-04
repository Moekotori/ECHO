import { dialog, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { MvSettings, MvTrackSnapshotSearchRequest } from '../../shared/types/mv';
import { getMvService } from '../mv/MvService';

const requireText = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value;
};

const optionalText = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

const requireOffset = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('offsetMs must be a number');
  }

  return parsed;
};

const normalizeSnapshotSearchRequest = (value: unknown): MvTrackSnapshotSearchRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MV snapshot search request must be an object');
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
    coverThumb: optionalText(input.coverThumb),
    mediaType: input.mediaType === 'remote' || input.mediaType === 'streaming' || input.mediaType === 'local' ? input.mediaType : 'streaming',
    query: optionalText(input.query),
  };
};

export const registerMvIpc = (): void => {
  ipcMain.handle(IpcChannels.MvGetSelected, (_event, trackId: unknown) =>
    getMvService().getSelectedVideo(requireText(trackId, 'trackId')),
  );
  ipcMain.handle(IpcChannels.MvGetSettings, (): MvSettings => getMvService().getSettings());
  ipcMain.handle(IpcChannels.MvSetSettings, (_event, patch: unknown): MvSettings =>
    getMvService().setSettings((patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}) as Partial<MvSettings>),
  );
  ipcMain.handle(IpcChannels.MvFindLocalCandidates, (_event, trackId: unknown) =>
    getMvService().findLocalMvCandidates(requireText(trackId, 'trackId')),
  );
  ipcMain.handle(IpcChannels.MvSearchNetworkCandidates, (_event, trackId: unknown, query: unknown) =>
    getMvService().searchNetworkCandidates(requireText(trackId, 'trackId'), typeof query === 'string' ? query : undefined),
  );
  ipcMain.handle(IpcChannels.MvSearchNetworkCandidatesForSnapshot, (_event, request: unknown) =>
    getMvService().searchNetworkCandidatesForSnapshot(normalizeSnapshotSearchRequest(request)),
  );
  ipcMain.handle(IpcChannels.MvGetTemporaryPlayableForSnapshot, (_event, request: unknown) =>
    getMvService().getTemporaryPlayableForSnapshot(normalizeSnapshotSearchRequest(request)),
  );
  ipcMain.handle(IpcChannels.MvGetCandidates, (_event, trackId: unknown) =>
    getMvService().getVideoCandidates(requireText(trackId, 'trackId')),
  );
  ipcMain.handle(IpcChannels.MvResolveStreams, (_event, videoId: unknown) =>
    getMvService().resolveStreams(requireText(videoId, 'videoId')),
  );
  ipcMain.handle(IpcChannels.MvSetQuality, (_event, videoId: unknown, qualityId: unknown) =>
    getMvService().setQuality(requireText(videoId, 'videoId'), requireText(qualityId, 'qualityId')),
  );
  ipcMain.handle(IpcChannels.MvSetOffset, (_event, trackId: unknown, offsetMs: unknown) =>
    getMvService().setVideoOffset(requireText(trackId, 'trackId'), requireOffset(offsetMs)),
  );
  ipcMain.handle(IpcChannels.MvBindLocalVideo, (_event, trackId: unknown, filePath: unknown) =>
    getMvService().bindLocalVideo(requireText(trackId, 'trackId'), requireText(filePath, 'filePath')),
  );
  ipcMain.handle(IpcChannels.MvBindUrl, (_event, trackId: unknown, url: unknown) =>
    getMvService().bindUrl(requireText(trackId, 'trackId'), requireText(url, 'url')),
  );
  ipcMain.handle(IpcChannels.MvSelectVideo, (_event, trackId: unknown, videoId: unknown) =>
    getMvService().selectVideo(requireText(trackId, 'trackId'), requireText(videoId, 'videoId')),
  );
  ipcMain.handle(IpcChannels.MvClearSelected, (_event, trackId: unknown): void => {
    getMvService().clearSelectedVideo(requireText(trackId, 'trackId'));
  });
  ipcMain.handle(IpcChannels.MvOpenExternal, (_event, videoId: unknown) =>
    getMvService().openVideoExternal(requireText(videoId, 'videoId')),
  );
  ipcMain.handle(IpcChannels.MvChooseLocalVideo, async (_event, trackId: unknown) => {
    const normalizedTrackId = requireText(trackId, 'trackId');
    const result = await dialog.showOpenDialog({
      title: 'Choose MV video',
      properties: ['openFile'],
      filters: [{ name: 'Video files', extensions: ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'avi'] }],
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    return getMvService().bindLocalVideo(normalizedTrackId, result.filePaths[0]);
  });
};
