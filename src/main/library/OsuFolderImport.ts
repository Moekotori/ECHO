import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { EditableTrackTags } from '../../shared/types/library';
import { decodeTextFileBytes } from '../../shared/utils/decodeTextFile';
import {
  buildOsuImportTags,
  mimeTypeForOsuCoverPath,
  parseOsuFileMetadata,
  type OsuArchiveMetadata,
  type OsuArchiveCoverData,
} from './OsuArchiveImport';
import { writeEmbeddedTrackTags } from './TagWriter';

export type OsuFolderImportItem = {
  audioPath: string;
  osuPath: string;
  coverPath: string | null;
  metadata: OsuArchiveMetadata;
  tags: EditableTrackTags;
};

export type OsuFolderImportResult = {
  metadataFiles: number;
  matchedAudioFiles: number;
  matchedAudioPaths: string[];
  taggedFiles: number;
  failedTagWrites: number;
  errors: string[];
};

export type OsuFolderImportDependencies = {
  writeEmbeddedTrackTags?: typeof writeEmbeddedTrackTags;
};

const osuAudioExtensions = new Set(['.mp3']);
const osuCoverExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const maxStoredErrors = 50;
const osuRateVariantPattern = /(?:^|[\s._()[\]-])(?:0\.[5-9]|1\.[0-9]+|2(?:\.0+)?)(?:x|\u500d\u901f)?(?:[\s._()[\]-]|$)|(?:^|[\s._()[\]-])(?:dt|nc|nightcore|doubletime)(?:[\s._()[\]-]|$)/iu;

const normalizeRelativeOsuPath = (value: string): string => value.replace(/\\/gu, '/').replace(/^\/+/u, '');

const pushError = (errors: string[], message: string): void => {
  if (errors.length < maxStoredErrors) {
    errors.push(message);
  }
};

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
};

const walkFiles = async (rootPath: string, extensions: Set<string>, errors: string[]): Promise<string[]> => {
  const result: string[] = [];

  const walk = async (directoryPath: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      pushError(errors, `${directoryPath}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    for (const entry of entries) {
      const entryPath = join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
        result.push(resolve(entryPath));
      }
    }
  };

  await walk(resolve(rootPath));
  return result.sort((left, right) => left.localeCompare(right));
};

const isPathInsideDirectory = (directoryPath: string, filePath: string): boolean => {
  const relativePath = relative(directoryPath, filePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
};

const resolveOsuSiblingPath = (osuPath: string, relativePath: string | null): string | null => {
  if (!relativePath) {
    return null;
  }

  const basePath = resolve(dirname(osuPath));
  const resolvedPath = resolve(basePath, normalizeRelativeOsuPath(relativePath));
  return isPathInsideDirectory(basePath, resolvedPath) ? resolvedPath : null;
};

const isOsuRateVariantAudioPath = (audioPath: string): boolean =>
  osuRateVariantPattern.test(basename(audioPath, extname(audioPath)));

const importKeyForOsuItem = (item: OsuFolderImportItem): string => {
  const beatmapSetId = item.metadata.beatmapSetId?.trim();
  return beatmapSetId ? `set:${beatmapSetId}` : `audio:${process.platform === 'win32' ? item.audioPath.toLowerCase() : item.audioPath}`;
};

const groupOsuPathsByBeatmapFolder = (osuPaths: string[]): string[][] => {
  const pathsByDirectory = new Map<string, string[]>();

  for (const osuPath of osuPaths) {
    const directoryPath = resolve(dirname(osuPath));
    const paths = pathsByDirectory.get(directoryPath) ?? [];
    paths.push(osuPath);
    pathsByDirectory.set(directoryPath, paths);
  }

  return Array.from(pathsByDirectory.values()).map((paths) => paths.sort((left, right) => left.localeCompare(right)));
};

const readOsuMetadataItem = async (osuPath: string, errors: string[]): Promise<OsuFolderImportItem | null> => {
  let metadata: OsuArchiveMetadata;
  try {
    metadata = parseOsuFileMetadata(decodeTextFileBytes(new Uint8Array(await readFile(osuPath))));
  } catch (error) {
    pushError(errors, `${osuPath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  const audioPath = resolveOsuSiblingPath(osuPath, metadata.audioFilename);
  if (!audioPath || !osuAudioExtensions.has(extname(audioPath).toLowerCase()) || !(await pathExists(audioPath))) {
    return null;
  }
  if (isOsuRateVariantAudioPath(audioPath)) {
    return null;
  }

  const resolvedCoverPath = resolveOsuSiblingPath(osuPath, metadata.coverFilename);
  const coverPath =
    resolvedCoverPath && osuCoverExtensions.has(extname(resolvedCoverPath).toLowerCase()) && (await pathExists(resolvedCoverPath))
      ? resolvedCoverPath
      : null;
  const beatmapsetId = metadata.beatmapSetId;

  return {
    audioPath,
    osuPath,
    coverPath,
    metadata,
    tags: buildOsuImportTags(metadata, osuPath, beatmapsetId),
  };
};

const readCoverData = async (coverPath: string | null, errors: string[]): Promise<OsuArchiveCoverData | null> => {
  if (!coverPath) {
    return null;
  }

  try {
    return {
      data: new Uint8Array(await readFile(coverPath)),
      mimeType: mimeTypeForOsuCoverPath(coverPath),
    };
  } catch (error) {
    pushError(errors, `${coverPath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
};

export const collectOsuFolderImportItems = async (rootPath: string): Promise<{ items: OsuFolderImportItem[]; metadataFiles: number; errors: string[] }> => {
  const errors: string[] = [];
  const osuPaths = await walkFiles(rootPath, new Set(['.osu']), errors);
  const osuPathGroups = groupOsuPathsByBeatmapFolder(osuPaths);
  const itemsByImportKey = new Map<string, OsuFolderImportItem>();
  let metadataFiles = 0;

  for (const beatmapFolderOsuPaths of osuPathGroups) {
    for (const osuPath of beatmapFolderOsuPaths) {
      metadataFiles += 1;
      const item = await readOsuMetadataItem(osuPath, errors);
      if (!item) {
        continue;
      }
      const importKey = importKeyForOsuItem(item);
      if (!itemsByImportKey.has(importKey)) {
        itemsByImportKey.set(importKey, item);
      }
      break;
    }
  }

  return {
    items: Array.from(itemsByImportKey.values()),
    metadataFiles,
    errors,
  };
};

export const writeOsuFolderEmbeddedTags = async (
  rootPath: string,
  dependencies: OsuFolderImportDependencies = {},
): Promise<OsuFolderImportResult> => {
  const { items, metadataFiles, errors } = await collectOsuFolderImportItems(rootPath);
  const writeTags = dependencies.writeEmbeddedTrackTags ?? writeEmbeddedTrackTags;
  let taggedFiles = 0;
  let failedTagWrites = 0;

  for (const item of items) {
    const coverData = await readCoverData(item.coverPath, errors);
    try {
      await writeTags({
        filePath: item.audioPath,
        tags: item.tags,
        coverData,
      });
      taggedFiles += 1;
    } catch (error) {
      failedTagWrites += 1;
      pushError(errors, `${item.audioPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    metadataFiles,
    matchedAudioFiles: items.length,
    matchedAudioPaths: items.map((item) => item.audioPath),
    taggedFiles,
    failedTagWrites,
    errors,
  };
};
