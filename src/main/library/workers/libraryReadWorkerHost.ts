import { parentPort, workerData } from 'node:worker_threads';
import { LibraryReadSession } from './LibraryReadSession';
import type { LibraryReadRequest, LibraryReadResponse } from './LibraryReadWorker';

const session = new LibraryReadSession(workerData.databasePath);
parentPort?.on('close', () => session.close());
parentPort?.on('message', (request: LibraryReadRequest | { kind: 'close' }) => {
  if (request.kind === 'close') {
    session.close();
    parentPort?.close();
    return;
  }
  let response: LibraryReadResponse;
  try {
    const page = session.read(request);
    response = { id: request.id, ok: true, page };
  } catch (error) {
    response = { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  parentPort?.postMessage(response);
});
