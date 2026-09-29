import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { SmtcEnabledActions, SmtcLyricsProgress } from '../../shared/types/smtc';
import {
  getSmtcDiagnostics,
  queueSmtcLyricsProgressSync,
  restartSmtcIntegration,
  syncSmtcEnabledActions,
} from '../integrations/smtc/SmtcStatusSync';

const optionalString = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const optionalNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const normalizeLyricsProgress = (value: unknown): SmtcLyricsProgress | null => {
  if (value === null) {
    return null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const progress = value as Record<string, unknown>;
  return {
    trackId: optionalString(progress.trackId),
    lineText: optionalString(progress.lineText),
    lineIndex: optionalNumber(progress.lineIndex),
    lineCount: optionalNumber(progress.lineCount),
    lineStartMs: optionalNumber(progress.lineStartMs),
    positionSeconds: optionalNumber(progress.positionSeconds),
    durationSeconds: optionalNumber(progress.durationSeconds),
  };
};

const normalizeEnabledActions = (value: unknown): SmtcEnabledActions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('SMTC enabled actions must be an object.');
  }

  const actions = value as Record<string, unknown>;
  return {
    play: actions.play === true,
    pause: actions.pause === true,
    previous: actions.previous === true,
    next: actions.next === true,
    seek: actions.seek === true,
  };
};

export const registerSmtcIpc = (): void => {
  ipcMain.handle(IpcChannels.SmtcGetDiagnostics, () => getSmtcDiagnostics());
  ipcMain.handle(IpcChannels.SmtcSetLyricsProgress, (_event, progress: unknown): void => {
    queueSmtcLyricsProgressSync(normalizeLyricsProgress(progress));
  });
  ipcMain.handle(IpcChannels.SmtcSetEnabledActions, (_event, actions: unknown) =>
    syncSmtcEnabledActions(normalizeEnabledActions(actions)),
  );
  ipcMain.handle(IpcChannels.SmtcRestart, () => restartSmtcIntegration());
};
