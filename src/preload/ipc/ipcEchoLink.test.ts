import { describe, expect, it } from 'vitest';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import { createMockIpcRenderer } from '../../test-utils/electronMocks';
import { createEchoLinkApi } from './ipcEchoLink';

describe('createEchoLinkApi', () => {
  it('exposes the independent ECHO Link Basic IPC surface', async () => {
    const ipc = createMockIpcRenderer();
    const api = createEchoLinkApi(ipc as never, IpcChannels);

    await api.getStatus();
    await api.setEnabled(true);
    await api.startPairing();
    await api.cancelPairing();
    await api.revokeClient('client-1');

    expect(ipc.invoke).toHaveBeenNthCalledWith(1, IpcChannels.EchoLinkBasicGetStatus);
    expect(ipc.invoke).toHaveBeenNthCalledWith(2, IpcChannels.EchoLinkBasicSetEnabled, true);
    expect(ipc.invoke).toHaveBeenNthCalledWith(3, IpcChannels.EchoLinkBasicStartPairing);
    expect(ipc.invoke).toHaveBeenNthCalledWith(4, IpcChannels.EchoLinkBasicCancelPairing);
    expect(ipc.invoke).toHaveBeenNthCalledWith(5, IpcChannels.EchoLinkBasicRevokeClient, 'client-1');
  });
});
