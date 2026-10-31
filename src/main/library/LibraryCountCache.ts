import { createHash } from 'node:crypto';
import type { EchoDatabase } from '../database/createDatabase';

const maxEntries = 32;

/** Cache only membership counts; page contents and ordering are always read afresh. */
export class LibraryCountCache {
  private readonly entries = new Map<string, number>();
  private revision = '';
  private readonly readRevision;

  constructor(private readonly database: EchoDatabase) {
    this.readRevision = database.prepare<[], { version: number; changes: number }>(
      'SELECT data_version AS version, total_changes() AS changes FROM pragma_data_version',
    );
  }

  read(sql: string, params: readonly unknown[], context = ''): number {
    // A writer transaction can roll back without changing total_changes() again.
    // Never remember its uncommitted counts or reuse a previous snapshot in it.
    if (this.database.inTransaction && !this.database.readonly) {
      this.entries.clear();
      return this.query(sql, params);
    }

    const stamp = this.readRevision.get();
    const revision = `${stamp?.version}:${stamp?.changes}`;
    if (revision !== this.revision) {
      this.entries.clear();
      this.revision = revision;
    }

    const key = createHash('sha256').update(JSON.stringify([sql, params, context])).digest('hex');
    const cached = this.entries.get(key);
    if (cached !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }

    const total = this.query(sql, params);
    this.entries.set(key, total);
    if (this.entries.size > maxEntries) this.entries.delete(this.entries.keys().next().value!);
    return total;
  }

  private query(sql: string, params: readonly unknown[]): number {
    return Number(this.database.prepare<unknown[], { total: number }>(sql).get(...params)?.total ?? 0);
  }
}
