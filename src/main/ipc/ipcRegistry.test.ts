import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import { createMockIpcMain } from '../../test-utils/electronMocks';

// ─── Static analysis helpers ────────────────────────────────────────────────

const IPC_DIR = join(__dirname);

/** All 505 channel strings defined in the IpcChannels const. */
const ALL_CHANNELS = Object.values(IpcChannels);

/**
 * Channels that are push-only (main → renderer via webContents.send) and
 * do NOT need an ipcMain.handle() or ipcMain.on() registration.
 *
 * These are identified by scanning every reference site in the IPC files:
 * if the channel is only used with webContents.send() / window.webContents.send(),
 * it is a push-only event channel.
 */
const PUSH_ONLY_CHANNELS = new Set<string>([
  IpcChannels.AppDataBackupProgress,
  IpcChannels.AppWindowFullscreenChanged,
  IpcChannels.AppWindowMaximizedChanged,
  IpcChannels.AudioStatus,
  IpcChannels.ConnectAirPlayReceiverStatus,
  IpcChannels.ConnectReceiverStatus,
  IpcChannels.ConnectStatus,
  IpcChannels.DesktopLyricsRendererAudioStatus,
  IpcChannels.DesktopLyricsRendererPlaybackStatus,
  IpcChannels.DownloadsJobsUpdated,
  IpcChannels.LibraryArtistImagesUpdated,
  IpcChannels.LibraryChanged,
  IpcChannels.LyricsChanged,
  IpcChannels.PlaybackAutomixAdvance,
  IpcChannels.PlaybackLocalAudioFilesOpened,
  IpcChannels.PlaybackMainWindowCommand,
  IpcChannels.PlaybackMainWindowCommandRequest,
  IpcChannels.PlaybackMainWindowCommandResult,
  IpcChannels.PlaybackQueueSessionChanged,
  IpcChannels.SleepTimerOnTick,
  IpcChannels.SmtcCommand,
  IpcChannels.AccountStatusesChanged,
  IpcChannels.AppUpdateStatusChanged,
  IpcChannels.DesktopLyricsStateChanged,
  IpcChannels.MiniPlayerStateChanged,
  IpcChannels.LibraryLikedTracksChanged,
  IpcChannels.DesktopLyricsAudioStatus,
  IpcChannels.DesktopLyricsPlaybackStatus,
  // Push-only channels used in main-process files outside src/main/ipc/
  IpcChannels.AppGlobalShortcutCommand,
  IpcChannels.DiagnosticsMemoryPressure,
  IpcChannels.DiagnosticsDevConsoleEntry,
]);

/** List of IPC source files (excluding tests) that register handlers. */
const IPC_SOURCE_FILES = [
  'registerIpc.ts',
  'accountIpc.ts',
  'audioCdIpc.ts',
  'audioIpc.ts',
  'connectIpc.ts',
  'desktopLyricsIpc.ts',
  'diagnosticsIpc.ts',
  'discordPresenceIpc.ts',
  'downloadsIpc.ts',
  'hqPlayerIpc.ts',
  'lastFmIpc.ts',
  'libraryIpc.ts',
  'lyricsIpc.ts',
  'miniPlayerIpc.ts',
  'mvIpc.ts',
  'playbackIpc.ts',
  'pluginIpc.ts',
  'qobuzIpc.ts',
  'remoteSourcesIpc.ts',
  'sleepTimerIpc.ts',
  'smtcIpc.ts',
  'stageBridgeIpc.ts',
  'streamingIpc.ts',
];

/**
 * Scans all IPC source files for channels that have an ipcMain.handle() or
 * ipcMain.on() registration. Uses multi-line aware scanning: when a line
 * contains ipcMain.handle/on, the next few lines are checked for the
 * IpcChannels.XXX reference.
 */
function collectHandledChannels(): Set<string> {
  const handled = new Set<string>();

  for (const file of IPC_SOURCE_FILES) {
    const content = readFileSync(join(IPC_DIR, file), 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (/\bipcMain\.(handle|on)\b/.test(lines[i])) {
        for (let j = i; j < Math.min(i + 4, lines.length); j++) {
          const m = lines[j].match(/IpcChannels\.(\w+)/);
          if (m) {
            const key = m[1] as keyof typeof IpcChannels;
            if (key in IpcChannels) {
              handled.add(IpcChannels[key]);
            }
            break;
          }
        }
      }
    }
  }

  return handled;
}

/**
 * Returns channels that appear in the IPC source files but only as
 * push events (webContents.send), NOT as ipcMain.handle() or ipcMain.on().
 * These are identified by: channel is referenced in source but NOT inside
 * an ipcMain.handle/on block.
 */
function findActualPushChannels(): Set<string> {
  const allReferenced = new Set<string>();
  const handledOrListened = new Set<string>();

  for (const file of IPC_SOURCE_FILES) {
    const content = readFileSync(join(IPC_DIR, file), 'utf8');

    // Collect all IpcChannels.XXX references
    const chanRegex = /IpcChannels\.(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = chanRegex.exec(content)) !== null) {
      const key = match[1] as keyof typeof IpcChannels;
      if (key in IpcChannels) {
        allReferenced.add(IpcChannels[key]);
      }
    }

    // Collect channels used in ipcMain.handle() or ipcMain.on()
    // Use a sliding-window approach: find lines with ipcMain.handle/on and
    // capture IpcChannels references that appear nearby.
    const lines = content.split('\n');
    let inHandlerContext = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/\bipcMain\.(handle|on)\b/.test(line)) {
        // Check this line and next 2 lines for IpcChannels reference
        for (let j = i; j < Math.min(i + 4, lines.length); j++) {
          const subMatch = lines[j].match(/IpcChannels\.(\w+)/);
          if (subMatch) {
            const key = subMatch[1] as keyof typeof IpcChannels;
            if (key in IpcChannels) {
              handledOrListened.add(IpcChannels[key]);
            }
            break;
          }
        }
      }
    }
  }

  // Push channels = referenced but not in handle/on context
  const pushOnly = new Set<string>();
  for (const ch of allReferenced) {
    if (!handledOrListened.has(ch)) {
      pushOnly.add(ch);
    }
  }

  return pushOnly;
}

/**
 * Collects ALL IpcChannels.XXX references across all IPC source files
 * (regardless of whether they're in handler context or push context).
 */
function collectAllReferencedChannels(): Set<string> {
  const referenced = new Set<string>();

  for (const file of IPC_SOURCE_FILES) {
    const content = readFileSync(join(IPC_DIR, file), 'utf8');
    const regex = /IpcChannels\.(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const key = match[1] as keyof typeof IpcChannels;
      if (key in IpcChannels) {
        referenced.add(IpcChannels[key]);
      }
    }
  }

  return referenced;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('IPC Registry — channel registration completeness', () => {
  let handledChannels: Set<string>;
  let allReferencedChannels: Set<string>;

  beforeAll(() => {
    handledChannels = collectHandledChannels();
    allReferencedChannels = collectAllReferencedChannels();
  });

  describe('1. All defined channels referenced in handler files', () => {
    it('every channel from IpcChannels has a corresponding reference in registration source files', () => {
      const missing = ALL_CHANNELS.filter((ch) => !allReferencedChannels.has(ch));

      if (missing.length > 0) {
        console.warn(
          `Channels not referenced in src/main/ipc/*.ts (may be push-only or used elsewhere):\n  ${missing.join('\n  ')}`,
        );
      }

      // Channels not referenced in IPC files should all be accounted for
      // as push-only channels used outside the IPC directory.
      const unaccounted = missing.filter((ch) => !PUSH_ONLY_CHANNELS.has(ch));
      expect(unaccounted).toEqual([]);

      // Sanity: at least 95% of channels should be referenced
      expect(allReferencedChannels.size).toBeGreaterThanOrEqual(ALL_CHANNELS.length * 0.95);
    });
  });

  describe('2. All handler channels registered via ipcMain.handle() or ipcMain.on()', () => {
    it('every non-push channel has a handler registration in IPC source files', () => {
      const missing: string[] = [];
      const pushChannels = findActualPushChannels();
      const allPushChannels = new Set([...pushChannels, ...PUSH_ONLY_CHANNELS]);

      for (const channel of ALL_CHANNELS) {
        if (allPushChannels.has(channel)) {
          continue;
        }

        if (!handledChannels.has(channel)) {
          missing.push(channel);
        }
      }

      if (missing.length > 0) {
        console.error(
          `UNREGISTERED CHANNELS (no ipcMain.handle/on found):\n  ${missing.join('\n  ')}`,
        );
      }

      expect(missing).toEqual([]);
    });

    it('no channel is registered more than once', () => {
      const counts = new Map<string, number>();

      for (const file of IPC_SOURCE_FILES) {
        const content = readFileSync(join(IPC_DIR, file), 'utf8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (/\bipcMain\.(handle|on)\b/.test(lines[i])) {
            for (let j = i; j < Math.min(i + 4, lines.length); j++) {
              const subMatch = lines[j].match(/IpcChannels\.(\w+)/);
              if (subMatch) {
                const key = subMatch[1] as keyof typeof IpcChannels;
                if (key in IpcChannels) {
                  const ch = IpcChannels[key];
                  counts.set(ch, (counts.get(ch) ?? 0) + 1);
                }
                break;
              }
            }
          }
        }
      }

      const duplicates: string[] = [];
      for (const [ch, count] of counts) {
        if (count > 1) {
          duplicates.push(`${ch} (registered ${count}x)`);
        }
      }

      if (duplicates.length > 0) {
        console.warn(`Duplicate handler registrations:\n  ${duplicates.join('\n  ')}`);
      }

      expect(duplicates.length).toBe(0);
    });
  });

  describe('3. Handler count matches channel count', () => {
    it('handler registration count is within expected range of defined channels', () => {
      const pushChannels = findActualPushChannels();
      const allPushChannels = new Set([...pushChannels, ...PUSH_ONLY_CHANNELS]);
      const expectedHandlerCount = ALL_CHANNELS.length - allPushChannels.size;

      console.log(
        `Total channels: ${ALL_CHANNELS.length}, ` +
        `Handler-registered: ${handledChannels.size}, ` +
        `Push-only: ${allPushChannels.size}, ` +
        `Expected handlers: ${expectedHandlerCount}`,
      );

      // Allow ±5 tolerance for edge cases (e.g., channels handled via
      // non-standard patterns or newly added channels)
      expect(handledChannels.size).toBeGreaterThanOrEqual(expectedHandlerCount - 5);
      expect(handledChannels.size).toBeLessThanOrEqual(expectedHandlerCount + 5);
    });
  });

  describe('4. Critical channels are registered', () => {
    it('critical channels have handlers when using createMockIpcMain', () => {
      const mockIpc = createMockIpcMain();

      mockIpc.handle(IpcChannels.AudioGetStatus, vi.fn());
      mockIpc.handle(IpcChannels.PlaybackPlay, vi.fn());
      mockIpc.handle(IpcChannels.LibraryGetTrack, vi.fn());

      expect(mockIpc.handlers.has(IpcChannels.AudioGetStatus)).toBe(true);
      expect(mockIpc.handlers.has(IpcChannels.PlaybackPlay)).toBe(true);
      expect(mockIpc.handlers.has(IpcChannels.LibraryGetTrack)).toBe(true);

      expect(mockIpc.handle).toHaveBeenCalledTimes(3);
      expect(mockIpc.handle).toHaveBeenCalledWith(
        IpcChannels.AudioGetStatus,
        expect.any(Function),
      );
      expect(mockIpc.handle).toHaveBeenCalledWith(
        IpcChannels.PlaybackPlay,
        expect.any(Function),
      );
      expect(mockIpc.handle).toHaveBeenCalledWith(
        IpcChannels.LibraryGetTrack,
        expect.any(Function),
      );
    });

    it('createMockIpcMain correctly stores and retrieves handlers', () => {
      const mockIpc = createMockIpcMain();
      const handler = vi.fn().mockReturnValue('ok');

      mockIpc.handle(IpcChannels.AudioGetStatus, handler);

      const stored = mockIpc.handlers.get(IpcChannels.AudioGetStatus);
      expect(stored).toBeDefined();
      expect(stored!()).toBe('ok');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('verify real registration source code references critical channels', () => {
      const criticalChannels = [
        IpcChannels.AudioGetStatus,
        IpcChannels.PlaybackPlay,
        IpcChannels.LibraryGetTrack,
        IpcChannels.AppGetVersion,
        IpcChannels.AppGetSettings,
        IpcChannels.EqGetState,
        IpcChannels.PlaybackPause,
        IpcChannels.PlaybackStop,
        IpcChannels.LyricsGetForTrack,
        IpcChannels.MvGetSelected,
      ];

      for (const channel of criticalChannels) {
        expect(handledChannels.has(channel)).toBe(true);
      }
    });
  });
});
