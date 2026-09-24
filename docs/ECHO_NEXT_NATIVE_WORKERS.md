# ECHO Next Native Worker Ready Architecture

Library Core v0.1 is deliberately native-worker-ready. TypeScript owns orchestration, SQLite, IPC validation, pagination APIs, scan jobs, and UI-facing business rules. Heavy work is called through stable worker interfaces so Rust or C++ can replace the first TS implementation without changing Renderer, IPC, or the SQLite schema.

## Worker Boundary

Stable interfaces live under `src/main/library/workers/`:

- `MetadataReader.read(filePath) -> MetadataResult`
- `CoverExtractor.extract(filePath, options) -> CoverResult`
- `FileScanner.scanFolder(folderPath, options) -> AsyncIterable<ScannedFile>`

Current implementations:

- `TsMetadataReader`: `music-metadata`, embedded tags first, filename/folder fallback only for missing fields
- `TsCoverExtractor`: TS+sharp v0.2 cover worker; embedded cover, same-folder cover/front/folder image, generated default, cached paths on disk, and real resize output
- `TsFileScanner`: recursive file enumeration and stat only

Future implementations can be swapped in as:

- `RustMetadataWorker`
- `RustCoverWorker`
- `RustFileScanner`

`LibraryService` and `ScanJobQueue` depend on the interfaces, not on TS concrete classes. Renderer and preload never know which worker implementation is active.

## Stable Return Shapes

`MetadataResult` includes:

- normalized metadata fields
- `fieldSources`
- embedded cover bytes when available for the cover worker
- `warnings`
- `errors`
- `status`

`CoverResult` includes:

- `source`
- `thumbPath`
- `albumPath`
- `largePath`
- `originalRef`
- `sourceHash`
- `mimeType`
- `warnings`
- `errors`

`ScannedFile` includes:

- `path`
- `sizeBytes`
- `mtimeMs`

These shapes are the contract a native worker must preserve. Raw parser details may exist inside the worker result for diagnostics, but Renderer list APIs do not receive them.

## Rust/C++ Priority

Priority order for native work:

1. `CoverWorker`: highest priority only if TS+sharp v0.2 fails measured cover-generation targets.
2. `MetadataWorker`: second priority; tag parsing can become expensive on large libraries.
3. `FileScanner`: only Rust/C++ if 3000/10000 track pressure tests show TS directory walking is a bottleneck.

Audio output is already moving in the same direction through `echo-audio-host`.

## Service Boundary

TypeScript service layer:

- creates scan jobs
- checks incremental cache keys
- schedules worker calls with concurrency limits
- writes SQLite in transactions
- persists album and artist indexes
- exposes paginated IPC-safe results

Worker layer:

- reads tags
- extracts/caches covers; current TS+sharp v0.2 uses `sharp` for resize while TypeScript owns priority and cache scheduling
- enumerates files and stat data

IPC:

- validates input
- calls `LibraryService`
- does not run SQL, parse metadata, extract covers, or scan folders

Renderer:

- calls typed preload methods
- renders paginated tracks/albums/folders/status
- does not group albums, generate covers, scan files, or hold the full library in memory

## Performance Budget

Targets for Phase 1 and Phase 1.5 validation:

- app startup must not scan the whole library
- `getTracks` first page target: under 200 ms
- `getAlbums` first page target: under 300 ms
- unchanged scan skip rate should approach 100%
- cover thumbnails are generated during scan, not while UI scrolls
- album wall reads persisted `albums` rows after restart
- `getTracks` and `getAlbums` never return full cover binary/base64
- scan jobs run in the background and remain cancellable
- metadata and cover workers use concurrency limits
- large libraries must not leave CPU near 50% because an album wall is rendering

## Phase 1.5 Validation

Phase 1.5 Native Worker & Performance Validation:

- use Phase 1.1 `library.getDiagnostics()`, smoke tests, and `npm run benchmark:library` results before committing to native worker work
- build a Go/C#/Rust `CoverWorker` only if cover extraction/cache generation is the measured bottleneck
- evaluate Rust `MetadataWorker`
- run 3000 and 10000 track pressure tests and 3000 and 10000 album-wall pressure tests
- record CPU, memory, total scan time, metadata time, cover time, and album wall load time
- decide from measurements whether `FileScanner` needs Rust/C++
- verify worker replacement does not change Renderer, IPC, SQLite schema, or list payloads

Native CoverWorker decision indicators:

- generating 1000 album thumbs keeps CPU above 50% for a long stretch
- generating 3000 or 10000 covers has unacceptable memory peaks
- Electron `sharp` packaging or native rebuilds are unstable
- cover cache hits remain slow after `thumb.webp` and `album.webp` exist
