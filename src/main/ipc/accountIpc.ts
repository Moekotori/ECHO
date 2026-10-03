import { BrowserWindow, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { AccountLoginStartResult, AccountProvider, AccountStatus } from '../../shared/types/accounts';
import { getAccountService, isAccountProvider } from '../accounts/AccountService';
import { startAccountLoginWindow } from '../accounts/AccountLoginWindow';

const requireProvider = (value: unknown): AccountProvider => {
  if (!isAccountProvider(value)) {
    throw new Error('provider must be a supported account provider');
  }

  return value;
};

const requireCookie = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new Error('cookie must be a string');
  }

  return value;
};

const sendAccountStatusesChanged = (): void => {
  const statuses = getAccountService().getStatuses();
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      window.webContents.send(IpcChannels.AccountStatusesChanged, statuses);
    } catch {
      // Ignore windows that are closing while login finishes.
    }
  }
};

export const registerAccountIpc = (): void => {
  ipcMain.handle(IpcChannels.AccountGetStatuses, (): AccountStatus[] => getAccountService().getStatuses());
  ipcMain.handle(IpcChannels.AccountGetStatus, (_event, provider: unknown): AccountStatus =>
    getAccountService().getStatus(requireProvider(provider)),
  );
  ipcMain.handle(IpcChannels.AccountSaveCookie, (_event, provider: unknown, cookie: unknown): AccountStatus => {
    const status = getAccountService().saveCookie(requireProvider(provider), requireCookie(cookie));
    sendAccountStatusesChanged();
    return status;
  });
  ipcMain.handle(IpcChannels.AccountStartLogin, async (_event, provider: unknown): Promise<AccountLoginStartResult> => {
    const result = await startAccountLoginWindow(requireProvider(provider), getAccountService());
    if (result.saved) {
      sendAccountStatusesChanged();
    }
    return result;
  });
  ipcMain.handle(IpcChannels.AccountClear, (_event, provider: unknown): AccountStatus => {
    const status = getAccountService().clearAccount(requireProvider(provider));
    sendAccountStatusesChanged();
    return status;
  });
  ipcMain.handle(IpcChannels.AccountCheck, async (_event, provider: unknown): Promise<AccountStatus> => {
    const status = await getAccountService().checkAccount(requireProvider(provider));
    sendAccountStatusesChanged();
    return status;
  });
  ipcMain.handle(IpcChannels.AccountCheckAll, async (): Promise<AccountStatus[]> => {
    const statuses = await getAccountService().checkAllAccounts();
    sendAccountStatusesChanged();
    return statuses;
  });
};
