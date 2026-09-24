import type { IpcRenderer } from 'electron';
import type { EchoApi } from '../apiTypes';
import type { MainWindowPlaybackControlRequest, PlaybackStartRequest, PlaybackMediaStartRequest } from '../../shared/types/playback';
import type { PlaybackDeps } from './playbackApi';

type MainPlaybackCommand = 'playLocalFile' | 'playMediaItem' | 'play' | 'pause' | 'stop' | 'seek' | 'control';

const playbackProxyCommands = new Set(['playLocalFile', 'playMediaItem', 'play', 'pause', 'stop', 'seek', 'control']);

function isMainPlaybackRenderer(): boolean {
  const rendererSearchParams = new URLSearchParams(typeof window.location?.search === 'string' ? window.location.search : '');
  return rendererSearchParams.get('miniPlayer') !== '1' && rendererSearchParams.get('desktopLyrics') !== '1';
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function setupPlaybackProxy(
  ipcRenderer: IpcRenderer,
  IpcChannels: typeof import('../../shared/constants/ipcChannels').IpcChannels,
  echoApi: EchoApi,
  deps: PlaybackDeps,
): void {
  if (!isMainPlaybackRenderer()) {
    return;
  }

  const handleMainWindowPlaybackCommand = async (_event: Electron.IpcRendererEvent, rawRequest: unknown): Promise<void> => {
    if (!isPlainRecord(rawRequest) || typeof rawRequest.id !== 'string') {
      return;
    }

    const command = typeof rawRequest.command === 'string' ? rawRequest.command : '';
    const args = Array.isArray(rawRequest.args) ? rawRequest.args : [];
    if (!playbackProxyCommands.has(command)) {
      ipcRenderer.send(IpcChannels.PlaybackMainWindowCommandResult, {
        id: rawRequest.id,
        ok: false,
        error: 'unsupported_main_window_playback_command',
      });
      return;
    }

    try {
      let value: unknown = null;
      switch (command as MainPlaybackCommand) {
        case 'playLocalFile':
          value = await echoApi.playback.playLocalFile(args[0] as PlaybackStartRequest);
          break;
        case 'playMediaItem':
          value = await echoApi.playback.playMediaItem(args[0] as PlaybackMediaStartRequest);
          break;
        case 'play':
          value = await echoApi.playback.play();
          break;
        case 'pause':
          value = await echoApi.playback.pause();
          break;
        case 'stop':
          value = await echoApi.playback.stop();
          break;
        case 'seek':
          value = await echoApi.playback.seek(Number(args[0]));
          break;
        case 'control': {
          const handler = Array.from(deps.mainWindowControlHandlers ?? []).at(-1);
          if (!handler) {
            throw new Error('main_window_playback_controller_unavailable');
          }
          await handler(args[0] as MainWindowPlaybackControlRequest);
          break;
        }
      }

      ipcRenderer.send(IpcChannels.PlaybackMainWindowCommandResult, {
        id: rawRequest.id,
        ok: true,
        value,
      });
    } catch (error) {
      ipcRenderer.send(IpcChannels.PlaybackMainWindowCommandResult, {
        id: rawRequest.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  ipcRenderer.on(IpcChannels.PlaybackMainWindowCommandRequest, handleMainWindowPlaybackCommand);
}
