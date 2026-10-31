import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import type { LyricsRomanizationWorkerLike } from './LyricsRomanizationWorkerClient';
import type { LyricsRomanizationWorkerRequest } from './LyricsRomanizationWorkerProtocol';

// Keep the Steam request lifecycle, but use a process boundary: on macOS,
// terminating a thread can leave the dictionary's native allocations resident.
export const createLyricsRomanizationProcess = (source: URL): LyricsRomanizationWorkerLike => {
  const child = electron.utilityProcess.fork(fileURLToPath(source), [], {
    serviceName: 'Lyrics romanization',
    stdio: 'ignore',
  });
  const transport = new EventEmitter() as EventEmitter & LyricsRomanizationWorkerLike;
  const queued: LyricsRomanizationWorkerRequest[] = [];
  let spawned = false;
  let closed = false;

  const terminate = (): number => {
    closed = true;
    queued.length = 0;
    child.kill();
    return 0;
  };
  const onQuit = (): void => { terminate(); };
  electron.app.once('will-quit', onQuit);

  transport.postMessage = (message) => {
    if (closed) throw new Error('Lyrics romanization process is closed');
    if (spawned) child.postMessage(message);
    else queued.push(message);
  };
  transport.terminate = terminate;

  child.once('spawn', () => {
    spawned = true;
    if (closed) {
      child.kill();
      return;
    }
    try {
      for (const message of queued.splice(0)) child.postMessage(message);
    } catch (error) {
      transport.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  });
  child.on('message', (message) => transport.emit('message', message));
  child.on('error', (type, location) => transport.emit('error', new Error(`${type}: ${location}`)));
  child.once('exit', (code) => {
    closed = true;
    queued.length = 0;
    electron.app.removeListener('will-quit', onQuit);
    transport.emit('exit', code);
  });
  return transport;
};
