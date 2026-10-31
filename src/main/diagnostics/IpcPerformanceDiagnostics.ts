import { beginIpcMainHandler } from './PlaybackPerformanceDiagnostics';

type IpcMainHandler = (event: unknown, ...args: unknown[]) => unknown;
type IpcMainLike = {
  handle: (channel: string, listener: IpcMainHandler) => unknown;
};

const wrappedHandleMarker = Symbol.for('echo.ipcPerformanceDiagnostics.wrappedHandle');

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  Boolean(value && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function');

const wrapIpcMainHandler = (channel: string, handler: IpcMainHandler): IpcMainHandler =>
  (event, ...args) => {
    const complete = beginIpcMainHandler(channel);

    try {
      const result = handler(event, ...args);
      if (isThenable(result)) {
        return Promise.resolve(result).then(
          (value) => {
            complete(false);
            return value;
          },
          (error) => {
            complete(true);
            throw error;
          },
        );
      }

      complete(false);
      return result;
    } catch (error) {
      complete(true);
      throw error;
    }
  };

export const installIpcPerformanceDiagnostics = (ipcMain: IpcMainLike): void => {
  const currentHandle = ipcMain.handle as IpcMainLike['handle'] & { [wrappedHandleMarker]?: true };
  if (currentHandle[wrappedHandleMarker]) {
    return;
  }

  const originalHandle = currentHandle.bind(ipcMain);
  const wrappedHandle = ((channel: string, listener: IpcMainHandler) =>
    originalHandle(channel, wrapIpcMainHandler(channel, listener))) as IpcMainLike['handle'] & {
      [wrappedHandleMarker]?: true;
    };
  wrappedHandle[wrappedHandleMarker] = true;
  ipcMain.handle = wrappedHandle;
};
