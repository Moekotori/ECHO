import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../database/createDatabase';
import { LibraryStore } from '../LibraryStore';

describe('large explicit analysis selections', () => {
  it('accepts a selection larger than SQLite variable and JavaScript argument limits', () => {
    const database = createDatabase(':memory:');
    try {
      const store = new LibraryStore(database);
      const folder = store.addFolder('/analysis-fixture');
      database.prepare(`INSERT INTO tracks (id, path, folder_id, size_bytes, mtime_ms,
        title, artist, album, album_artist, field_sources_json, created_at, updated_at)
        VALUES ('included', '/analysis-fixture/song.flac', ?, 1, 1, 'Song', 'Artist', 'Album', 'Artist', '{}', 'now', 'now')`).run(folder.id);
      const ids = Array.from({ length: 150000 }, (_, index) => `missing-${index}`);
      ids.push('included');
      expect(store.findBpmAnalysisTargets(1, ids).map(track => track.id)).toEqual(['included']);
      expect(store.findReplayGainAnalysisTargets(1, ids).map(track => track.id)).toEqual(['included']);
      database.prepare("UPDATE tracks SET replay_gain_source = 'tag'").run();
      expect(store.findReplayGainAnalysisTargets(1, ids)).toEqual([]);
      expect(store.findReplayGainAnalysisTargets(1, ids, true)).toHaveLength(1);
    } finally { database.close(); }
  });
});
