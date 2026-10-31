import Database from 'better-sqlite3';
import { LibraryStore, type LibraryStoreSearchOptions } from '../LibraryStore';
import type { LibraryReadRequest, LibraryReadResult } from './LibraryReadWorker';

const idleCloseMs = 2500;

/** Reuse a bounded read cache during typing/scrolling, releasing handles when idle. */
export class LibraryReadSession {
  private database: Database.Database | null = null;
  private store: LibraryStore | null = null;
  private searchOptions: LibraryStoreSearchOptions = {};
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly databasePath: string) {}

  read(request: LibraryReadRequest): LibraryReadResult {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.searchOptions = request.searchOptions;
    try {
      if (!this.database) {
        const database = new Database(this.databasePath, { readonly: true, fileMustExist: true, timeout: 1000 });
        this.database = database;
        database.pragma('cache_size = -4096');
        this.store = new LibraryStore(database, () => this.searchOptions);
      }
      const store = this.store!;
      return this.database.transaction(() => {
        if (request.kind === 'stats') {
          return request.query?.statsMode === 'activity'
            ? store.getPlaybackStatsDashboardActivity(request.query)
            : store.getPlaybackStatsDashboard(request.query);
        }
        return request.kind === 'tracks' ? store.getTracks(request.query) : store.getAlbums(request.query);
      })();
    } catch (error) {
      this.close();
      throw error;
    } finally {
      if (this.database) {
        this.idleTimer = setTimeout(() => this.close(), idleCloseMs);
        this.idleTimer.unref();
      }
    }
  }

  close(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.store = null;
    this.database?.close();
    this.database = null;
  }
}
