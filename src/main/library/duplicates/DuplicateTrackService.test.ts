import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type EchoDatabase } from '../../database/createDatabase';
import { LibraryStore } from '../LibraryStore';
import { DuplicateTrackService } from './DuplicateTrackService';
import { LibraryMaintenanceInterrupted } from '../LibraryMaintenanceWorkspace';

let database: EchoDatabase;
afterEach(() => { if (database?.open) database.close(); });
function fixture(count = 750) {
  database = createDatabase(':memory:');
  const folder = new LibraryStore(database).addFolder('/music');
  database.transaction(() => {
    const insert = database.prepare(`INSERT INTO tracks
      (id, path, folder_id, title, artist, album, album_artist, field_sources_json, duration, size_bytes, mtime_ms, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'Artist', 'Album', 'Artist', '{}', ?, 10, 1, 'now', 'now')`);
    for (let index = 0; index < count; index += 1) {
      insert.run(String(index), `/music/${index}.flac`, folder.id, 'Song', 180 + (index % 3) * 1.9);
    }
  })();
  return new DuplicateTrackService(database, () => null);
}
const members = () => database.prepare(`SELECT track_id, quality_score, rank, hidden
  FROM duplicate_track_members ORDER BY track_id`).all();

describe('large duplicate index maintenance', () => {
  it('preserves strict duration bounds and ranking while yielding through a large single bucket', async () => {
    const service = fixture();
    const sync = service.rebuildDuplicateTrackIndex();
    const before = members();
    let checks = 0;
    const timer = setInterval(() => { expect(members()).toEqual(before); checks += 1; }, 0);
    let asyncResult;
    try { asyncResult = await service.rebuildDuplicateTrackIndexAsync(); }
    finally { clearInterval(timer); }
    expect(asyncResult).toMatchObject({ ...sync, updatedAt: expect.any(String) });
    expect(members()).toEqual(before);
    expect(checks).toBeGreaterThan(0);
    expect(sync.duplicateGroups).toBe(2);
    const preview = await service.scanCleanupPreview();
    expect(preview.summary.duplicateMembers).toBe(sync.duplicateMembers);
  });

  it('keeps the old index if tracks change during rebuilding and supports a retry', async () => {
    const service = fixture();
    service.rebuildDuplicateTrackIndex();
    const before = members();
    const pending = service.rebuildDuplicateTrackIndexAsync();
    const rejected = expect(pending).rejects.toBeInstanceOf(LibraryMaintenanceInterrupted);
    await new Promise<void>(resolve => setImmediate(() => {
      database.prepare("UPDATE tracks SET title = 'Edited' WHERE id = '0'").run();
      resolve();
    }));
    await rejected;
    expect(members()).toEqual(before);
    await service.rebuildDuplicateTrackIndexAsync();
    expect(members().length).toBe(before.length - 1);
    expect(database.prepare<[], { name: string }>('PRAGMA database_list').all().some(row => row.name.startsWith('echo_library_work_'))).toBe(false);
  });
});
