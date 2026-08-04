import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { SmtcLyricsProgress } from '../../shared/types/smtc';
import { getSmtcDiagnostics, restartSmtcIntegration, syncSmtcLyricsProgress } from '../integrations/smtc/SmtcStatusSync';

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

export const registerSmtcIpc = (): void => {
  ipcMain.handle(IpcChannels.SmtcGetDiagnostics, () => getSmtcDiagnostics());
  ipcMain.handle(IpcChannels.SmtcSetLyricsProgress, (_event, progress: unknown) =>
    syncSmtcLyricsProgress(normalizeLyricsProgress(progress)),
  );
  ipcMain.handle(IpcChannels.SmtcRestart, () => restartSmtcIntegration());
};
