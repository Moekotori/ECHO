import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import sharp from 'sharp';
import {
  COVER_CACHE_VERSION,
  type CoverCacheRepairOptions,
  type CoverExtractOptions,
  type CoverResult,
  type EmbeddedCoverData,
  type MetadataResult,
  type ParsedTrackMetadata,
} from '../libraryTypes';
import type { CoverExtractor } from './CoverExtractor';

type CoverCandidate = {
  source: CoverResult['source'];
  data: Uint8Array;
  mimeType: string | null;
  originalPath: string | null;
  warnings: string[];
  errors: string[];
};

type CacheMeta = {
  version: number;
  sourceHash: string;
  source: CoverResult['source'];
  mimeType: string | null;
};

const sidecarNames = ['cover', 'folder', 'front', 'albumart', 'album art', 'album_art', 'front cover', 'cover front'];
const sidecarExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
const maxCoverCandidateBytes = 20 * 1024 * 1024;
const sidecarNameKeys = new Set(sidecarNames.map((name) => name.toLocaleLowerCase().replace(/[^a-z0-9]/gu, '')));
const sidecarNamePrefixes = ['cover', 'folder', 'front', 'albumart'];

export const defaultCoverSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#20242b"/>
<circle cx="256" cy="256" r="132" fill="#2f3944"/>
<circle cx="256" cy="256" r="46" fill="#8fb7ff"/>
<path d="M256 92a164 164 0 1 1 0 328 164 164 0 0 1 0-328zm0 22a142 142 0 1 0 0 284 142 142 0 0 0 0-284z" fill="#f3f6fb" opacity=".18"/>
</svg>`;

const defaultCoverBytes = new TextEncoder().encode(defaultCoverSvg);
export const defaultCoverSourceHash = createHash('sha256').update(defaultCoverBytes).digest('hex');

const toBuffer = (data: Uint8Array): Buffer => (Buffer.isBuffer(data) ? data : Buffer.from(data));

const hashBytes = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

const extensionToMimeType = (extension: string): string | null => {
  switch (extension.toLocaleLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return null;
  }
};

const embeddedCoverFromMetadata = (metadata: MetadataResult | ParsedTrackMetadata | undefined): EmbeddedCoverData | undefined => {
  if (!metadata) {
    return undefined;
  }

  return 'embeddedCover' in metadata ? metadata.embeddedCover : undefined;
};

export class TsCoverExtractor implements CoverExtractor {
  async extract(filePath: string, options: CoverExtractOptions): Promise<CoverResult> {
    mkdirSync(options.cacheRoot, { recursive: true });

    const candidate = this.resolveCoverCandidate(filePath, options.metadata);
    return this.writeCandidateCache(options.cacheRoot, candidate);
  }

  async repairCachedCover(options: CoverCacheRepairOptions): Promise<CoverResult> {
    mkdirSync(options.cacheRoot, { recursive: true });

    if (options.source === 'default' || options.mimeType === 'image/svg+xml') {
      return this.writeDefaultCache(options.cacheRoot);
    }

    try {
      const data = readFileSync(options.originalRef);
      const actualHash = hashBytes(data);
      const warnings =
        actualHash === options.sourceHash ? [] : [`original_ref hash mismatch: expected ${options.sourceHash}, got ${actualHash}`];

      return this.writeCandidateCache(options.cacheRoot, {
        source: options.source,
        data,
        mimeType: options.mimeType ?? extensionToMimeType(extname(options.originalRef)),
        originalPath: options.originalRef,
        warnings,
        errors: [],
      }, options.sourceHash);
    } catch (error) {
      return this.writeDefaultCache(options.cacheRoot, [], [
        `${options.originalRef}: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
  }

  private async writeCandidateCache(
    cacheRoot: string,
    candidate: CoverCandidate,
    forcedSourceHash?: string,
  ): Promise<CoverResult> {
    const sourceHash = forcedSourceHash ?? hashBytes(candidate.data);

    if (candidate.source === 'default' || candidate.mimeType === 'image/svg+xml') {
      return this.writeDefaultCache(cacheRoot, candidate.warnings, candidate.errors);
    }

    const extension = this.extensionForMimeType(candidate.mimeType, candidate.originalPath);
    const coverDirectory = join(cacheRoot, sourceHash.slice(0, 2), sourceHash);
    const thumbPath = join(coverDirectory, 'thumb.webp');
    const albumPath = join(coverDirectory, 'album.webp');
    const largePath = join(coverDirectory, 'large.webp');
    const originalRef = join(coverDirectory, `original${extension}`);
    const metaPath = join(coverDirectory, 'meta.json');
    const meta = this.readMeta(metaPath);
    const shouldRebuildAll = !this.isCurrentMeta(meta, sourceHash);
    const missingThumb = shouldRebuildAll || !existsSync(thumbPath);
    const missingAlbum = shouldRebuildAll || !existsSync(albumPath);
    const missingLarge = shouldRebuildAll || !existsSync(largePath);

    mkdirSync(coverDirectory, { recursive: true });
    this.writeIfMissing(originalRef, candidate.data);

    try {
      if (missingThumb) {
        await this.writeThumb(candidate.data, thumbPath);
      }

      if (missingAlbum) {
        await this.writeAlbum(candidate.data, albumPath);
      }

      if (missingLarge) {
        await this.writeLarge(candidate.data, largePath);
      }

      if (shouldRebuildAll || !existsSync(metaPath)) {
        this.writeMeta(metaPath, {
          version: COVER_CACHE_VERSION,
          sourceHash,
          source: candidate.source,
          mimeType: candidate.mimeType,
        });
      }

      return {
        source: candidate.source,
        thumbPath,
        albumPath,
        largePath,
        originalRef,
        sourceHash,
        mimeType: candidate.mimeType,
        warnings: candidate.warnings,
        errors: candidate.errors,
      };
    } catch (error) {
      return this.writeDefaultCache(cacheRoot, candidate.warnings, [
        ...candidate.errors,
        `sharp: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
  }

  private writeDefaultCache(cacheRoot: string, warnings: string[] = [], errors: string[] = []): CoverResult {
    const coverDirectory = join(cacheRoot, defaultCoverSourceHash.slice(0, 2), defaultCoverSourceHash);
    const defaultPath = join(coverDirectory, 'default.svg');
    const metaPath = join(coverDirectory, 'meta.json');

    mkdirSync(coverDirectory, { recursive: true });
    this.writeIfMissing(defaultPath, defaultCoverBytes);

    if (!this.isCurrentMeta(this.readMeta(metaPath), defaultCoverSourceHash)) {
      this.writeMeta(metaPath, {
        version: COVER_CACHE_VERSION,
        sourceHash: defaultCoverSourceHash,
        source: 'default',
        mimeType: 'image/svg+xml',
      });
    }

    return {
      source: 'default',
      thumbPath: defaultPath,
      albumPath: defaultPath,
      largePath: defaultPath,
      originalRef: defaultPath,
      sourceHash: defaultCoverSourceHash,
      mimeType: 'image/svg+xml',
      warnings,
      errors,
    };
  }

  private resolveCoverCandidate(filePath: string, metadata: MetadataResult | ParsedTrackMetadata | undefined): CoverCandidate {
    const embeddedCover = embeddedCoverFromMetadata(metadata);

    if (embeddedCover) {
      if (embeddedCover.data.byteLength > maxCoverCandidateBytes) {
        return {
          source: 'default',
          data: defaultCoverBytes,
          mimeType: 'image/svg+xml',
          originalPath: null,
          warnings: [`embedded cover skipped: ${embeddedCover.data.byteLength} bytes exceeds ${maxCoverCandidateBytes}`],
          errors: [],
        };
      }

      return {
        source: 'embedded',
        data: embeddedCover.data,
        mimeType: embeddedCover.mimeType,
        originalPath: null,
        warnings: [],
        errors: [],
      };
    }

    const folderCover = this.findFolderCover(filePath);
    if (folderCover) {
      return folderCover;
    }

    return {
      source: 'default',
      data: defaultCoverBytes,
      mimeType: 'image/svg+xml',
      originalPath: null,
      warnings: [],
      errors: [],
    };
  }

  private findFolderCover(filePath: string): CoverCandidate | null {
    const candidates = this.folderCoverCandidates(filePath);

    for (const coverPath of candidates) {
      try {
        const coverSize = statSync(coverPath).size;
        if (coverSize > maxCoverCandidateBytes) {
          return {
            source: 'default',
            data: defaultCoverBytes,
            mimeType: 'image/svg+xml',
            originalPath: null,
            warnings: [`${coverPath}: sidecar cover skipped: ${coverSize} bytes exceeds ${maxCoverCandidateBytes}`],
            errors: [],
          };
        }

        return {
          source: 'folder',
          data: readFileSync(coverPath),
          mimeType: extensionToMimeType(extname(coverPath)),
          originalPath: coverPath,
          warnings: [],
          errors: [],
        };
      } catch (error) {
        return {
          source: 'default',
          data: defaultCoverBytes,
          mimeType: 'image/svg+xml',
          originalPath: null,
          warnings: [],
          errors: [`${coverPath}: ${error instanceof Error ? error.message : String(error)}`],
        };
      }
    }

    return null;
  }

  private folderCoverCandidates(filePath: string): string[] {
    const directory = dirname(filePath);
    const preferredPaths = sidecarNames.flatMap((name) =>
      sidecarExtensions.map((extension) => join(directory, `${name}${extension}`)),
    );
    const audioBaseKey = this.normalizedCoverBaseName(basename(filePath, extname(filePath)));
    const discovered: Array<{ path: string; rank: number; name: string }> = [];

    try {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile()) {
          continue;
        }

        const extension = extname(entry.name).toLocaleLowerCase();
        if (!sidecarExtensions.includes(extension)) {
          continue;
        }

        const baseKey = this.normalizedCoverBaseName(basename(entry.name, extname(entry.name)));
        const rank =
          sidecarNameKeys.has(baseKey)
            ? 0
            : sidecarNamePrefixes.some((prefix) => baseKey.startsWith(prefix))
              ? 1
              : audioBaseKey && baseKey === audioBaseKey
                ? 2
                : null;
        if (rank === null) {
          continue;
        }

        discovered.push({
          path: join(directory, entry.name),
          rank,
          name: entry.name.toLocaleLowerCase(),
        });
      }
    } catch {
      // Missing or unreadable sidecar directories should not block metadata import.
    }

    const ordered = [
      ...preferredPaths.filter((candidate) => existsSync(candidate)),
      ...discovered
        .sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name))
        .map((candidate) => candidate.path),
    ];
    return [...new Set(ordered)];
  }

  private normalizedCoverBaseName(value: string): string {
    return value.toLocaleLowerCase().replace(/[^a-z0-9]/gu, '');
  }

  private async writeThumb(data: Uint8Array, filePath: string): Promise<void> {
    await sharp(toBuffer(data))
      .rotate()
      .resize(96, 96, { fit: 'cover', position: 'centre' })
      .webp({ quality: 75, effort: 4 })
      .toFile(filePath);
  }

  private async writeAlbum(data: Uint8Array, filePath: string): Promise<void> {
    await sharp(toBuffer(data))
      .rotate()
      .resize(320, 320, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82, effort: 4 })
      .toFile(filePath);
  }

  private async writeLarge(data: Uint8Array, filePath: string): Promise<void> {
    await sharp(toBuffer(data))
      .rotate()
      .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toFile(filePath);
  }

  private readMeta(filePath: string): CacheMeta | null {
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<CacheMeta>;
      return {
        version: Number(parsed.version),
        sourceHash: typeof parsed.sourceHash === 'string' ? parsed.sourceHash : '',
        source:
          parsed.source === 'embedded' || parsed.source === 'folder' || parsed.source === 'network' || parsed.source === 'default'
            ? parsed.source
            : 'default',
        mimeType: typeof parsed.mimeType === 'string' ? parsed.mimeType : null,
      };
    } catch {
      return null;
    }
  }

  private writeMeta(filePath: string, meta: CacheMeta): void {
    writeFileSync(filePath, `${JSON.stringify(meta, null, 2)}\n`);
  }

  private isCurrentMeta(meta: CacheMeta | null, sourceHash: string): boolean {
    return Boolean(meta && meta.version === COVER_CACHE_VERSION && meta.sourceHash === sourceHash);
  }

  private extensionForMimeType(mimeType: string | null, originalPath: string | null): string {
    if (originalPath) {
      const extension = extname(originalPath);
      if (extension) {
        return extension.toLocaleLowerCase();
      }
    }

    switch (mimeType) {
      case 'image/jpeg':
        return '.jpg';
      case 'image/png':
        return '.png';
      case 'image/webp':
        return '.webp';
      case 'image/svg+xml':
        return '.svg';
      default:
        return '.bin';
    }
  }

  private writeIfMissing(filePath: string, data: Uint8Array): void {
    if (!existsSync(filePath)) {
      writeFileSync(filePath, data);
    }
  }
}
