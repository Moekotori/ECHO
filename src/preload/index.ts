import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IpcChannels } from '../shared/constants/ipcChannels';
import { createSystemAudioEngine, type AutomixAdvancePayload } from './systemAudioEngine';
import type { EchoApi } from './apiTypes';
import { createAppApi, createDesktopLyricsApi, createMiniPlayerApi, createLibraryApi, createLibraryLabApi, createPlaybackApi, type PlaybackDeps, createRemoteSourcesApi, createConnectApi, createStreamingApi, createLyricsApi, createMvApi, createHqPlayerApi, createAudioApi, createEqApi,
  createSleepTimerApi, createDiagnosticsApi, createDownloadsApi, createPluginsApi, createAccountsApi,
  createSpotifyApi, createSmtcApi, createAudioCdApi, setupPlaybackProxy,
  createLastFmApi, createDiscordPresenceApi, createStageBridgeApi } from './ipc';
const sa = createSystemAudioEngine(ipcRenderer, IpcChannels),
  sanitize = (p: unknown): string[] => Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : [],
  localFileHandlers = new Set<(paths: string[]) => void>(),
  pendingLocalFiles: string[][] = [],
  automixHandlers = new Set<(e: AutomixAdvancePayload) => void>(),
  rsp = new URLSearchParams(typeof window.location?.search === 'string' ? window.location.search : ''),
  isMain = rsp.get('miniPlayer') !== '1' && rsp.get('desktopLyrics') !== '1',
  invokeMain = <R>(cmd: string, args: unknown[] = []): Promise<R> =>
    ipcRenderer.invoke(IpcChannels.PlaybackMainWindowCommand, { command: cmd, args }) as Promise<R>;
ipcRenderer.on(IpcChannels.PlaybackLocalAudioFilesOpened, (_e, p) => {
  const s = sanitize(p); if (!s.length) return;
  if (!localFileHandlers.size) { pendingLocalFiles.push(s); return; }
  for (const h of localFileHandlers) h(s);
});
ipcRenderer.on(IpcChannels.PlaybackAutomixAdvance, (_e, p) => {
  if (!p || typeof p !== 'object') return;
  const e = p as Record<string, unknown>; if (typeof e.toTrackId !== 'string') return;
  const ev: AutomixAdvancePayload = { fromTrackId: typeof e.fromTrackId === 'string' ? e.fromTrackId : null, toTrackId: e.toTrackId,
    transitionSeconds: typeof e.transitionSeconds === 'number' && Number.isFinite(e.transitionSeconds) ? e.transitionSeconds : 0,
    mode: e.mode === 'smartCrossfade' || e.mode === 'beatAligned' || e.mode === 'energyFade' || e.mode === 'gaplessFallback'
      ? (e.mode as AutomixAdvancePayload['mode']) : undefined,
    fallbackReason: typeof e.fallbackReason === 'string' ? e.fallbackReason : null,
    beatAligned: e.beatAligned === true, skipIntroSilence: e.skipIntroSilence === true,
    nextStartSeconds: typeof e.nextStartSeconds === 'number' && Number.isFinite(e.nextStartSeconds) ? e.nextStartSeconds : undefined };
  for (const h of automixHandlers) h(ev);
});
const deps: PlaybackDeps = { localAudioFileOpenHandlers: localFileHandlers, pendingLocalAudioFileOpenEvents: pendingLocalFiles, automixAdvanceHandlers: automixHandlers, isMainPlaybackRenderer: isMain, invokeMainPlaybackRenderer: invokeMain };
const echoApi: EchoApi = {
  app: createAppApi(ipcRenderer, IpcChannels), desktopLyrics: createDesktopLyricsApi(ipcRenderer, IpcChannels),
  miniPlayer: createMiniPlayerApi(ipcRenderer, IpcChannels), library: createLibraryApi(ipcRenderer, IpcChannels, webUtils),
  taskbarMiniPlayer: {
    show: () => ipcRenderer.invoke(IpcChannels.TaskbarMiniPlayerShow),
    hide: () => ipcRenderer.invoke(IpcChannels.TaskbarMiniPlayerHide),
    getState: () => ipcRenderer.invoke(IpcChannels.TaskbarMiniPlayerGetState),
    setEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.TaskbarMiniPlayerSetEnabled, enabled),
    onStateChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown): void => {
        handler(state as Awaited<ReturnType<EchoApi['taskbarMiniPlayer']['getState']>>);
      };
      ipcRenderer.on(IpcChannels.TaskbarMiniPlayerStateChanged, listener);
      return () => ipcRenderer.off(IpcChannels.TaskbarMiniPlayerStateChanged, listener);
    },
  },
  libraryLab: createLibraryLabApi(ipcRenderer, IpcChannels), playback: createPlaybackApi(ipcRenderer, IpcChannels, sa, deps),
  remoteSources: createRemoteSourcesApi(ipcRenderer, IpcChannels), connect: createConnectApi(ipcRenderer, IpcChannels),
  streaming: createStreamingApi(ipcRenderer, IpcChannels), lyrics: createLyricsApi(ipcRenderer, IpcChannels),
  mv: createMvApi(ipcRenderer, IpcChannels),
  hqPlayer: createHqPlayerApi(ipcRenderer, IpcChannels),
  audio: createAudioApi(ipcRenderer, IpcChannels, sa), eq: createEqApi(ipcRenderer, IpcChannels, sa),
  diagnostics: createDiagnosticsApi(ipcRenderer, IpcChannels), downloads: createDownloadsApi(ipcRenderer, IpcChannels),
  plugins: createPluginsApi(ipcRenderer, IpcChannels, webUtils), accounts: createAccountsApi(ipcRenderer, IpcChannels),
  spotify: createSpotifyApi(ipcRenderer, IpcChannels), smtc: createSmtcApi(ipcRenderer, IpcChannels), audioCd: createAudioCdApi(ipcRenderer, IpcChannels), sleepTimer: createSleepTimerApi(ipcRenderer, IpcChannels),
  lastfm: createLastFmApi(ipcRenderer, IpcChannels),
  discordPresence: createDiscordPresenceApi(ipcRenderer, IpcChannels),
  stageBridge: createStageBridgeApi(ipcRenderer, IpcChannels),
};
contextBridge.exposeInMainWorld('echo', echoApi); setupPlaybackProxy(ipcRenderer, IpcChannels, echoApi);
