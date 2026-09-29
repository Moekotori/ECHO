import { ipcMain, BrowserWindow } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import { getSleepTimerService } from '../sleepTimer/SleepTimerService';
import type { SleepTimerStartRequest, SleepTimerStatus } from '../../shared/types/sleepTimer';

/** 注册睡眠定时器相关 IPC 通道 */
export const registerSleepTimerIpc = (): void => {
  const service = getSleepTimerService();

  // 启动定时器
  ipcMain.handle(IpcChannels.SleepTimerStart, async (_event, request: SleepTimerStartRequest): Promise<SleepTimerStatus> => {
    service.start(request);
    return service.getStatus();
  });

  // 取消定时器
  ipcMain.handle(IpcChannels.SleepTimerCancel, async (): Promise<SleepTimerStatus> => {
    service.cancel();
    return service.getStatus();
  });

  // 查询状态
  ipcMain.handle(IpcChannels.SleepTimerGetStatus, async (): Promise<SleepTimerStatus> => {
    return service.getStatus();
  });

  // 每秒推送剩余时间到所有渲染进程
  service.onTick((remainingMs) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IpcChannels.SleepTimerOnTick, remainingMs);
      }
    }
  });
};
