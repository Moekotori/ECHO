import { setImmediate as yieldToMainLoop } from 'node:timers/promises';

type ReadCueRows = (sql: string, ...parameters: Array<string | number>) => Array<Record<string, unknown>>;

/** Do not turn an incremental/preview request into a synchronous whole-folder SQL scan. */
export const hasSidecarCueTracks = async (read: ReadCueRows, folderId: string, isCurrent: () => boolean): Promise<boolean> => {
  if (!isCurrent()) return false;
  const ceiling = Number(read('SELECT MAX(rowid) AS ceiling FROM tracks')[0]?.ceiling ?? 0);
  let cursor = 0;
  while (cursor < ceiling && isCurrent()) {
    const page = read(`SELECT MAX(rowid) AS cursor, COUNT(*) AS count,
      MAX(CASE WHEN path LIKE '%.cue#cueTrack=%' THEN 1 ELSE 0 END) AS found
      FROM (SELECT rowid, path FROM tracks WHERE folder_id = ? AND missing = 0
        AND rowid > ? AND rowid <= ? ORDER BY rowid LIMIT 128)`, folderId, cursor, ceiling)[0];
    if (Number(page?.found ?? 0) > 0) return true;
    if (Number(page?.count ?? 0) < 128) return false;
    cursor = Number(page?.cursor ?? ceiling);
    await yieldToMainLoop();
  }
  return false;
};
