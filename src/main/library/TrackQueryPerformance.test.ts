import { afterEach, expect, it } from 'vitest';
import { createDatabase, type EchoDatabase } from '../database/createDatabase';
import { LibraryStore } from './LibraryStore';
import type { LibraryPageQuery, LibrarySort } from '../../shared/types/library';
let db: EchoDatabase;
afterEach(() => db?.close());
const fixture = (count = 8) => {
  db = createDatabase(':memory:');
  const now = '2026-10-19T00:00:00Z';
  db.prepare('INSERT INTO folders (id,path,name,created_at,updated_at) VALUES (?,?,?,?,?)').run('f','/music','music',now,now);
  db.prepare('INSERT INTO remote_sources (id,provider,display_name,created_at,updated_at) VALUES (?,?,?,?,?)').run('r','webdav','Remote',now,now);
  const local = db.prepare(`INSERT INTO tracks (id,path,folder_id,title,artist,album,album_artist,size_bytes,mtime_ms,created_at,updated_at,field_sources_json,year,codec,sample_rate,bit_depth,track_no,duration,bitrate,bpm)
    VALUES (?,?, 'f',?,?,?,'Artist',100,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const remote = db.prepare(`INSERT INTO remote_tracks (id,source_id,provider,remote_path,remote_url_hash,stable_key,title,artist,album,album_artist,created_at,updated_at,year,availability)
    VALUES (?,'r','webdav',?,?,?,?,?,?,'Artist',?, ?,?,'available')`);
  db.transaction(() => {
    for (let i=0;i<count;i++) {
      const id=`t${i}`,title=`Song ${String(count-i).padStart(6,'0')}`, artist=`Artist ${i%3}`;
      local.run(id,`/music/${id}.flac`,title,artist,`Album ${i%2}`,i,now,now,JSON.stringify({notes:'x'.repeat(2048)}),i%2?2026:null,'FLAC',i%2?96000:null,i%2?24:null,i%2?i:null,100+i,1000+i,i%2?120:null);
      if (i<4) remote.run(id,`/${id}.mp3`,id,id,title,artist,'Remote album',now,now,2025);
    }
  })();
  return new LibraryStore(db);
};
const sorts: LibrarySort[] = ['default','createdAsc','createdDesc','yearAsc','yearDesc','titleAsc','titleDesc','durationAsc','durationDesc','fileModifiedAsc','fileModifiedDesc','qualityAsc','qualityDesc','codecAsc','codecDesc','audioSpecAsc','audioSpecDesc','bitrateAsc','bitrateDesc','bpmAsc','bpmDesc','trackNumber','frequent','playCountAsc','playCountDesc','lastPlayed','title','artist','artistDesc','artistAlbum','album','albumDesc','recent'];
it('paginates every sort with complete metadata across local/remote ID collisions and FTS', () => {
  const store = fixture();
  for (const sort of sorts) for (const extra of [{}, {search:'Song'}, {sourceProvider:'local'}, {sourceId:'r'}, {sorts:[sort,'artistDesc','yearAsc']}] as Partial<LibraryPageQuery>[]) {
    const query = {sort, ...extra};
    const whole = store.getTracks({...query, pageSize:100});
    const page = store.getTracks({...query, pageSize:3, page:2});
    expect(page.items, JSON.stringify(query)).toEqual(whole.items.slice(3,6));
    expect(page.total).toBe(whole.total);
  }
  expect(store.getTracks({sort:'titleAsc', pageSize:3}).items.map(item => item.id)).toEqual(['t7','t6','t5']);
  expect(store.getTracks({search:'Song',showDuplicatesOnly:true})).toMatchObject({total:0, items:[]});
  db.exec("UPDATE tracks SET title = 'Changed' WHERE id = 't0'");
  expect(store.getTracks({search:'Changed'})).toMatchObject({total:1,items:[{id:'t0',title:'Changed'}]});
});

it('keeps playback aggregates on the correct source during hydration', () => {
  const store = fixture();
  db.exec(`INSERT INTO playback_history_stats(history_key,track_id,track_path,media_type,provider,stable_key,title,artist,completed_count,last_started_at,updated_at)
    VALUES ('local','t0','/music/t0.flac','local',NULL,NULL,'Song','Artist',3,'2026','2026'),
           ('remote','t0','remote://r/t0.mp3','remote','webdav','t0','Song','Artist',7,'2026','2026')`);
  const page = store.getTracks({sort:'playCountDesc',pageSize:2});
  expect(page.items.map(item => [item.id,item.mediaType])).toEqual([['t0','remote'],['t0','local']]);
  db.exec("UPDATE playback_history_stats SET completed_count = 1 WHERE history_key = 'remote'");
  expect(store.getTracks({sort:'playCountDesc',pageSize:2}).items.map(item => item.mediaType)).toEqual(['local','remote']);
});

it('hydrates only sampled candidates for random queues and folder pages', () => {
  const store = fixture();
  const songs = store.getTracks({sort:'random', randomWindow:true, pageSize:3, sourceProvider:'local', excludeTrackIds:['t0']});
  expect(songs.items).toHaveLength(3);
  expect(new Set(songs.items.map(item => item.id)).size).toBe(3);
  expect(songs.items.every(item => item.id !== 't0' && item.codec === 'FLAC')).toBe(true);
  const folder = store.getFolderTracks({folderId:'f',sort:'random',randomWindow:true,pageSize:3,search:'Song'});
  expect(folder.items).toHaveLength(3);
  expect(folder.total).toBe(8);
  expect(store.getFolderTracks({folderId:'f',sort:'titleAsc',pageSize:3,page:2}).items.map(item => item.id)).toEqual(['t4','t3','t2']);
});
