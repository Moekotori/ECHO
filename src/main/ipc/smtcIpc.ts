import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { SmtcDiagnostics, SmtcLyricsProgress } from '../../shared/types/smtc';
import { getSmtcDiagnostics, restartSmtcIntegration, syncSmtcLyricsProgress } from '../integrations/smtc/SmtcStatusSync';

const nullableText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const nullableNonNegativeNumber = (value: unknown): number | null => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
};

const normalizeSmtcLyricsProgress = (value: unknown): SmtcLyricsProgress | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const input = value as Record<string, unknown>;
  const lineText = nullableText(input.lineText);
  if (!lineText) {
    return null;
  }

  return {
    trackId: nullableText(input.trackId),
    lineText,
    lineIndex: nullableNonNegativeNumber(input.lineIndex),
    lineCount: nullableNonNegativeNumber(input.lineCount),
    lineStartMs: nullableNonNegativeNumber(input.lineStartMs),
    positionSeconds: nullableNonNegativeNumber(input.positionSeconds),
    durationSeconds: nullableNonNegativeNumber(input.durationSeconds),
  };
};

export const registerSmtcIpc = (): void => {
  ipcMain.handle(IpcChannels.SmtcGetDiagnostics, (): SmtcDiagnostics => getSmtcDiagnostics());
  ipcMain.handle(IpcChannels.SmtcRestart, async (): Promise<SmtcDiagnostics> => restartSmtcIntegration());
  ipcMain.handle(IpcChannels.SmtcSetLyricsProgress, async (_event, progress: unknown): Promise<void> => {
    await syncSmtcLyricsProgress(normalizeSmtcLyricsProgress(progress));
  });
};
