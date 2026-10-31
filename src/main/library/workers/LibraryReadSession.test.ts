import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../database/createDatabase';
import { LibraryReadSession } from './LibraryReadSession';
import type { LibraryReadRequest } from './LibraryReadWorker';

let writer: Database.Database | null = null;
let session: LibraryReadSession | null = null;
let directory: string | null = null;
const request = (search?: string): LibraryReadRequest & { kind: 'tracks' } => ({
  id: 1, kind: 'tracks', query: { search, sourceProvider: 'local', pageSize: 1 }, searchOptions: {},
});

afterEach(() => {
  session?.close();
  session = null;
  writer?.close();
  writer = null;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const setup = (): LibraryReadSession => {
  directory = mkdtempSync(join(tmpdir(), 'echo-read-session-'));
  const path = join(directory, 'library.sqlite');
  writer = createDatabase(path);
  writer.exec(`
    INSERT INTO folders(id, path, name, created_at, updated_at) VALUES ('folder', '/fixture', 'Fixture', '', '');
    INSERT INTO tracks(id, path, folder_id, size_bytes, mtime_ms, title, artist, album, album_artist,
      year, genre, sample_rate, field_sources_json, created_at, updated_at)
    VALUES ('one', '/fixture/one.flac', 'folder', 1, 1, 'Needle One', 'Artist', 'Album', 'Artist',
      2026, 'Rock', 44100, '{}', '', '');
  `);
  session = new LibraryReadSession(path);
  return session;
};

describe('LibraryReadSession', () => {
  it('reuses burst reads but observes external tag edits, removals and filter changes', () => {
    const reader = setup();
    expect(reader.read(request('Needle'))).toMatchObject({ total: 1, items: [{ title: 'Needle One' }] });
    writer!.exec("UPDATE tracks SET title = 'Changed', year = 2025 WHERE id = 'one'");
    expect(reader.read(request('Needle'))).toMatchObject({ total: 0, items: [] });
    expect(reader.read(request('Changed'))).toMatchObject({ total: 1, items: [{ title: 'Changed' }] });
    expect(reader.read({ ...request(), query: { filterYear: 2026 } })).toMatchObject({ total: 0 });
    expect(reader.read({ ...request(), query: { filterYear: 2025, filterGenre: 'rock' } })).toMatchObject({ total: 1 });
    writer!.exec("UPDATE tracks SET missing = 1 WHERE id = 'one'");
    expect(reader.read(request('Changed'))).toMatchObject({ total: 0, items: [] });
  });

  it('releases idle handles, reopens on demand and closes immediately for maintenance', () => {
    vi.useFakeTimers();
    const reader = setup();
    const close = vi.spyOn(Database.prototype, 'close');
    reader.read(request());
    reader.read(request());
    expect(close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2500);
    expect(close).toHaveBeenCalledTimes(1);
    expect(reader.read(request())).toMatchObject({ total: 1 });
    reader.close();
    expect(close).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(2500);
    expect(close).toHaveBeenCalledTimes(2);
  });
});
