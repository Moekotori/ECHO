import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { hasSidecarCueTracks } from './CueTrackReferences';

it('finds sidecar dependencies across pages without accepting missing or other-folder rows', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE tracks (folder_id TEXT, path TEXT, missing INTEGER)');
    const insert = db.prepare('INSERT INTO tracks VALUES (?, ?, ?)');
    for (let index = 0; index < 140; index++) insert.run('music', `/music/${index}.flac`, 0);
    insert.run('other', '/other/album.cue#cueTrack=1', 0);
    insert.run('music', '/music/old.cue#cueTrack=1', 1);
    const read = (sql: string, ...parameters: Array<string | number>) => db.prepare(sql).all(...parameters) as Array<Record<string, unknown>>;
    expect(await hasSidecarCueTracks(read, 'music', () => true)).toBe(false);
    insert.run('music', '/music/sheets/album.cue#cueTrack=1', 0);
    expect(await hasSidecarCueTracks(read, 'music', () => true)).toBe(true);
    expect(await hasSidecarCueTracks(read, 'music', () => false)).toBe(false);
  } finally { db.close(); }
});
