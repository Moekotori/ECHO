import type { WebContents } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { MainWindowPlaybackControlRequest } from '../../shared/types/playback';
import { getMainWindow } from '../app/windowManager';

export type MainWindowPlaybackCommand =
  | 'playLocalFile'
  | 'playMediaItem'
  | 'play'
  | 'pause'
  | 'stop'
  | 'seek'
  | 'control';

export type MainWindowPlaybackCommandRequest = {
  command: MainWindowPlaybackCommand;
  args?: unknown[];
};

type MainWindowLike = {
  isDestroyed: () => boolean;
  webContents: Pick<WebContents, 'send'>;
};

type PendingCommand = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type MainWindowPlaybackCommandRelayOptions = {
  getWindow?: () => MainWindowLike | null;
  timeoutMs?: number;
  now?: () => number;
};

const commands = new Set<MainWindowPlaybackCommand>([
  'playLocalFile',
  'playMediaItem',
  'play',
  'pause',
  'stop',
  'seek',
  'control',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isValidMainWindowControlRequest = (
  value: unknown,
): value is MainWindowPlaybackControlRequest => {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  if (
    value.type === 'play' ||
    value.type === 'pause' ||
    value.type === 'stop' ||
    value.type === 'playPause' ||
    value.type === 'previous' ||
    value.type === 'next'
  ) {
    return true;
  }
  if (value.type === 'seek') {
    return typeof value.positionSeconds === 'number' && Number.isFinite(value.positionSeconds) && value.positionSeconds >= 0;
  }
  if (value.type === 'setVolume') {
    return typeof value.volume === 'number' && Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 1;
  }
  if (value.type === 'setPlaybackOrder') {
    return value.mode === 'sequential' || value.mode === 'shuffle' || value.mode === 'repeat-one';
  }
  return value.type === 'playQueueItem' && typeof value.queueId === 'string' && value.queueId.length > 0 && value.queueId.length <= 256;
};

export class MainWindowPlaybackCommandRelay {
  private readonly getWindow: () => MainWindowLike | null;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private commandId = 0;
  private readonly pending = new Map<string, PendingCommand>();

  constructor(options: MainWindowPlaybackCommandRelayOptions = {}) {
    this.getWindow = options.getWindow ?? getMainWindow;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.now = options.now ?? Date.now;
  }

  execute(
    rawRequest: unknown,
    sourceWebContents?: Pick<WebContents, 'send'> | null,
  ): Promise<unknown> {
    const mainWindow = this.getWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('main_window_unavailable');
    }
    if (sourceWebContents === mainWindow.webContents) {
      throw new Error('main_window_playback_proxy_loop');
    }
    if (!isRecord(rawRequest) || typeof rawRequest.command !== 'string' || !commands.has(rawRequest.command as MainWindowPlaybackCommand)) {
      throw new Error('unsupported_main_window_playback_command');
    }

    const args = Array.isArray(rawRequest.args) ? rawRequest.args : [];
    if (rawRequest.command === 'control' && !isValidMainWindowControlRequest(args[0])) {
      throw new Error('invalid_main_window_playback_control');
    }

    const id = `playback-main-window-${this.now()}-${++this.commandId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('main_window_playback_command_timeout'));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      mainWindow.webContents.send(IpcChannels.PlaybackMainWindowCommandRequest, {
        id,
        command: rawRequest.command,
        args,
      });
    });
  }

  executeControl(request: MainWindowPlaybackControlRequest): Promise<unknown> {
    return this.execute({ command: 'control', args: [request] });
  }

  receiveResult(sender: Pick<WebContents, 'send'>, rawResult: unknown): void {
    const mainWindow = this.getWindow();
    if (!mainWindow || mainWindow.isDestroyed() || sender !== mainWindow.webContents) {
      return;
    }
    if (!isRecord(rawResult) || typeof rawResult.id !== 'string') {
      return;
    }

    const pending = this.pending.get(rawResult.id);
    if (!pending) {
      return;
    }
    this.pending.delete(rawResult.id);
    clearTimeout(pending.timer);

    if (rawResult.ok === true) {
      pending.resolve(rawResult.value);
      return;
    }
    pending.reject(new Error(typeof rawResult.error === 'string' ? rawResult.error : 'main_window_playback_command_failed'));
  }

  dispose(): void {
    for (const command of this.pending.values()) {
      clearTimeout(command.timer);
      command.reject(new Error('main_window_playback_relay_disposed'));
    }
    this.pending.clear();
  }
}

let defaultRelay: MainWindowPlaybackCommandRelay | null = null;

export const getMainWindowPlaybackCommandRelay = (): MainWindowPlaybackCommandRelay => {
  defaultRelay ??= new MainWindowPlaybackCommandRelay();
  return defaultRelay;
};

export const disposeMainWindowPlaybackCommandRelay = (): void => {
  defaultRelay?.dispose();
  defaultRelay = null;
};
