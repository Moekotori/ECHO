import { BrowserWindow, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { QobuzLoginResult, QobuzManualCredentials, QobuzAuthState, QobuzFormatId } from '../../shared/types/qobuz';
import { QobuzAuthService } from '../qobuz/QobuzAuthService';
import { QobuzDownloadService } from '../qobuz/QobuzDownloadService';
import { getDownloadService } from '../downloads/DownloadService';
import { getAccountService } from '../accounts/AccountService';

let downloadServiceInstance: QobuzDownloadService | null = null;

const getQobuzDownloadService = (): QobuzDownloadService => {
  if (!downloadServiceInstance) {
    downloadServiceInstance = new QobuzDownloadService(getDownloadService());
  }
  return downloadServiceInstance;
};

const requireString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
};

const normalizeQuality = (value: unknown): QobuzFormatId => {
  if (typeof value === 'number' && [5, 6, 7, 27].includes(value)) {
    return value as QobuzFormatId;
  }
  return 6;
};

const broadcastAuthState = (state: QobuzAuthState): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.QobuzAuthStatusChanged, state);
    }
  }
};

const broadcastAccountStatuses = (): void => {
  const statuses = getAccountService().getStatuses();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.AccountStatusesChanged, statuses);
    }
  }
};

export const registerQobuzIpc = (): void => {
  ipcMain.handle(IpcChannels.QobuzAuthLogin, async (
    _event: IpcMainInvokeEvent,
    credentials: unknown,
  ): Promise<QobuzLoginResult> => {
    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
      return { success: false, tier: null, username: null, displayName: null, avatarUrl: null, error: '无效的凭据' };
    }
    const auth = QobuzAuthService.getInstance();
    const result = await auth.loginWithToken(credentials as QobuzManualCredentials);
    if (result.success) {
      // Persist credentials to accounts.json for restore on restart
      const record = auth.toStoredRecord();
      getAccountService().saveQobuzCredentials({
        accessToken: record.accessToken ?? '',
        refreshToken: record.refreshToken,
        tokenType: record.tokenType,
        username: record.username,
        displayName: record.displayName,
        avatarUrl: record.avatarUrl,
      });
      broadcastAuthState(auth.getState());
      broadcastAccountStatuses();
    }
    return result;
  });

  ipcMain.handle(IpcChannels.QobuzAuthLogout, async (): Promise<void> => {
    QobuzAuthService.getInstance().clearState();
    getQobuzDownloadService().clearCache();
    broadcastAuthState(QobuzAuthService.getInstance().getState());
    broadcastAccountStatuses();
  });

  ipcMain.handle(IpcChannels.QobuzAuthGetStatus, (): QobuzAuthState => {
    return QobuzAuthService.getInstance().getState();
  });

  ipcMain.handle(IpcChannels.QobuzDownloadAlbum, async (
    _event: IpcMainInvokeEvent,
    request: unknown,
  ): Promise<{ jobIds: string[]; albumTitle: string }> => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('downloadAlbum requires an object with albumId and quality');
    }
    const req = request as Record<string, unknown>;
    const albumId = requireString(req.albumId, 'albumId');
    const quality = normalizeQuality(req.quality);
    return getQobuzDownloadService().downloadAlbum(albumId, quality, {
      outputDir: typeof req.outputDir === 'string' ? req.outputDir : undefined,
    });
  });
};
