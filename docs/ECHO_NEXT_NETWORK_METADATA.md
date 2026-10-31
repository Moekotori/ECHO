# ECHO Next Network Metadata Completion

Network metadata is weak completion. It is never a second metadata reader and never a replacement for embedded tags, sidecar files, folder structure, or manual edits.

## Readiness States

Tracks persist explicit readiness:

- `embedded_metadata_status`: `pending`, `reading`, `present`, `missing`, `error`
- `embedded_cover_status`: `pending`, `reading`, `present`, `missing`, `error`
- `network_metadata_status`: `none`, `pending`, `candidate_found`, `applied_missing_only`, `rejected`, `error`

`pending` and `reading` mean "not ready yet", not "absent". Network completion must not treat null fields, fallback display values, or missing cover ids as proof that embedded data is absent.

## Three-Phase Flow

Phase A: Local Metadata Read

- `FileScanner` discovers files.
- `MetadataReader` reads embedded tags and marks embedded metadata `present`, `missing`, or `error`.
- `CoverExtractor` reads embedded/folder cover and marks embedded cover `present`, `missing`, or `error`.
- `tracks` and `covers` are written only after local readers finish.

Phase B: Local Finalize

- Album grouping and artist refresh run from local rows.
- Tracks and albums are usable immediately.
- UI is not blocked by network completion.

Phase C: Network Completion

- Manual trigger only.
- Provider results first go to candidate tables.
- High-confidence candidates may apply missing-only fields.
- Lower-confidence candidates remain visible for review.
- Rejected candidates are recorded and filtered from future prompts.

## Candidate Tables

Network metadata candidates live in `network_metadata_candidates`.

Network decisions live in `network_metadata_decisions` with `applied_fields_json`, so every accepted/rejected/ignored decision is auditable.

Network cover candidates live in `network_cover_candidates`. A network cover URL is never returned to Renderer as artwork. Accepted covers must pass through the cover cache pipeline and become local `thumb`, `album`, and `large` files referenced by `covers`.

## Merge Rules

Metadata priority:

1. manual
2. embedded
3. sidecar/info
4. folder_structure
5. network
6. filename_fallback

Network may write title, artist, album, albumArtist, year, genre, trackNo, and discNo only when:

- `embedded_metadata_status` is `missing` or `error`
- candidate score is at least `0.92` for automatic missing-only application
- the existing field source is `unknown`, `filename_fallback`, or `network`

Network cannot overwrite `manual`, `embedded`, `sidecar`, or `folder_structure`.

Filename fallback cannot overwrite `manual`, `embedded`, `sidecar`, `folder_structure`, or `network`.

Cover priority:

1. manual
2. embedded
3. folder/front/cover
4. network
5. default

Network covers may apply only when:

- `embedded_cover_status` is `missing` or `error`
- current cover source is `default`
- score is at least `0.92`

Network covers never overwrite manual, embedded, or folder covers.

## Scoring

`matchScore.ts` weights title and artist highest, album medium-high, and duration strongly. A duration difference over 10 seconds caps the score below automatic application. If title or artist similarity is weak, a candidate cannot reach high confidence.

Thresholds:

- `score >= 0.92`: eligible for automatic `applyMissingOnly`
- `0.75 <= score < 0.92`: visible candidate, user confirmation required
- `score < 0.75`: filtered or treated as low priority

## Providers

The provider boundary is `NetworkMetadataProvider`.

Current first-pass providers:

- `MockMetadataProvider`: architecture and tests
- `NeteaseCloudMusicProvider`: mainland China-friendly metadata candidates
- `QQMusicProvider`: mainland China-friendly metadata and album-cover URL candidates
- `MusicBrainzProvider`: metadata candidates
- `CoverArtArchiveProvider`: cover boundary placeholder

Providers are not wired into `MetadataReader`. They run behind `NetworkMetadataService` and `NetworkMetadataJobQueue` with concurrency at most 2, timeouts, candidate storage, and failure isolation.

## Why This Avoids The Old ECHO Bug

Old ECHO could see no embedded title/artist/cover yet, assume none existed, and let filename guesses or network data win. ECHO Next stores readiness separately from values:

- Before local read completes, status is `pending` or `reading`.
- Network merge refuses to write metadata while embedded metadata is `pending` or `reading`.
- Network merge refuses to write covers while embedded cover is `pending` or `reading`.
- Once embedded data is `present`, protected field sources prevent network overwrite.
- Only confirmed `missing` or reader `error` opens the missing-only network path.

The important rule is simple: "temporarily unavailable" is not "missing".
