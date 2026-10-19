import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EchoDatabase } from '../database/createDatabase';
import { runCooperativeSteps } from './CooperativeSteps';

export class LibraryMaintenanceInterrupted extends Error {
  constructor() { super('Library changed during maintenance; rebuild will be retried.'); }
}

/** Disk-backed staging on the existing writer; no second SQLite writer or long JS transaction. */
export class LibraryMaintenanceWorkspace {
  private readonly root = mkdtempSync(join(tmpdir(), 'echo-library-maintenance-'));
  private expectedChanges = 0;
  private readonly version: number;

  constructor(private readonly database: EchoDatabase) {
    try {
      database.prepare('ATTACH DATABASE ? AS echo_library_work').run(join(this.root, 'staging.sqlite'));
      database.exec('PRAGMA echo_library_work.cache_size = -4096');
      database.exec('PRAGMA echo_library_work.journal_mode = OFF');
      this.version = this.dataVersion();
      this.expectedChanges = this.changes();
    } catch (error) {
      try { database.exec('DETACH DATABASE echo_library_work'); } catch { /* Attach may have failed. */ }
      rmSync(this.root, { recursive: true, force: true });
      throw error;
    }
  }

  table(name: string): string {
    if (!/^[a-z_]+$/u.test(name)) throw new Error('Invalid maintenance table');
    return `echo_library_work.${name}`;
  }

  snapshot(name: string, sql: string): void {
    this.database.exec(`CREATE TABLE ${this.table(name)} AS ${sql}`);
  }

  *rows(name: string): Generator<Record<string, unknown>> {
    let rowId = 0;
    for (;;) {
      const rows = this.database.prepare<[number], Record<string, unknown>>(
        `SELECT rowid AS work_row_id, * FROM ${this.table(name)} WHERE rowid > ? ORDER BY rowid LIMIT 200`,
      ).all(rowId);
      if (!rows.length) return;
      rowId = Number(rows[rows.length - 1]!.work_row_id);
      yield* rows;
    }
  }

  run<T>(steps: Generator<void, T, void>): Promise<T> {
    return runCooperativeSteps(steps, () => this.check(), () => {
      // Other connections can commit even during a synchronous step.
      if (this.dataVersion() !== this.version) throw new LibraryMaintenanceInterrupted();
      this.expectedChanges = this.changes();
    });
  }

  check(): void {
    if (!this.database.open || this.changes() !== this.expectedChanges || this.dataVersion() !== this.version) {
      throw new LibraryMaintenanceInterrupted();
    }
  }

  publish(includeAlbums: boolean): void {
    this.check();
    this.database.transaction(() => {
      this.database.exec('DELETE FROM artist_tracks; DELETE FROM artist_albums; DELETE FROM artists');
      if (includeAlbums) this.database.exec(`
        DELETE FROM album_tracks; DELETE FROM albums;
        INSERT INTO albums SELECT * FROM ${this.table('albums')};
        INSERT INTO album_tracks SELECT * FROM ${this.table('album_tracks')};
      `);
      this.database.exec(`
        INSERT INTO artists SELECT * FROM ${this.table('artists')};
        INSERT INTO artist_tracks SELECT * FROM ${this.table('artist_tracks')};
        INSERT INTO artist_albums SELECT * FROM ${this.table('artist_albums')};
      `);
    })();
  }

  close(): void {
    try { if (this.database.open) this.database.exec('DETACH DATABASE echo_library_work'); }
    finally { rmSync(this.root, { recursive: true, force: true }); }
  }

  private changes(): number {
    return Number(this.database.prepare<[], { n: number }>('SELECT total_changes() AS n').get()!.n);
  }
  private dataVersion(): number {
    return Number(this.database.pragma('data_version', { simple: true }));
  }
}
