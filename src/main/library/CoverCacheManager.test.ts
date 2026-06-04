import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../database/createDatabase';
import {
  getDefaultCoverCacheDir,
  migrateCoverCache,
  resolveConfiguredCoverCacheDir,
  updateCoverPathsInDatabase,
} from './CoverCacheManager';

const tempRoots: string[] = [];

const makeTempRoot = (): string => {
  const root = join(tmpdir(), `echo-next-cover-cache-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('CoverCacheManager', () => {
  it('resolves the default cover cache directory from the database path', () => {
    const root = makeTempRoot();
    const databasePath = join(root, 'library.sqlite');

    expect(resolveConfiguredCoverCacheDir(databasePath, { coverCacheDir: null })).toBe(getDefaultCoverCacheDir(databasePath));
  });

  it('copies nested cover cache files during migration', async () => {
    const root = makeTempRoot();
    const oldDir = join(root, 'old-cache');
    const newDir = join(root, 'new-cache');
    const nestedFile = join(oldDir, 'ab', 'abcdef', 'thumb.webp');
    mkdirSync(join(oldDir, 'ab', 'abcdef'), { recursive: true });
    writeFileSync(nestedFile, 'thumb');

    const result = await migrateCoverCache({ oldDir, newDir });

    expect(result.errors).toEqual([]);
    expect(result.copiedFiles).toBe(1);
    expect(existsSync(join(newDir, 'ab', 'abcdef', 'thumb.webp'))).toBe(true);
  });

  it('updates covers table paths from the old cache directory to the new one', async () => {
    const root = makeTempRoot();
    const oldDir = join(root, 'old-cache');
    const newDir = join(root, 'new-cache');
    const coverDir = join(oldDir, 'aa', 'hash');
    mkdirSync(coverDir, { recursive: true });
    const thumbPath = join(coverDir, 'thumb.webp');
    const albumPath = join(coverDir, 'album.webp');
    const largePath = join(coverDir, 'large.webp');
    const originalRef = join(coverDir, 'original.png');
    for (const filePath of [thumbPath, albumPath, largePath, originalRef]) {
      writeFileSync(filePath, filePath);
    }

    const database = createDatabase(join(root, 'library.sqlite'));
    database
      .prepare(
        `INSERT INTO covers (
          id, source_type, source_hash, mime_type, thumb_path, album_path, large_path, original_ref,
          cache_version, warnings_json, errors_json, cover_thumb, cover_large, cover_original, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'cover-1',
        'embedded',
        'hash',
        'image/png',
        thumbPath,
        albumPath,
        largePath,
        originalRef,
        1,
        '[]',
        '[]',
        thumbPath,
        largePath,
        originalRef,
        new Date().toISOString(),
        new Date().toISOString(),
      );

    const result = await migrateCoverCache({
      oldDir,
      newDir,
      updateCoverPaths: (source, target, warnings) => updateCoverPathsInDatabase(database, source, target, warnings),
    });
    const row = database
      .prepare<unknown[], { thumb_path: string; album_path: string; large_path: string; original_ref: string }>(
        'SELECT thumb_path, album_path, large_path, original_ref FROM covers WHERE id = ?',
      )
      .get('cover-1');

    expect(result.errors).toEqual([]);
    expect(result.updatedCoverRows).toBe(1);
    expect(row?.thumb_path).toBe(resolve(join(newDir, 'aa', 'hash', 'thumb.webp')));
    expect(row?.album_path).toBe(resolve(join(newDir, 'aa', 'hash', 'album.webp')));
    expect(row?.large_path).toBe(resolve(join(newDir, 'aa', 'hash', 'large.webp')));
    expect(row?.original_ref).toBe(resolve(join(newDir, 'aa', 'hash', 'original.png')));
    database.close();
  });

  it('skips an existing target file when the size matches', async () => {
    const root = makeTempRoot();
    const oldDir = join(root, 'old-cache');
    const newDir = join(root, 'new-cache');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(oldDir, 'thumb.webp'), 'same');
    writeFileSync(join(newDir, 'thumb.webp'), 'same');

    const result = await migrateCoverCache({ oldDir, newDir });

    expect(result.errors).toEqual([]);
    expect(result.copiedFiles).toBe(0);
    expect(result.skippedFiles).toBe(1);
  });

  it('leaves missing database cache paths unchanged and records a warning', () => {
    const root = makeTempRoot();
    const oldDir = join(root, 'old-cache');
    const newDir = join(root, 'new-cache');
    const missingThumb = join(oldDir, 'missing-thumb.webp');
    const database = createDatabase(join(root, 'library.sqlite'));
    database
      .prepare(
        `INSERT INTO covers (
          id, source_type, source_hash, mime_type, thumb_path, album_path, large_path, original_ref,
          cache_version, warnings_json, errors_json, cover_thumb, cover_large, cover_original, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'cover-missing',
        'embedded',
        'missing',
        'image/webp',
        missingThumb,
        null,
        null,
        null,
        1,
        '[]',
        '[]',
        missingThumb,
        null,
        null,
        new Date().toISOString(),
        new Date().toISOString(),
      );
    const warnings: string[] = [];

    const updatedRows = updateCoverPathsInDatabase(database, oldDir, newDir, warnings);
    const row = database.prepare<unknown[], { thumb_path: string }>('SELECT thumb_path FROM covers WHERE id = ?').get('cover-missing');

    expect(updatedRows).toBe(0);
    expect(warnings[0]).toContain('cache path is missing');
    expect(row?.thumb_path).toBe(missingThumb);
    database.close();
  });
});
