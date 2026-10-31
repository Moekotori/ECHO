# Songs viewport pagination — 2026-09-28

The list exposed the full library scroll range while loading only 100 tracks at a time. A distant scroll could repeatedly request the next page instead of the visible page. Refreshes could supersede an in-flight viewport read or restore an obsolete scroll position, leaving visible skeleton rows. Row positioning also used a fixed 76 px estimate despite taller styled rows.

Changes:

- Request the visible page directly and coalesce wheel destinations while one read is pending.
- Retry reads skipped by a competing refresh, without endlessly retrying failed queries.
- Defer/coalesce library refreshes during active reads. Refresh all pages intersecting the current viewport and retain the list element instead of restoring an old pixel offset over new input.
- Measure rendered row heights and update the visible range when measurements change. Keep adjacent-page prefetch active near the loaded boundary.
- Retain selected track snapshots and a known current-track position across window replacements.

Validation used an independent Electron build/profile and a copy of the existing library snapshot. The original library was not modified. The copy contained 19,889 local tracks with duplicate hiding disabled; the reported screenshot used a different filtered total.

| Approximate target row | Time until visible rows were populated | Completed reads |
| --- | --- | --- |
| 10,000 | 1,225 ms | 2, pages 100/101 |
| 3,000 | 2,246 ms | 3, one carry-over read plus pages 30/31 |
| 17,000 | 1,715 ms | 2, one carry-over read plus page 170 |

A following normal wheel scroll populated the newly visible rows in approximately 711 ms. Cross-page selection was checked through the real batch context menu. These are bounded samples, not latency guarantees. Individual SQLite reads still took roughly 0.4–0.8 seconds in this run.

22 focused tests passed: viewport scheduling/backpressure, TrackList rendering/measurement/locating and SongsPage jumps/selection/refresh races. The independent build passed. Two existing pagination/refresh test failures were reproduced with both the HEAD implementation and the modified implementation; the broad legacy suite remains affected by its locale/initialization-sensitive fixtures. Full typecheck is currently blocked by six nullable-item errors in the concurrently edited `PlaybackQueueProvider.tsx`; none were reported in this change's files.

Local evidence is under `.cache/song-scroll-audit/`: `verify-scroll.cjs`, `result.json`, `loaded-rows.png`, build/test logs and the baseline comparison configuration.
