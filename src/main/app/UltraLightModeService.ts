import { app, BrowserWindow, globalShortcut } from 'electron';
import type { AudioStatus } from '../../shared/types/audio';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { GlobalShortcutAction } from '../../shared/types/globalShortcuts';
import type {
  MainWindowPlaybackControlRequest,
  PersistedPlaybackSessionResume,
  PersistedPlaybackSessionV1,
  PersistedQueueItem,
  PlaybackOrderMode,
} from '../../shared/types/playback';
import type { AudioBackendQueueItem } from '../audio/AudioBackend';
import type { UltraLightModePhase, UltraLightModeStatus } from '../../shared/types/ultraLightMode';
import type { SmtcCommand } from '../../shared/types/smtc';
import { trayBackgroundResumeDelayMs } from '../../shared/performance/trayLoadShedding';
import { getAudioSession, getPlaybackSessionStore } from '../audioPublicApi';
import { suspendPlaybackMemoryPersistence } from '../ipc/playbackIpc';
import { getCrashReportService } from '../diagnostics/CrashReportService';
import { closeDevConsoleWindow } from '../diagnostics/DevConsoleService';
import { getLibraryService } from '../library/LibraryService';
import { getAppSettings } from './appSettings';
import {
  activateUltraLightTaskbarRestorePresentation,
  destroyUltraLightTaskbarRestoreWindow,
  refreshUltraLightTaskbarPresentation,
  showUltraLightTaskbarRestoreWindow,
} from './UltraLightTaskbarRestoreWindow';
import { getMainWindow } from './windowManager';
import {
  createUltraLightGpuRuntimeArgs,
  isUltraLightGpuRuntime,
  prepareNormalRuntimeRelaunch,
} from './ultraLightGpuRuntime';
import { UltraLightRestoreTimeline, waitForRendererStartupReady } from './ultraLightRestoreReadiness';
import { warmMainProcessForRendererRestore } from './ultraLightRestoreWarmup';
import { UltraLightNativeTaskbar } from './UltraLightNativeTaskbar';

export const ultraLightModeRestoreAccelerator = 'CommandOrControl+Shift+E';
export const ultraLightModeRestoreReadyTimeoutMs = 15_000;
export const ultraLightGpuPlaybackResumeDelayMs = 900;
export const ultraLightGpuPlaybackResumeRetryDelayMs = 1_200;
export const ultraLightGpuPlaybackResumeLoadingConfirmDelayMs = 1_200;
export const ultraLightGpuPlaybackLateRecoveryDelayMs = 2_500;
export const ultraLightGpuPlaybackResumeMaxAttempts = 3;
export const ultraLightTraySettledCleanupDelayMs = 5_000;

type UltraLightModeEntryMode = 'manual' | 'tray-auto' | 'minimize-auto';

const captureActiveRouteForRendererRestoreScript = `(() => {
  const route = document.querySelector('[data-active-route]')?.getAttribute('data-active-route')?.trim();
  if (route) {
    window.localStorage.setItem('echo-next.pending-route', route);
  }
})()`;

const fallbackMediaShortcuts = new Map<string, GlobalShortcutAction>([
  ['MediaPlayPause', 'playPause'],
  ['MediaPreviousTrack', 'previousTrack'],
  ['MediaNextTrack', 'nextTrack'],
  ['MediaStop', 'stop'],
]);

const rendererFreeActions = new Set<GlobalShortcutAction>([
  'playPause',
  'previousTrack',
  'nextTrack',
  'stop',
  'volumeUp',
  'volumeDown',
  'seekBackward',
  'seekForward',
  'toggleCurrentTrackLiked',
  'toggleShuffle',
  'cycleRepeatMode',
  'toggleMute',
  'bossKey',
  'speedUp',
  'speedDown',
]);

/** Whether an UltraLight command can execute against main/native state without recreating Chromium. */
export const canDispatchUltraLightModeActionWithoutRenderer = (action: GlobalShortcutAction): boolean =>
  rendererFreeActions.has(action);

const isLocalQueueItem = (item: PersistedQueueItem): boolean => {
  const path = typeof item.track.path === 'string' ? item.track.path.trim() : '';
  return item.track.unavailable !== true &&
    (item.track.mediaType === undefined || item.track.mediaType === 'local') &&
    path.length > 0 &&
    !/^[a-z][a-z\d+.-]*:\/\//iu.test(path);
};

const isSegmentedCueQueueItem = (item: PersistedQueueItem): boolean =>
  /#cueTrack=\d+$/iu.test(item.track.path);

const toUltraLightBackendQueueItem = (item: PersistedQueueItem): AudioBackendQueueItem | null => {
  const base: AudioBackendQueueItem = {
    itemId: item.queueId,
    trackId: item.track.id,
    filePath: item.track.path,
    sampleRate: item.track.sampleRate ?? undefined,
    startSeconds: 0,
    metadata: {
      title: item.track.title,
      artist: item.track.artist,
      album: item.track.album,
      albumArtist: item.track.albumArtist,
      coverUrl: item.track.coverThumb,
    },
  };
  if (!isSegmentedCueQueueItem(item)) {
    return base;
  }
  // This community host does not yet accept queue source ranges. Keep CUE playback resident.
  return null;
};

const buildUltraLightBackendQueue = (session: PersistedPlaybackSessionV1): AudioBackendQueueItem[] | null => {
  const items: AudioBackendQueueItem[] = [];
  for (const item of session.items) {
    if (!isLocalQueueItem(item)) continue;
    const backendItem = toUltraLightBackendQueueItem(item);
    if (!backendItem) return null;
    items.push(backendItem);
  }
  return items;
};

const replayGainFromQueueItem = (item: PersistedQueueItem) => {
  const replayGain = {
    trackGainDb: item.track.replayGainTrackGainDb ?? null,
    albumGainDb: item.track.replayGainAlbumGainDb ?? null,
    trackPeak: item.track.replayGainTrackPeak ?? null,
    albumPeak: item.track.replayGainAlbumPeak ?? null,
    integratedLufs: item.track.replayGainIntegratedLufs ?? null,
  };
  return Object.values(replayGain).some((value) => typeof value === 'number' && Number.isFinite(value))
    ? replayGain
    : undefined;
};

const findHostQueueItem = (session: PersistedPlaybackSessionV1, status: AudioStatus): PersistedQueueItem | null => {
  const matchesTrack = (item: PersistedQueueItem): boolean =>
    Boolean(status.currentTrackId && item.track.id === status.currentTrackId)
    || Boolean(status.currentFilePath && item.track.path === status.currentFilePath);
  return session.items.find((item) => item.queueId === status.currentQueueItemId)
    ?? session.items.find((item) => item.queueId === session.currentQueueId && matchesTrack(item))
    ?? session.items.find((item) => item.track.id === status.currentTrackId && item.track.path === status.currentFilePath)
    ?? session.items.find(matchesTrack)
    ?? null;
};

const findCurrentQueueIndex = (session: PersistedPlaybackSessionV1): number => {
  const queueIndex = session.currentQueueId
    ? session.items.findIndex((item) => item.queueId === session.currentQueueId)
    : -1;
  if (queueIndex >= 0) {
    return queueIndex;
  }
  return session.currentTrackId
    ? session.items.findIndex((item) => item.track.id === session.currentTrackId)
    : -1;
};

const selectAdjacentItem = (
  session: PersistedPlaybackSessionV1,
  direction: 'previous' | 'next',
): PersistedQueueItem | null => {
  const playableItems = session.items.filter(isLocalQueueItem);
  if (playableItems.length === 0) {
    return null;
  }

  const currentIndex = findCurrentQueueIndex(session);
  const current = currentIndex >= 0 ? session.items[currentIndex] ?? null : null;
  if (session.mode.isShuffleEnabled) {
    const candidates = playableItems.filter((item) => item.queueId !== current?.queueId);
    return candidates.length > 0
      ? candidates[Math.floor(Math.random() * candidates.length)] ?? null
      : playableItems[0] ?? null;
  }

  if (direction === 'previous') {
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      if (isLocalQueueItem(session.items[index]!)) {
        return session.items[index]!;
      }
    }
    if (session.mode.repeatMode === 'all') {
      return [...session.items].reverse().find(isLocalQueueItem) ?? null;
    }
    return null;
  }

  for (let index = Math.max(-1, currentIndex) + 1; index < session.items.length; index += 1) {
    if (isLocalQueueItem(session.items[index]!)) {
      return session.items[index]!;
    }
  }
  if (session.mode.repeatMode === 'all') {
    return session.items.find(isLocalQueueItem) ?? null;
  }
  return currentIndex < 0 ? playableItems[0] ?? null : null;
};

class UltraLightModeService {
  private readonly nativeTaskbar = new UltraLightNativeTaskbar();
  private phase: UltraLightModePhase = 'inactive';
  private lifecycleGeneration = 0;
  private playbackIntentGeneration = 0;
  private entryCompletion: Promise<UltraLightModeStatus> | null = null;
  private backgroundResumeTimer: ReturnType<typeof setTimeout> | null = null;
  private auxiliaryRestorePending = false;
  private error: string | null = null;
  private readonly ownedShortcuts = new Set<string>();
  private statusListener: ((status: AudioStatus) => void) | null = null;
  private lastHandledEnd: string | null = null;
  private lastPersistedQueueId: string | null = null;
  private lastPersistedTrackId: string | null = null;
  private operationLane: Promise<void> = Promise.resolve();
  private volumeBeforeMute = 1;
  private uiDestroyTimer: ReturnType<typeof setTimeout> | null = null;
  private playbackResumeRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private traySettledCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private entryMode: UltraLightModeEntryMode | null = null;
  private restoreCompletion: Promise<UltraLightModeStatus> | null = null;
  private readonly pendingRestoreActions = new Set<GlobalShortcutAction>();

  getStatus(): UltraLightModeStatus {
    return {
      phase: this.phase,
      active: this.phase !== 'inactive',
      restoreAccelerator: ultraLightModeRestoreAccelerator,
      error: this.error,
    };
  }

  isActive(): boolean {
    return this.phase !== 'inactive';
  }

  enter(
    entryMode: UltraLightModeEntryMode = 'manual',
    gpuRuntimeResumeOverride?: PersistedPlaybackSessionResume | null,
  ): Promise<UltraLightModeStatus> {
    if (this.entryCompletion) return this.entryCompletion;
    if (this.isActive()) return Promise.resolve(this.getStatus());
    const generation = ++this.lifecycleGeneration;
    this.cancelBackgroundResume();
    this.phase = 'entering';
    this.entryMode = entryMode;
    this.error = null;
    const completion = this.performEntry(entryMode, gpuRuntimeResumeOverride, generation).catch((error) => {
      if (!this.isCurrentEntry(generation)) return this.getStatus();
      return this.fail(error instanceof Error ? error.message : String(error));
    });
    this.entryCompletion = completion;
    void completion.then(() => {
      if (this.entryCompletion === completion) this.entryCompletion = null;
    });
    return completion;
  }

  private isCurrentEntry(generation: number): boolean {
    return generation === this.lifecycleGeneration && (this.phase === 'entering' || this.phase === 'active');
  }

  private async performEntry(
    entryMode: UltraLightModeEntryMode,
    gpuRuntimeResumeOverride: PersistedPlaybackSessionResume | null | undefined,
    generation: number,
  ): Promise<UltraLightModeStatus> {
    const gpuRuntimeResume = isUltraLightGpuRuntime()
      ? gpuRuntimeResumeOverride === undefined
        ? getPlaybackSessionStore().load()?.resume ?? null
        : gpuRuntimeResumeOverride
      : null;
    const rejection = entryMode === 'tray-auto' || entryMode === 'minimize-auto'
      ? this.getAutomaticParkingRejection()
      : this.getRendererUnloadPlaybackRejection();
    if (rejection) {
      return this.fail(rejection);
    }

    try {
      await this.syncQueueForRendererUnload();
    } catch (error) {
      if (!this.isCurrentEntry(generation)) return this.getStatus();
      console.warn('[UltraLightMode] failed to hand the persisted queue to the native host', error);
      return this.fail('tray_renderer_unload_queue_sync_failed');
    }

    if (!this.isCurrentEntry(generation)) return this.getStatus();
    // The user may have foregrounded the window or changed output during handoff.
    const handoffRejection = entryMode === 'manual'
      ? this.getRendererUnloadPlaybackRejection() : this.getAutomaticParkingRejection();
    if (handoffRejection) return this.fail(handoffRejection);

    if (
      getAppSettings().ultraLightGpuDisabled === true &&
      !isUltraLightGpuRuntime()
    ) {
      return this.relaunchIntoGpuDisabledRuntime(entryMode);
    }

    if (!this.registerRestoreShortcut() && entryMode === 'manual') {
      return this.fail('ultra_light_mode_restore_shortcut_unavailable');
    }

    this.registerFallbackMediaShortcuts();
    const { ensureTray } = await import('./tray');
    if (!this.isCurrentEntry(generation)) return this.getStatus();
    ensureTray();
    const audioSession = getAudioSession();
    if (!gpuRuntimeResume) {
      try {
        getPlaybackSessionStore().saveResumeFromAudioStatus(audioSession.getStatus());
      } catch (error) {
        console.warn('[UltraLightMode] failed to persist playback resume before UI unload', error);
      }
    }
    this.bindAudioStatusPersistence();
    this.phase = 'active';

    if (entryMode === 'minimize-auto') {
      this.showMinimizedTaskbarRestoreWindow();
    } else {
      destroyUltraLightTaskbarRestoreWindow();
    }

    if (entryMode === 'manual') {
      await this.pauseManualBackgroundWork(generation);
      if (!this.isCurrentEntry(generation)) return this.getStatus();
    }

    if (gpuRuntimeResume?.state === 'playing') {
      const playbackIntent = this.playbackIntentGeneration;
      try {
        // The replacement Electron process can become ready just before the
        // previous native audio host has released its single-instance pipe.
        // Bounded retries avoid turning that normal relaunch overlap into a
        // permanent paused UltraLight session without keeping a retry loop
        // alive indefinitely.
        let resumedState: AudioStatus['state'] = audioSession.getStatus().state;
        for (let attempt = 0; attempt < ultraLightGpuPlaybackResumeMaxAttempts; attempt += 1) {
          const delayMs = attempt === 0
            ? ultraLightGpuPlaybackResumeDelayMs
            : ultraLightGpuPlaybackResumeRetryDelayMs;
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, delayMs);
            timer.unref?.();
          });
          if (!this.isCurrentEntry(generation)) return this.getStatus();
          if (playbackIntent !== this.playbackIntentGeneration) break;
          const resumedStatus = await audioSession.play();
          resumedState = resumedStatus.state;
          if (resumedState === 'playing') {
            break;
          }
          if (resumedState === 'loading') {
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, ultraLightGpuPlaybackResumeLoadingConfirmDelayMs);
              timer.unref?.();
            });
            resumedState = audioSession.getStatus().state;
            if (resumedState === 'playing') {
              break;
            }
          }
        }
        if (!this.isCurrentEntry(generation)) return this.getStatus();
        if (resumedState !== 'playing' && playbackIntent === this.playbackIntentGeneration) {
          console.warn(
            `[UltraLightMode] GPU-runtime playback handoff settled as ${resumedState}`,
          );
          this.scheduleGpuRuntimePlaybackRecovery();
        }
      } catch (error) {
        console.warn('[UltraLightMode] failed to resume playback after GPU-runtime handoff', error);
        if (this.isCurrentEntry(generation) && playbackIntent === this.playbackIntentGeneration) {
          this.scheduleGpuRuntimePlaybackRecovery();
        }
      }
    }

    if (!this.isCurrentEntry(generation)) return this.getStatus();
    this.uiDestroyTimer = setTimeout(() => {
      this.uiDestroyTimer = null;
      if (this.isCurrentEntry(generation)) {
        void (this.entryMode === 'tray-auto' || this.entryMode === 'minimize-auto'
          ? this.destroyMainWindowForAutomaticParking(generation)
          : this.destroyAllUiWindows(generation));
      }
    }, 80);
    this.uiDestroyTimer.unref?.();
    return this.getStatus();
  }

  async restore(pendingAction?: GlobalShortcutAction): Promise<UltraLightModeStatus> {
    if (pendingAction) {
      this.pendingRestoreActions.add(pendingAction);
    }
    if (this.phase === 'inactive') {
      const window = getMainWindow();
      if (window && !window.isDestroyed()) {
        this.showAndFocusMainWindow(window);
        this.flushPendingRestoreActions(window);
      }
      return this.getStatus();
    }
    if (this.phase === 'restoring') {
      return this.restoreCompletion ?? this.getStatus();
    }

    ++this.lifecycleGeneration;
    this.cancelAutomaticPlaybackResume();
    this.entryCompletion = null;
    this.cancelBackgroundResume();
    this.phase = 'restoring';
    const restoreAttemptId = ++this.restoreAttemptId;
    const entryMode = this.entryMode;
    this.error = null;
    let resolveConcurrentRestore!: (status: UltraLightModeStatus) => void;
    const concurrentRestore = new Promise<UltraLightModeStatus>((resolve) => {
      resolveConcurrentRestore = resolve;
    });
    this.restoreCompletion = concurrentRestore;
    const finishConcurrentRestore = (status: UltraLightModeStatus): UltraLightModeStatus => {
      resolveConcurrentRestore(status);
      if (this.restoreCompletion === concurrentRestore) {
        this.restoreCompletion = null;
      }
      return status;
    };
    if (this.uiDestroyTimer) {
      clearTimeout(this.uiDestroyTimer);
      this.uiDestroyTimer = null;
    }
    if (this.playbackResumeRetryTimer) {
      clearTimeout(this.playbackResumeRetryTimer);
      this.playbackResumeRetryTimer = null;
    }
    if (this.traySettledCleanupTimer) {
      clearTimeout(this.traySettledCleanupTimer);
      this.traySettledCleanupTimer = null;
    }
    try {
      const audioSession = getAudioSession();
      getPlaybackSessionStore().saveResumeFromAudioStatus(audioSession.getStatus());
      this.unbindAudioStatusPersistence();
      this.unregisterOwnedShortcuts();
      if (isUltraLightGpuRuntime()) {
        app.relaunch({
          args: prepareNormalRuntimeRelaunch(process.argv, process.env, {
            pendingAction: this.pendingRestoreActions.values().next().value,
            resumePlayback: audioSession.getStatus().state === 'playing',
          }),
        });
        suspendPlaybackMemoryPersistence();
        app.quit();
        return finishConcurrentRestore(this.getStatus());
      }
      const [{ createMainWindow }, { ensureTray }] = await Promise.all([
        import('./createMainWindow'),
        import('./tray'),
      ]);
      const existingWindow = getMainWindow();
      const reusedWindow = Boolean(existingWindow && !existingWindow.isDestroyed());
      const timeline = new UltraLightRestoreTimeline(entryMode, reusedWindow);
      ensureTray();
      const completeRestore = (window: BrowserWindow): UltraLightModeStatus => {
        if (restoreAttemptId !== this.restoreAttemptId || this.phase !== 'restoring') return this.getStatus();
        try {
          if (window.isDestroyed()) {
            throw new Error('ultra_light_mode_restore_window_closed');
          }
          this.showAndFocusMainWindow(window);
          timeline.markReadyToShow();
          destroyUltraLightTaskbarRestoreWindow();
          this.phase = 'inactive';
          this.entryMode = null;
          this.finishRestoreAfterRendererReady(window, entryMode, timeline);
          return this.getStatus();
        } catch (error) {
          return this.failWindowRestore(error, entryMode, restoreAttemptId);
        }
      };

      if (existingWindow && !existingWindow.isDestroyed()) {
        return finishConcurrentRestore(completeRestore(existingWindow));
      } else {
        // Chromium needs hundreds of milliseconds before the new renderer sends
        // its first IPC. Rebuild retired main-process dependencies in parallel
        // so UltraLight parking never shows up as a cold first list page.
        void warmMainProcessForRendererRestore().then((warmup) => {
          timeline.recordWarmup(warmup);
        });
        const window = createMainWindow({ ultraLightRestore: true });
        let resolveWindowRestore!: (status: UltraLightModeStatus) => void;
        const windowRestore = new Promise<UltraLightModeStatus>((resolve) => {
          resolveWindowRestore = resolve;
        });
        let settled = false;
        const cleanup = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(readyTimer);
          window.removeListener('ready-to-show', handleReady);
          window.removeListener('closed', handleClosed);
          window.webContents.removeListener('did-fail-load', handleDidFailLoad);
        };
        const handleReady = (): void => {
          cleanup();
          resolveWindowRestore(completeRestore(window));
        };
        const handleClosed = (): void => {
          cleanup();
          resolveWindowRestore(this.failWindowRestore(
            'ultra_light_mode_restore_window_closed',
            entryMode,
            restoreAttemptId,
          ));
        };
        const handleDidFailLoad = (
          _event: unknown,
          errorCode: number,
          errorDescription: string,
          _validatedUrl: string,
          isMainFrame: boolean,
        ): void => {
          if (isMainFrame === false) return;
          cleanup();
          const status = this.failWindowRestore(
            `ultra_light_mode_restore_load_failed:${errorCode}:${errorDescription}`, entryMode, restoreAttemptId,
          );
          if (!window.isDestroyed()) window.destroy();
          resolveWindowRestore(status);
        };
        const readyTimer = setTimeout(() => {
          cleanup();
          const status = this.failWindowRestore('ultra_light_mode_restore_window_timeout', entryMode, restoreAttemptId);
          if (!window.isDestroyed()) window.destroy();
          resolveWindowRestore(status);
        }, ultraLightModeRestoreReadyTimeoutMs);
        readyTimer.unref?.();

        // createMainWindow owns its first visible frame. Keep the service in
        // restoring until that frame is ready so repeated tray/shortcut actions
        // cannot expose Chromium's blank surface.
        window.once('ready-to-show', handleReady);
        window.once('closed', handleClosed);
        window.webContents.once('did-fail-load', handleDidFailLoad);
        return finishConcurrentRestore(await windowRestore);
      }
    } catch (error) {
      this.restoreAttemptId += 1;
      this.phase = 'active';
      this.error = error instanceof Error ? error.message : String(error);
      this.restoreControlSurfacesAfterFailedRestore(entryMode);
      return finishConcurrentRestore(this.getStatus());
    }
  }

  dispatch(action: GlobalShortcutAction): Promise<void> {
    if (!this.isActive()) {
      return Promise.resolve();
    }
    if (action === 'playPause' || action === 'stop') this.cancelAutomaticPlaybackResume();

    if (!canDispatchUltraLightModeActionWithoutRenderer(action)) {
      return this.restore(action).then(() => undefined);
    }

    const operation = async (): Promise<void> => {
      const audioSession = getAudioSession();
      const status = audioSession.getStatus();
      switch (action) {
        case 'playPause':
          if (status.state === 'playing' || status.state === 'loading') {
            await audioSession.pause();
          } else {
            await audioSession.play();
          }
          return;
        case 'stop':
          await audioSession.stop();
          return;
        case 'nextTrack':
          await this.playAdjacent('next');
          return;
        case 'previousTrack':
          if (status.positionSeconds > 5) {
            await audioSession.seek(0);
          } else {
            await this.playAdjacent('previous');
          }
          return;
        case 'seekBackward':
          await audioSession.seek(Math.max(0, status.positionSeconds - 10));
          return;
        case 'seekForward':
          await audioSession.seek(Math.max(0, status.positionSeconds + 10));
          return;
        case 'volumeUp':
          await audioSession.setOutput({ volume: Math.min(1, status.volume + 0.05) });
          return;
        case 'volumeDown':
          await audioSession.setOutput({ volume: Math.max(0, status.volume - 0.05) });
          return;
        case 'toggleMute':
          if (status.volume > 0) {
            this.volumeBeforeMute = status.volume;
            await audioSession.setOutput({ volume: 0 });
          } else {
            await audioSession.setOutput({ volume: Math.max(0.05, this.volumeBeforeMute) });
          }
          return;
        case 'bossKey':
          if (status.volume > 0) {
            this.volumeBeforeMute = status.volume;
          }
          await audioSession.setOutput({ volume: 0 });
          return;
        case 'speedUp':
          await audioSession.setOutput({ playbackRate: Math.min(2, (status.playbackRate ?? 1) + 0.1) });
          return;
        case 'speedDown':
          await audioSession.setOutput({ playbackRate: Math.max(0.5, (status.playbackRate ?? 1) - 0.1) });
          return;
        case 'toggleCurrentTrackLiked':
          if (status.currentTrackId) {
            getLibraryService().toggleTrackLiked(status.currentTrackId);
            // Liked state is not part of AudioStatus, so the taskbar thumbbar
            // would otherwise keep the stale heart until the next track change.
            refreshUltraLightTaskbarPresentation();
          }
          return;
        case 'toggleShuffle':
          await this.updatePlaybackMode((mode) => ({ ...mode, isShuffleEnabled: !mode.isShuffleEnabled }));
          return;
        case 'cycleRepeatMode':
          await this.updatePlaybackMode((mode) => ({ ...mode, repeatMode: mode.repeatMode === 'one' ? 'off' : 'one' }));
          return;
        default:
          throw new Error(`ultra_light_renderer_free_action_unhandled:${action}`);
      }
    };

    const queued = this.operationLane.then(operation, operation);
    this.operationLane = queued.catch((error) => {
      console.warn(`[UltraLightMode] shortcut ${action} failed`, error);
    });
    return queued;
  }

  dispatchSmtc(command: SmtcCommand): Promise<void> {
    if (typeof command === 'object') {
      const operation = (): Promise<void> => {
        switch (command.type) {
          case 'seek':
            return getAudioSession().seek(Math.max(0, command.positionSeconds)).then(() => undefined);
        }
      };
      const queued = this.operationLane.then(operation, operation);
      this.operationLane = queued.catch((error) => {
        console.warn(`[UltraLightMode] SMTC ${command.type} failed`, error);
      });
      return queued;
    }
    if (command === 'previous') return this.dispatch('previousTrack');
    if (command === 'next') return this.dispatch('nextTrack');
    if (command === 'stop') return this.dispatch('stop');
    if (command === 'playPause') return this.dispatch('playPause');

    if (command === 'play' || command === 'pause') {
      this.cancelAutomaticPlaybackResume();
      const operation = async (): Promise<void> => {
        const audio = getAudioSession();
        const playing = audio.getStatus().state === 'playing' || audio.getStatus().state === 'loading';
        if (command === 'play' && !playing) await audio.play();
        if (command === 'pause' && playing) await audio.pause();
      };
      const queued = this.operationLane.then(operation, operation);
      this.operationLane = queued.catch((error) => console.warn(`[UltraLightMode] SMTC ${command} failed`, error));
      return queued;
    }
    return Promise.resolve();
  }

  cyclePlaybackOrder(): Promise<void> {
    const operation = async (): Promise<void> => {
      const store = getPlaybackSessionStore();
      const session = store.load();
      if (!session) return;
      const current: PlaybackOrderMode = session.mode.isShuffleEnabled
        ? 'shuffle'
        : session.mode.repeatMode === 'one'
          ? 'repeat-one'
          : 'sequential';
      const next: PlaybackOrderMode = current === 'sequential'
        ? 'shuffle'
        : current === 'shuffle'
          ? 'repeat-one'
          : 'sequential';
      await this.updatePlaybackMode((mode) => ({
        ...mode,
        isShuffleEnabled: next === 'shuffle',
        repeatMode: next === 'repeat-one' ? 'one' : 'off',
      }));
    };
    const queued = this.operationLane.then(operation, operation);
    this.operationLane = queued.catch((error) => console.warn('[UltraLightMode] playback order change failed', error));
    return queued;
  }

  playQueueItemAt(index: number): Promise<void> {
    const operation = async (): Promise<void> => {
      const session = getPlaybackSessionStore().load();
      const target = session?.items.filter(isLocalQueueItem)[index] ?? null;
      if (!session || !target || !isLocalQueueItem(target)) return;
      await this.playQueueItem(session, target);
    };
    const queued = this.operationLane.then(operation, operation);
    this.operationLane = queued.catch((error) => console.warn('[UltraLightMode] queue item selection failed', error));
    return queued;
  }

  /**
   * The control vocabulary auxiliary surfaces (Dynamic Island, desktop lyrics)
   * normally send to the main window renderer. While Ultralight has unloaded
   * that renderer the same requests are served here, renderer-free, so those
   * surfaces keep working instead of freezing on `main_window_unavailable`.
   */
  control(request: MainWindowPlaybackControlRequest): Promise<void> {
    switch (request.type) {
      case 'play':
        return this.dispatchSmtc('play');
      case 'pause':
        return this.dispatchSmtc('pause');
      case 'stop':
        return this.dispatch('stop');
      case 'playPause':
        return this.dispatch('playPause');
      case 'previous':
        return this.dispatch('previousTrack');
      case 'next':
        return this.dispatch('nextTrack');
      case 'seek':
        return this.dispatchSmtc({ type: 'seek', positionSeconds: request.positionSeconds });
      case 'setVolume': {
        const volume = Math.max(0, Math.min(1, request.volume));
        const operation = (): Promise<void> => getAudioSession().setOutput({ volume }).then(() => undefined);
        const queued = this.operationLane.then(operation, operation);
        this.operationLane = queued.catch((error) => console.warn('[UltraLightMode] volume change failed', error));
        return queued;
      }
      case 'setPlaybackOrder':
        return this.updatePlaybackModeQueued((mode) => ({
          ...mode,
          isShuffleEnabled: request.mode === 'shuffle',
          repeatMode: request.mode === 'repeat-one' ? 'one' : 'off',
        }));
      case 'playQueueItem': {
        const operation = async (): Promise<void> => {
          const session = getPlaybackSessionStore().load();
          const target = session?.items.find((item) => item.queueId === request.queueId) ?? null;
          if (!session || !target || !isLocalQueueItem(target)) return;
          await this.playQueueItem(session, target);
        };
        const queued = this.operationLane.then(operation, operation);
        this.operationLane = queued.catch((error) => console.warn('[UltraLightMode] queue item selection failed', error));
        return queued;
      }
    }
  }

  private updatePlaybackModeQueued(
    update: (mode: PersistedPlaybackSessionV1['mode']) => PersistedPlaybackSessionV1['mode'],
  ): Promise<void> {
    const operation = (): Promise<void> => this.updatePlaybackMode(update);
    const queued = this.operationLane.then(operation, operation);
    this.operationLane = queued.catch((error) => console.warn('[UltraLightMode] playback mode change failed', error));
    return queued;
  }

  private fail(message: string): UltraLightModeStatus {
    ++this.lifecycleGeneration;
    this.cancelBackgroundResume();
    this.unbindAudioStatusPersistence();
    if (this.playbackResumeRetryTimer) {
      clearTimeout(this.playbackResumeRetryTimer);
      this.playbackResumeRetryTimer = null;
    }
    this.unregisterOwnedShortcuts();
    destroyUltraLightTaskbarRestoreWindow();
    this.phase = 'inactive';
    this.entryMode = null;
    this.error = message;
    const generation = this.lifecycleGeneration;
    void import('./backgroundPauseLeases').then(({ releaseBackgroundPauseLease }) => {
      if (this.phase === 'inactive' && generation === this.lifecycleGeneration) {
        // A failed re-entry must not strand a previous manual pause lease.
        // The window binding still owns any tray-hidden pause independently.
        return releaseBackgroundPauseLease('manual-ultralite');
      }
    }).catch((error) => console.warn('[UltraLightMode] failed entry pause cleanup failed', error));
    return this.getStatus();
  }

  private cancelAutomaticPlaybackResume(): void {
    ++this.playbackIntentGeneration;
    if (this.playbackResumeRetryTimer) clearTimeout(this.playbackResumeRetryTimer);
    this.playbackResumeRetryTimer = null;
  }

  private scheduleGpuRuntimePlaybackRecovery(): void {
    const generation = this.lifecycleGeneration;
    const playbackIntent = this.playbackIntentGeneration;
    if (this.playbackResumeRetryTimer) {
      clearTimeout(this.playbackResumeRetryTimer);
    }
    this.playbackResumeRetryTimer = setTimeout(() => {
      this.playbackResumeRetryTimer = null;
      if (!this.isCurrentEntry(generation) || playbackIntent !== this.playbackIntentGeneration) {
        return;
      }
      const audioSession = getAudioSession();
      const status = audioSession.getStatus();
      if (status.state === 'playing' || status.state === 'loading') {
        return;
      }
      void audioSession.play().catch((error) => {
        console.warn('[UltraLightMode] late GPU-runtime playback recovery failed', error);
      });
    }, ultraLightGpuPlaybackLateRecoveryDelayMs);
    this.playbackResumeRetryTimer.unref?.();
  }

  private relaunchIntoGpuDisabledRuntime(entryMode: UltraLightModeEntryMode): UltraLightModeStatus {
    try {
      const audioSession = getAudioSession();
      getPlaybackSessionStore().saveResumeFromAudioStatus(audioSession.getStatus());
      this.phase = 'entering';
      this.error = null;
      app.relaunch({
        args: createUltraLightGpuRuntimeArgs(process.argv, entryMode, {
          resumePlayback: audioSession.getStatus().state === 'playing',
        }),
      });
      suspendPlaybackMemoryPersistence();
      app.quit();
      return this.getStatus();
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private registerRestoreShortcut(): boolean {
    try {
      if (globalShortcut.isRegistered(ultraLightModeRestoreAccelerator)) {
        return false;
      }
      if (!globalShortcut.register(ultraLightModeRestoreAccelerator, () => {
        void this.restore();
      })) {
        return false;
      }
      this.ownedShortcuts.add(ultraLightModeRestoreAccelerator);
      return true;
    } catch {
      return false;
    }
  }

  private registerFallbackMediaShortcuts(): void {
    for (const [accelerator, action] of fallbackMediaShortcuts) {
      try {
        if (globalShortcut.isRegistered(accelerator)) {
          continue;
        }
        if (globalShortcut.register(accelerator, () => {
          void this.dispatch(action);
        })) {
          this.ownedShortcuts.add(accelerator);
        }
      } catch {
        // Media keys are best-effort. Restore remains guaranteed by the dedicated shortcut and tray.
      }
    }
  }

  private restoreAttemptId = 0;

  private failWindowRestore(
    error: unknown,
    entryMode: UltraLightModeEntryMode | null,
    restoreAttemptId: number,
  ): UltraLightModeStatus {
    if (restoreAttemptId !== this.restoreAttemptId || this.phase !== 'restoring') return this.getStatus();
    this.restoreAttemptId += 1;
    this.phase = 'active';
    this.error = error instanceof Error ? error.message : String(error);
    this.restoreControlSurfacesAfterFailedRestore(entryMode);
    if (entryMode === 'minimize-auto') {
      this.showMinimizedTaskbarRestoreWindow();
    }
    return this.getStatus();
  }

  /**
   * Auxiliary renderers and background producers wait for the main renderer's
   * stable first paint so they do not compete with it for CPU. The wait is
   * bounded; a renderer that never reports ready still gets its follow-ups.
   */
  private finishRestoreAfterRendererReady(
    window: BrowserWindow,
    entryMode: UltraLightModeEntryMode | null,
    timeline: UltraLightRestoreTimeline,
  ): void {
    const attemptId = this.restoreAttemptId;
    const generation = this.lifecycleGeneration;
    void waitForRendererStartupReady(window.webContents).then((rendererReady) => {
      if (window.isDestroyed() || this.phase !== 'inactive' || attemptId !== this.restoreAttemptId || generation !== this.lifecycleGeneration) return;
      timeline.markRendererReady(rendererReady);
      this.flushPendingRestoreActions(window);
      getCrashReportService().getLogger()?.info('main', 'ultra light restore timeline', timeline.toLogFields());
      if (entryMode === 'manual' || this.auxiliaryRestorePending) {
        void this.restoreAuxiliaryWindows(generation).catch((error) => console.warn('[UltraLightMode] auxiliary restore failed', error));
      }
      this.scheduleBackgroundResume(generation);
    });
  }

  private flushPendingRestoreActions(window: BrowserWindow): void {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    const actions = [...this.pendingRestoreActions];
    this.pendingRestoreActions.clear();
    for (const action of actions) {
      if (action !== 'showMainWindow') {
        window.webContents.send(IpcChannels.AppGlobalShortcutCommand, action);
      }
    }
  }

  private showAndFocusMainWindow(window: BrowserWindow): void {
    window.show();
    if (window.isMinimized()) {
      window.restore();
    }
    window.setSkipTaskbar(false);
    window.focus();
  }

  private showMinimizedTaskbarRestoreWindow(): void {
    const shown = showUltraLightTaskbarRestoreWindow({
      deferPresentation: Boolean(getMainWindow()),
      onPlaybackAction: (action) => this.dispatch(action),
      onPlaybackOrderCycle: () => this.cyclePlaybackOrder(),
      onRestore: () => this.restore('showMainWindow'),
    });
    if (!shown) {
      console.warn('[UltraLightMode] minimized taskbar restore window is unavailable');
    }
  }

  private restoreControlSurfacesAfterFailedRestore(entryMode: UltraLightModeEntryMode | null): void {
    if (!entryMode) return;
    this.registerRestoreShortcut();
    this.registerFallbackMediaShortcuts();
    this.bindAudioStatusPersistence();
  }

  private getAutomaticParkingRejection(): string | null {
    const window = getMainWindow();
    if (isUltraLightGpuRuntime()) {
      return this.getRendererUnloadPlaybackRejection();
    }
    if (!window || window.isDestroyed() || (window.isVisible() && !window.isMinimized())) {
      return 'background_renderer_unload_requires_minimized_or_hidden_main_window';
    }

    return this.getRendererUnloadPlaybackRejection();
  }

  private getRendererUnloadPlaybackRejection(): string | null {
    const status = getAudioSession().getStatus();
    if (status.outputMode === 'system') {
      return 'tray_renderer_unload_requires_native_output';
    }
    const nativePausedColdState = status.state === 'paused'
      && status.host === 'not-initialized';
    if (
      (status.state === 'loading' || status.state === 'playing' || status.state === 'paused') &&
      status.host !== 'ready' &&
      !nativePausedColdState
    ) {
      return 'tray_renderer_unload_requires_ready_native_host';
    }
    if (!status.currentTrackId && !status.currentFilePath) {
      return null;
    }

    const session = getPlaybackSessionStore().load();
    if (!session || session.items.length === 0 || !session.items.every(isLocalQueueItem)) {
      return 'tray_renderer_unload_requires_fully_local_queue';
    }
    if (!buildUltraLightBackendQueue(session)) {
      return 'tray_renderer_unload_rejects_unresolved_cue_queue';
    }
    const target = findHostQueueItem(session, status);
    return target && isLocalQueueItem(target)
      ? null
      : 'tray_renderer_unload_requires_local_queue_item';
  }

  private unregisterOwnedShortcuts(): void {
    for (const accelerator of this.ownedShortcuts) {
      try {
        globalShortcut.unregister(accelerator);
      } catch {
      }
    }
    this.ownedShortcuts.clear();
  }

  private async playAdjacent(direction: 'previous' | 'next'): Promise<void> {
    const store = getPlaybackSessionStore();
    const session = store.load();
    if (!session) {
      return;
    }
    const target = selectAdjacentItem(session, direction);
    if (!target) {
      return;
    }

    await this.playQueueItem(session, target);
  }

  private async updatePlaybackMode(
    update: (mode: PersistedPlaybackSessionV1['mode']) => PersistedPlaybackSessionV1['mode'],
  ): Promise<void> {
    const store = getPlaybackSessionStore();
    const session = store.load();
    if (!session) return;
    const saved = store.save({ ...session, mode: update(session.mode) }, { preserveRevision: true });
    const audioSession = getAudioSession();
    audioSession.setRepeatMode(saved.mode.repeatMode);
    const backendQueue = buildUltraLightBackendQueue(saved);
    if (backendQueue) {
      await audioSession.syncQueueToBackend(backendQueue, saved.mode.repeatMode, saved.currentQueueId);
    }
  }

  private async playQueueItem(session: PersistedPlaybackSessionV1, target: PersistedQueueItem): Promise<void> {
    const audioSession = getAudioSession();
    const backendQueue = buildUltraLightBackendQueue(session);
    if (!backendQueue) {
      throw new Error('ultra_light_queue_contains_unresolved_cue');
    }
    await audioSession.syncQueueToBackend(backendQueue, session.mode.repeatMode, target.queueId);
    await audioSession.playLocalFile({
      filePath: target.track.path,
      trackId: target.track.id,
      metadata: {
        title: target.track.title,
        artist: target.track.artist,
        album: target.track.album,
        albumArtist: target.track.albumArtist,
        coverUrl: target.track.coverThumb,
      },
      replayGain: replayGainFromQueueItem(target),
    });
    this.persistCurrentQueueItem(session, target);
  }

  private async syncQueueForRendererUnload(): Promise<void> {
    const status = getAudioSession().getStatus();
    if (!status.currentTrackId && !status.currentFilePath) return;
    const session = getPlaybackSessionStore().load();
    if (!session || session.items.length === 0) return;
    const backendQueue = buildUltraLightBackendQueue(session);
    if (!backendQueue) {
      throw new Error('ultra_light_queue_contains_unresolved_cue');
    }
    const target = findHostQueueItem(session, status);
    await getAudioSession().syncQueueToBackend(
      backendQueue,
      session.mode.repeatMode,
      target?.queueId ?? session.currentQueueId,
    );
  }

  private persistCurrentQueueItem(session: PersistedPlaybackSessionV1, target: PersistedQueueItem): void {
    this.lastPersistedQueueId = target.queueId;
    this.lastPersistedTrackId = target.track.id;
    getPlaybackSessionStore().save({
      ...session,
      currentQueueId: target.queueId,
      currentTrackId: target.track.id,
      lastPlayedTrack: target.track,
      resume: null,
    }, { preserveRevision: true });
  }

  private bindAudioStatusPersistence(): void {
    if (this.statusListener) {
      return;
    }
    const session = getPlaybackSessionStore().load();
    const currentStatus = getAudioSession().getStatus();
    this.lastPersistedTrackId = currentStatus.currentTrackId ?? session?.currentTrackId ?? null;
    this.lastPersistedQueueId = session?.currentQueueId ?? null;
    this.statusListener = (status: AudioStatus): void => {
      if (!this.isActive()) {
        return;
      }
      const mainWindow = getMainWindow();
      if ((!mainWindow || mainWindow.isDestroyed()) && getAppSettings().taskbarMiniPlayerEnabled === true) {
        this.nativeTaskbar.update(status);
      }
      // The community bridge path can finish without a daemon queue advance.
      // Only react to Audio Core's confirmed ended state, never a UI clock.
      if (status.state !== 'ended') this.lastHandledEnd = null;
      if (status.state === 'ended' && this.phase === 'active') {
        const window = getMainWindow();
        const endKey = `${status.currentQueueItemId ?? ''}:${status.currentTrackId ?? ''}:${status.currentFilePath ?? ''}`;
        if ((!window || window.isDestroyed()) && this.lastHandledEnd !== endKey) {
          this.lastHandledEnd = endKey;
          const operation = async (): Promise<void> => {
            const latest = getAudioSession().getStatus();
            if (this.phase !== 'active' || latest.state !== 'ended' || latest.currentTrackId !== status.currentTrackId) return;
            const session = getPlaybackSessionStore().load();
            if (!session) return;
            const current = findHostQueueItem(session, status);
            const snapshot = current ? { ...session, currentQueueId: current.queueId, currentTrackId: current.track.id } : session;
            const target = session.mode.repeatMode === 'one' ? current : selectAdjacentItem(snapshot, 'next');
            if (target) await this.playQueueItem(snapshot, target);
          };
          const queued = this.operationLane.then(operation, operation);
          this.operationLane = queued.catch((error) => console.warn('[UltraLightMode] confirmed playback end continuation failed', error));
        }
      }
      if (status.currentTrackId && (status.currentTrackId !== this.lastPersistedTrackId
        || (status.currentQueueItemId && status.currentQueueItemId !== this.lastPersistedQueueId))) {
        const store = getPlaybackSessionStore();
        const session = store.load();
        const target = session ? findHostQueueItem(session, status) : null;
        if (session && target && target.queueId !== this.lastPersistedQueueId) {
          try {
            this.persistCurrentQueueItem(session, target);
          } catch (error) {
            console.warn('[UltraLightMode] failed to persist host queue advance', error);
          }
        }
      }
    };
    getAudioSession().on('status', this.statusListener);
  }

  private unbindAudioStatusPersistence(): void {
    if (!this.statusListener) {
      return;
    }
    getAudioSession().off('status', this.statusListener);
    this.statusListener = null;
    this.lastPersistedQueueId = null;
    this.lastPersistedTrackId = null;
    this.lastHandledEnd = null;
    this.nativeTaskbar.reset();
  }

  private async destroyAllUiWindows(generation: number): Promise<void> {
    if (!this.isCurrentEntry(generation)) return;
    try {
      closeDevConsoleWindow();
      const [{ closeDesktopLyricsWindow }, { closeMiniPlayerWindow }, { closePetWindow }] = await Promise.all([
        import('./desktopLyricsWindow'),
        import('./miniPlayerWindow'),
        import('./petWindow'),
      ]);
      if (!this.isCurrentEntry(generation)) return;
      this.auxiliaryRestorePending = true;
      closeDesktopLyricsWindow();
      if (!this.isCurrentEntry(generation)) return;
      closeMiniPlayerWindow();
      if (!this.isCurrentEntry(generation)) return;
      closePetWindow();
    } catch (error) {
      console.warn('[UltraLightMode] auxiliary UI cleanup was incomplete', error);
    }

    for (const window of BrowserWindow.getAllWindows()) {
      if (!this.isCurrentEntry(generation)) return;
      if (!window.isDestroyed()) {
        window.destroy();
      }
    }

    try {
      const { releaseDefaultBackgroundMemory } = await import('./mainWindowTrayLoadShedding');
      if (!this.isCurrentEntry(generation)) return;
      await releaseDefaultBackgroundMemory('ultra-light-manual');
    } catch (error) {
      console.warn('[UltraLightMode] failed to release rebuildable background memory', error);
    }
  }

  private async destroyMainWindowForAutomaticParking(generation: number): Promise<void> {
    const window = getMainWindow();
    if (
      !this.isCurrentEntry(generation) ||
      (this.entryMode !== 'tray-auto' && this.entryMode !== 'minimize-auto') ||
      !window ||
      window.isDestroyed()
    ) {
      return;
    }
    if (window.isVisible() && !window.isMinimized()) {
      await this.restore();
      return;
    }

    try {
      if (!window.webContents.isDestroyed()) {
        await window.webContents.executeJavaScript(captureActiveRouteForRendererRestoreScript, true);
      }
    } catch (error) {
      console.warn('[UltraLightMode] failed to preserve active route before tray renderer unload', error);
    }

    if (
      this.isCurrentEntry(generation) &&
      (this.entryMode === 'tray-auto' || this.entryMode === 'minimize-auto') &&
      !window.isDestroyed() &&
      (!window.isVisible() || window.isMinimized())
    ) {
      window.destroy();
      if (this.entryMode === 'minimize-auto') {
        activateUltraLightTaskbarRestorePresentation();
      }
      this.scheduleAutomaticParkingSettledCleanup(this.entryMode, generation);
    } else if (
      this.isCurrentEntry(generation) &&
      (this.entryMode === 'tray-auto' || this.entryMode === 'minimize-auto') &&
      !window.isDestroyed()
    ) {
      await this.restore();
    }
  }

  /**
   * Once the renderer has been gone for a few seconds, run the deep tier-3
   * cleanup for both automatic entries so minimize parking does not retain
   * more rebuildable memory than tray parking.
   */
  private scheduleAutomaticParkingSettledCleanup(entryMode: 'tray-auto' | 'minimize-auto', generation: number): void {
    if (this.traySettledCleanupTimer) {
      clearTimeout(this.traySettledCleanupTimer);
    }
    const reason = entryMode === 'tray-auto' ? 'ultra-light-tray-settled' : 'ultra-light-minimize-settled';
    this.traySettledCleanupTimer = setTimeout(() => {
      this.traySettledCleanupTimer = null;
      if (!this.isCurrentEntry(generation) || this.entryMode !== entryMode) return;
      void import('./mainWindowTrayLoadShedding')
        .then(({ releaseDefaultBackgroundMemory }) => {
          if (this.isCurrentEntry(generation)) return releaseDefaultBackgroundMemory(reason, { cleanupScope: reason });
        })
        .catch((error) => {
          console.warn('[UltraLightMode] settled automatic parking memory cleanup failed', error);
        });
    }, ultraLightTraySettledCleanupDelayMs);
    this.traySettledCleanupTimer.unref?.();
  }

  private cancelBackgroundResume(): void {
    if (this.backgroundResumeTimer) clearTimeout(this.backgroundResumeTimer);
    this.backgroundResumeTimer = null;
  }

  private scheduleBackgroundResume(generation: number): void {
    this.cancelBackgroundResume();
    this.backgroundResumeTimer = setTimeout(() => {
      this.backgroundResumeTimer = null;
      void import('./backgroundPauseLeases').then(({ releaseBackgroundPauseLease }) => {
        if (this.phase !== 'inactive' || generation !== this.lifecycleGeneration) return;
        // A manual entry may have been followed by automatic parking before
        // its delayed resume ran. Release both owners once actually restored.
        return Promise.all([
          releaseBackgroundPauseLease('manual-ultralite'),
          releaseBackgroundPauseLease('tray-hidden'),
        ]);
      }).catch((error) => console.warn('[UltraLightMode] background resume failed', error));
    }, trayBackgroundResumeDelayMs);
    this.backgroundResumeTimer.unref?.();
  }

  private async pauseManualBackgroundWork(generation: number): Promise<void> {
    const { acquireBackgroundPauseLease } = await import('./backgroundPauseLeases');
    if (this.isCurrentEntry(generation)) await acquireBackgroundPauseLease('manual-ultralite');
  }

  private async restoreAuxiliaryWindows(generation: number): Promise<void> {
    const [{ restoreDesktopLyricsWindowOnStartup }, { restoreMiniPlayerWindowOnStartup }, { restorePetWindowOnStartup }] = await Promise.all([
      import('./desktopLyricsWindow'),
      import('./miniPlayerWindow'),
      import('./petWindow'),
    ]);
    if (this.phase !== 'inactive' || generation !== this.lifecycleGeneration) return;
    this.auxiliaryRestorePending = false;
    restoreDesktopLyricsWindowOnStartup();
    restoreMiniPlayerWindowOnStartup();
    restorePetWindowOnStartup();
  }
}

const ultraLightModeService = new UltraLightModeService();

export const getUltraLightModeStatus = (): UltraLightModeStatus => ultraLightModeService.getStatus();
export const isUltraLightModeActive = (): boolean => ultraLightModeService.isActive();
export const enterUltraLightMode = (
  gpuRuntimeResumeOverride?: PersistedPlaybackSessionResume | null,
): Promise<UltraLightModeStatus> => ultraLightModeService.enter('manual', gpuRuntimeResumeOverride);
export const enterUltraLightModeForMinimizedParking = (
  gpuRuntimeResumeOverride?: PersistedPlaybackSessionResume | null,
): Promise<UltraLightModeStatus> => ultraLightModeService.enter('minimize-auto', gpuRuntimeResumeOverride);
export const enterUltraLightModeForTrayParking = (
  gpuRuntimeResumeOverride?: PersistedPlaybackSessionResume | null,
): Promise<UltraLightModeStatus> => ultraLightModeService.enter('tray-auto', gpuRuntimeResumeOverride);
export const restoreUltraLightMode = (pendingAction?: GlobalShortcutAction): Promise<UltraLightModeStatus> =>
  ultraLightModeService.restore(pendingAction);
export const dispatchUltraLightModeAction = (action: GlobalShortcutAction): Promise<void> => ultraLightModeService.dispatch(action);
export const dispatchUltraLightModeSmtcCommand = (command: SmtcCommand): Promise<void> => ultraLightModeService.dispatchSmtc(command);
export const cycleUltraLightModePlaybackOrder = (): Promise<void> => ultraLightModeService.cyclePlaybackOrder();
export const playUltraLightModeQueueItemAt = (index: number): Promise<void> => ultraLightModeService.playQueueItemAt(index);
export const controlUltraLightModePlayback = (request: MainWindowPlaybackControlRequest): Promise<void> =>
  ultraLightModeService.control(request);
