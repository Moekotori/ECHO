import type { IpcRenderer } from 'electron';
import type { EchoApi } from '../apiTypes';
import type { SystemAudioEngine } from '../systemAudioEngine';
import type { MainWindowPlaybackControlRequest, PlaybackStatus } from '../../shared/types/playback';

type AutomixAdvancePayload = {
  fromTrackId: string | null;
  toTrackId: string;
  transitionSeconds: number;
  mode?: 'smartCrossfade' | 'beatAligned' | 'energyFade' | 'gaplessFallback';
  fallbackReason?: string | null;
  beatAligned?: boolean;
  skipIntroSilence?: boolean;
  nextStartSeconds?: number;
};

type MainPlaybackCommand = 'playLocalFile' | 'playMediaItem' | 'play' | 'pause' | 'stop' | 'seek' | 'control';

export interface PlaybackDeps {
  localAudioFileOpenHandlers: Set<(paths: string[]) => void>;
  pendingLocalAudioFileOpenEvents: string[][];
  automixAdvanceHandlers: Set<(event: AutomixAdvancePayload) => void>;
  mainWindowControlHandlers?: Set<(request: MainWindowPlaybackControlRequest) => Promise<void>>;
  isMainPlaybackRenderer: boolean;
  invokeMainPlaybackRenderer: <Result>(command: MainPlaybackCommand, args?: unknown[]) => Promise<Result>;
}

export function createPlaybackApi(
  ipcRenderer: IpcRenderer,
  IpcChannels: typeof import('../../shared/constants/ipcChannels').IpcChannels,
  sa: SystemAudioEngine,
  deps: PlaybackDeps,
): EchoApi['playback'] {
  return {
    getStatus: () => sa.systemAudioModeActive ? Promise.resolve(sa.getSystemPlaybackStatus()) : ipcRenderer.invoke(IpcChannels.PlaybackGetStatus),
    playLocalFile: async (request) => {
      if (sa.requiresNativeChainedPlayback(request)) {
        const shouldLeaveSystemAudio = await sa.shouldUseSystemAudioForPlayback(request.output);
        sa.stopSystemPlayback('stopped', false);
        sa.systemAudioModeActive = false;
        return ipcRenderer.invoke(
          IpcChannels.PlaybackPlayLocalFile,
          request.output?.outputMode && request.output.outputMode !== 'system'
            ? request
            : shouldLeaveSystemAudio
              ? { ...request, output: { ...(request.output ?? {}), outputMode: 'shared' } }
              : request,
        );
      }

      if (sa.requiresNativeSystemLocalPlayback(request)) {
        const shouldLeaveSystemAudio = await sa.shouldUseSystemAudioForPlayback(request.output);
        sa.stopSystemPlayback('stopped', false);
        sa.systemAudioModeActive = false;
        if (request.output?.outputMode && request.output.outputMode !== 'system') {
          return ipcRenderer.invoke(IpcChannels.PlaybackPlayLocalFile, request);
        }
        return ipcRenderer.invoke(
          IpcChannels.PlaybackPlayLocalFile,
          shouldLeaveSystemAudio
            ? { ...request, output: { ...(request.output ?? {}), outputMode: 'shared' } }
            : request,
        );
      }

      if (await sa.shouldUseSystemAudioForPlayback(request.output)) {
        return deps.isMainPlaybackRenderer
          ? sa.playLocalFileWithSystemAudio(request)
          : deps.invokeMainPlaybackRenderer<PlaybackStatus>('playLocalFile', [request]);
      }

      return ipcRenderer.invoke(IpcChannels.PlaybackPlayLocalFile, request);
    },
    playMediaItem: async (request) => {
      if (sa.requiresNativeChainedPlayback(request)) {
        const shouldLeaveSystemAudio = await sa.shouldUseSystemAudioForPlayback(request.output);
        sa.stopSystemPlayback('stopped', false);
        sa.systemAudioModeActive = false;
        return ipcRenderer.invoke(
          IpcChannels.PlaybackPlayMediaItem,
          request.output?.outputMode && request.output.outputMode !== 'system'
            ? request
            : shouldLeaveSystemAudio
              ? { ...request, output: { ...(request.output ?? {}), outputMode: 'shared' } }
              : request,
        );
      }

      if (sa.requiresNativeSystemMediaPlayback(request)) {
        const shouldLeaveSystemAudio = await sa.shouldUseSystemAudioForPlayback(request.output);
        sa.stopSystemPlayback('stopped', false);
        sa.systemAudioModeActive = false;
        if (request.output?.outputMode && request.output.outputMode !== 'system') {
          return ipcRenderer.invoke(IpcChannels.PlaybackPlayMediaItem, request);
        }
        return ipcRenderer.invoke(
          IpcChannels.PlaybackPlayMediaItem,
          shouldLeaveSystemAudio
            ? { ...request, output: { ...(request.output ?? {}), outputMode: 'shared' } }
            : request,
        );
      }

      if (await sa.shouldUseSystemAudioForPlayback(request.output)) {
        return deps.isMainPlaybackRenderer
          ? sa.playMediaItemWithSystemAudio(request)
          : deps.invokeMainPlaybackRenderer<PlaybackStatus>('playMediaItem', [request]);
      }

      return ipcRenderer.invoke(IpcChannels.PlaybackPlayMediaItem, request);
    },
    prepareMediaItem: (request) => ipcRenderer.invoke(IpcChannels.PlaybackPrepareMediaItem, request),
    prepareLocalFile: (request) => ipcRenderer.invoke(IpcChannels.PlaybackPrepareLocalFile, request),
    play: async () => {
      if (!await sa.refreshSystemAudioModeActive()) {
        return ipcRenderer.invoke(IpcChannels.PlaybackPlay);
      }
      if (!deps.isMainPlaybackRenderer) {
        return deps.invokeMainPlaybackRenderer<PlaybackStatus>('play');
      }

      return sa.play();
    },
    pause: async () => {
      if (!await sa.refreshSystemAudioModeActive()) {
        return ipcRenderer.invoke(IpcChannels.PlaybackPause);
      }
      if (!deps.isMainPlaybackRenderer) {
        return deps.invokeMainPlaybackRenderer<PlaybackStatus>('pause');
      }

      return sa.pause();
    },
    stop: async () => {
      if (!await sa.refreshSystemAudioModeActive()) {
        return ipcRenderer.invoke(IpcChannels.PlaybackStop);
      }
      if (!deps.isMainPlaybackRenderer) {
        return deps.invokeMainPlaybackRenderer<PlaybackStatus>('stop');
      }

      return sa.stop();
    },
    seek: async (positionSeconds) => {
      if (!await sa.refreshSystemAudioModeActive()) {
        return ipcRenderer.invoke(IpcChannels.PlaybackSeek, positionSeconds);
      }
      if (!deps.isMainPlaybackRenderer) {
        return deps.invokeMainPlaybackRenderer<PlaybackStatus>('seek', [positionSeconds]);
      }

      return sa.seek(positionSeconds);
    },
    openLocalAudioFile: () => ipcRenderer.invoke(IpcChannels.PlaybackOpenLocalAudioFile),
    openLocalAudioFiles: () => ipcRenderer.invoke(IpcChannels.PlaybackOpenLocalAudioFiles),
    resolveLocalAudioFiles: (paths) => ipcRenderer.invoke(IpcChannels.PlaybackResolveLocalAudioFiles, paths),
    getQueueSession: () => ipcRenderer.invoke(IpcChannels.PlaybackGetQueueSession),
    saveQueueSession: (snapshot, options) => ipcRenderer.invoke(IpcChannels.PlaybackSaveQueueSession, snapshot, options),
    clearQueueSession: () => ipcRenderer.invoke(IpcChannels.PlaybackClearQueueSession),
    onQueueSessionChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, snapshot: unknown): void => {
        handler(snapshot as Awaited<ReturnType<EchoApi['playback']['getQueueSession']>>);
      };
      ipcRenderer.on(IpcChannels.PlaybackQueueSessionChanged, listener);
      return () => ipcRenderer.off(IpcChannels.PlaybackQueueSessionChanged, listener);
    },
    controlMainWindow: (request) => deps.invokeMainPlaybackRenderer<void>('control', [request]),
    onMainWindowControl: (handler) => {
      deps.mainWindowControlHandlers?.add(handler);
      return () => {
        deps.mainWindowControlHandlers?.delete(handler);
      };
    },
    onLocalAudioFilesOpened: (handler) => {
      deps.localAudioFileOpenHandlers.add(handler);
      for (const paths of deps.pendingLocalAudioFileOpenEvents.splice(0)) {
        handler(paths);
      }

      return () => {
        deps.localAudioFileOpenHandlers.delete(handler);
      };
    },
    onAutomixAdvance: (handler) => {
      deps.automixAdvanceHandlers.add(handler);
      return () => {
        deps.automixAdvanceHandlers.delete(handler);
      };
    },
    setRepeatMode: (mode) => ipcRenderer.invoke(IpcChannels.PlaybackSetRepeatMode, mode),
    syncQueueToBackend: (items, repeatMode, currentItemId) =>
      ipcRenderer.invoke(IpcChannels.PlaybackSyncQueueToBackend, items, repeatMode, currentItemId),
  };
}
