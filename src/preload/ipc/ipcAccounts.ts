import type { EchoApi } from '../apiTypes';

export function createAccountsApi(
  ipcRenderer: Electron.IpcRenderer,
  IpcChannels: Record<string, string>,
): EchoApi['accounts'] {
  return {
    getStatuses: () => ipcRenderer.invoke(IpcChannels.AccountGetStatuses),
    getStatus: (provider) => ipcRenderer.invoke(IpcChannels.AccountGetStatus, provider),
    saveCookie: (provider, cookie) => ipcRenderer.invoke(IpcChannels.AccountSaveCookie, provider, cookie),
    startLogin: (provider) => ipcRenderer.invoke(IpcChannels.AccountStartLogin, provider),
    clear: (provider) => ipcRenderer.invoke(IpcChannels.AccountClear, provider),
    check: (provider) => ipcRenderer.invoke(IpcChannels.AccountCheck, provider),
    checkAll: () => ipcRenderer.invoke(IpcChannels.AccountCheckAll),
    onStatusesChanged: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, statuses: unknown): void => {
        handler(Array.isArray(statuses) ? (statuses as Awaited<ReturnType<NonNullable<EchoApi['accounts']>['getStatuses']>>) : []);
      };
      ipcRenderer.on(IpcChannels.AccountStatusesChanged, listener);
      return () => ipcRenderer.off(IpcChannels.AccountStatusesChanged, listener);
    },
  };
}
