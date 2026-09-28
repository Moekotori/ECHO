import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { LibraryStore } from '../LibraryStore';
import type { LibraryReadRequest, LibraryReadResponse } from './LibraryReadWorker';

parentPort?.on('message', (request: LibraryReadRequest) => {
  let database: Database.Database | null = null;
  let response: LibraryReadResponse;
  try {
    // Never migrate, backfill, or retain a file handle between requests.
    database = new Database(workerData.databasePath, { readonly: true, fileMustExist: true, timeout: 1_000 });
    const store = new LibraryStore(database, () => request.searchOptions);
    const page = database.transaction(() => request.kind === 'tracks'
      ? store.getTracks(request.query)
      : store.getAlbums(request.query))();
    response = { id: request.id, ok: true, page };
  } catch (error) {
    response = { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    database?.close();
  }
  parentPort?.postMessage(response);
});
