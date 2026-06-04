import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { unzip } from 'fflate';
import { resolveFfmpegToolchain, type FfmpegToolchainInfo } from '../audio/FfmpegToolchain';
import type { EditableTrackTags } from '../../shared/types/library';
import { decodeTextFileBytes } from '../../shared/utils/decodeTextFile';
import { writeEmbeddedTrackTags } from './TagWriter';

const osuAudioExtensions = new Set(['.mp3', '.ogg', '.wav', '.m4a', '.flac', '.aac', '.opus']);
const osuCoverExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export type OsuArchiveMetadata = {
  audioFilename: string | null;
  coverFilename: string | null;
  title: string | null;
  artist: string | null;
  creator: string | null;
  version: string | null;
  beatmapSetId: string | null;
};

export type OsuArchiveCoverData = {
  data: Uint8Array;
  mimeType: string;
};

export type OsuArchiveImportResult = {
  outputPath: string;
  metadata: OsuArchiveMetadata;
  coverData: OsuArchiveCoverData | null;
  tags: EditableTrackTags;
};

export type OsuArchiveImportDependencies = {
  ffmpegToolchain?: FfmpegToolchainInfo;
  resolveFfmpegToolchain?: () => FfmpegToolchainInfo;
  spawn?: typeof nodeSpawn;
  writeEmbeddedTrackTags?: typeof writeEmbeddedTrackTags;
};

export type OsuArchiveImportRequest = {
  archivePath: string;
  outputDirectory: string;
  beatmapsetId?: string | null;
  writeEmbeddedTags?: boolean;
  dependencies?: OsuArchiveImportDependencies;
};

type OsuArchiveEntry = {
  name: string;
  data: Uint8Array;
};

const sanitizeFilePart = (value: string): string => {
  const cleaned = value
    .replace(/[<>:"/\\|?*]/gu, ' ')
    .split('')
    .map((character) => (character.charCodeAt(0) < 32 ? ' ' : character))
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[. ]+$/u, '');

  return (cleaned || 'Untitled osu beatmap').slice(0, 160);
};

const normalizeArchivePath = (value: string): string =>
  value.replace(/\\/gu, '/').replace(/^\/+/u, '').toLowerCase();

const cleanText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const cleanBeatmapSetId = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && /^\d+$/u.test(trimmed) && trimmed !== '0' ? trimmed : null;
};

const uniqueOutputPath = async (outputDirectory: string, fileName: string): Promise<string> => {
  const parsed = fileName.match(/^(.*?)(\.[^.]+)$/u);
  const baseName = parsed?.[1] ?? fileName;
  const extension = parsed?.[2] ?? '';
  let candidate = resolve(outputDirectory, fileName);
  let suffix = 2;

  while (existsSync(candidate)) {
    candidate = resolve(outputDirectory, `${baseName} (${suffix})${extension}`);
    suffix += 1;
  }

  return candidate;
};

export const isOsuArchivePath = (filePath: string): boolean => extname(filePath).toLowerCase() === '.osz';

const unzipArchive = async (archivePath: string): Promise<Record<string, Uint8Array>> => {
  const archiveData = new Uint8Array(await readFile(archivePath));
  return new Promise((resolveUnzip, rejectUnzip) => {
    unzip(archiveData, (error, archive) => {
      if (error) {
        rejectUnzip(error);
        return;
      }
      resolveUnzip(archive);
    });
  });
};

const parseOsuCsvLine = (line: string): string[] => {
  const parts: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === ',' && !quoted) {
      parts.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  parts.push(current);
  return parts;
};

const parseOsuBackgroundFilename = (line: string): string | null => {
  const parts = parseOsuCsvLine(line);
  const eventType = parts[0]?.trim().toLowerCase();
  if (eventType !== '0' && eventType !== 'background') {
    return null;
  }

  const filename = parts[2]?.trim();
  return filename && osuCoverExtensions.has(extname(filename).toLowerCase()) ? filename : null;
};

export const parseOsuFileMetadata = (content: string): OsuArchiveMetadata => {
  let section = '';
  const metadata: OsuArchiveMetadata = {
    audioFilename: null,
    coverFilename: null,
    title: null,
    artist: null,
    creator: null,
    version: null,
    beatmapSetId: null,
  };

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const sectionMatch = line.match(/^\[([^\]]+)\]$/u);
    if (sectionMatch) {
      section = sectionMatch[1].toLowerCase();
      continue;
    }

    if (section === 'events' && !metadata.coverFilename) {
      metadata.coverFilename = parseOsuBackgroundFilename(line);
      continue;
    }

    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!value) {
      continue;
    }

    if (section === 'general' && key === 'AudioFilename') {
      metadata.audioFilename = value;
    } else if (section === 'metadata') {
      if (key === 'TitleUnicode') {
        metadata.title = value;
      } else if (key === 'Title') {
        metadata.title = metadata.title ?? value;
      } else if (key === 'ArtistUnicode') {
        metadata.artist = value;
      } else if (key === 'Artist') {
        metadata.artist = metadata.artist ?? value;
      } else if (key === 'Creator') {
        metadata.creator = value;
      } else if (key === 'Version') {
        metadata.version = value;
      } else if (key === 'BeatmapSetID') {
        metadata.beatmapSetId = cleanBeatmapSetId(value);
      }
    }
  }

  return metadata;
};

const pickOsuArchiveMetadata = (entries: OsuArchiveEntry[]): OsuArchiveMetadata => {
  const osuEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith('.osu'));
  for (const entry of osuEntries) {
    const metadata = parseOsuFileMetadata(decodeTextFileBytes(entry.data));
    if (metadata.audioFilename) {
      return metadata;
    }
  }

  return osuEntries[0]
    ? parseOsuFileMetadata(decodeTextFileBytes(osuEntries[0].data))
    : {
        audioFilename: null,
        coverFilename: null,
        title: null,
        artist: null,
        creator: null,
        version: null,
        beatmapSetId: null,
      };
};

const pickOsuAudioEntry = (entries: OsuArchiveEntry[], audioFilename: string | null): OsuArchiveEntry | null => {
  const audioEntries = entries.filter((entry) => osuAudioExtensions.has(extname(entry.name).toLowerCase()));
  if (audioEntries.length === 0) {
    return null;
  }

  const normalizedAudioFilename = audioFilename ? normalizeArchivePath(audioFilename) : null;
  if (normalizedAudioFilename) {
    const namedEntry = audioEntries.find((entry) => {
      const normalizedName = normalizeArchivePath(entry.name);
      return normalizedName === normalizedAudioFilename || normalizedName.endsWith(`/${normalizedAudioFilename}`);
    });
    if (namedEntry) {
      return namedEntry;
    }
  }

  return [...audioEntries].sort((left, right) => right.data.length - left.data.length)[0] ?? null;
};

const pickOsuCoverEntry = (entries: OsuArchiveEntry[], coverFilename: string | null): OsuArchiveEntry | null => {
  const coverEntries = entries.filter((entry) => osuCoverExtensions.has(extname(entry.name).toLowerCase()));
  if (coverEntries.length === 0) {
    return null;
  }

  const normalizedCoverFilename = coverFilename ? normalizeArchivePath(coverFilename) : null;
  if (normalizedCoverFilename) {
    const namedEntry = coverEntries.find((entry) => {
      const normalizedName = normalizeArchivePath(entry.name);
      return normalizedName === normalizedCoverFilename || normalizedName.endsWith(`/${normalizedCoverFilename}`);
    });
    if (namedEntry) {
      return namedEntry;
    }
  }

  return [...coverEntries].sort((left, right) => right.data.length - left.data.length)[0] ?? null;
};

const mimeTypeForOsuCoverEntry = (entryName: string): string => {
  const extension = extname(entryName).toLowerCase();
  if (extension === '.png') {
    return 'image/png';
  }
  if (extension === '.webp') {
    return 'image/webp';
  }
  return 'image/jpeg';
};

const runFfmpegToMp3 = async (
  inputPath: string,
  outputPath: string,
  dependencies: OsuArchiveImportDependencies,
): Promise<void> => {
  const ffmpegToolchain = dependencies.ffmpegToolchain ?? dependencies.resolveFfmpegToolchain?.() ?? resolveFfmpegToolchain();
  if (!ffmpegToolchain.healthy) {
    throw new Error('ffmpeg is not available for osu! audio conversion');
  }

  const spawn = dependencies.spawn ?? nodeSpawn;
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-codec:a',
    'libmp3lame',
    '-q:a',
    '0',
    outputPath,
  ];
  const proc = spawn(ffmpegToolchain.path, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  const stderrChunks: Buffer[] = [];
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });

  await new Promise<void>((resolveProcess, rejectProcess) => {
    proc.on('error', rejectProcess);
    proc.on('exit', (code, signal) => {
      if (code === 0) {
        resolveProcess();
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      rejectProcess(new Error(`ffmpeg_exit_${code ?? signal ?? 'unknown'}${stderr ? `: ${stderr}` : ''}`));
    });
  });
};

const writeAudioEntryAsMp3 = async (
  audioEntry: OsuArchiveEntry,
  outputPath: string,
  dependencies: OsuArchiveImportDependencies,
): Promise<void> => {
  if (extname(audioEntry.name).toLowerCase() === '.mp3') {
    await writeFile(outputPath, Buffer.from(audioEntry.data));
    return;
  }

  const tempDirectory = resolve(dirname(outputPath), `.echo-osu-import-${randomUUID()}`);
  await mkdir(tempDirectory, { recursive: true });
  const tempInputPath = join(tempDirectory, `source${extname(audioEntry.name).toLowerCase() || '.audio'}`);
  try {
    await writeFile(tempInputPath, Buffer.from(audioEntry.data));
    await runFfmpegToMp3(tempInputPath, outputPath, dependencies);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
};

const buildTags = (
  metadata: OsuArchiveMetadata,
  archivePath: string,
  beatmapsetId: string | null,
): EditableTrackTags => {
  const fallbackName = basename(archivePath, extname(archivePath));
  const title = cleanText(metadata.title) ?? (beatmapsetId ? `osu! beatmapset ${beatmapsetId}` : fallbackName);
  const artist = cleanText(metadata.artist) ?? 'Unknown Artist';
  const album = beatmapsetId ? `osu! beatmapset ${beatmapsetId}` : fallbackName;

  return {
    title,
    artist,
    album,
    albumArtist: artist,
    trackNo: null,
    discNo: null,
    year: null,
    genre: null,
  };
};

export const importOsuArchiveAsMp3 = async (request: OsuArchiveImportRequest): Promise<OsuArchiveImportResult> => {
  const outputDirectory = resolve(request.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const outputStat = await stat(outputDirectory);
  if (!outputStat.isDirectory()) {
    throw new Error(`osu! import output directory is not available: ${outputDirectory}`);
  }

  const archive = await unzipArchive(request.archivePath);
  const entries = Object.entries(archive)
    .filter(([, data]) => data.length > 0)
    .map(([name, data]) => ({ name, data }));
  const parsedMetadata = pickOsuArchiveMetadata(entries);
  const beatmapsetId = cleanBeatmapSetId(request.beatmapsetId) ?? parsedMetadata.beatmapSetId;
  const metadata = { ...parsedMetadata, beatmapSetId: beatmapsetId };
  const audioEntry = pickOsuAudioEntry(entries, metadata.audioFilename);
  if (!audioEntry) {
    throw new Error('osu! archive does not contain a supported audio file');
  }

  const coverEntry = pickOsuCoverEntry(entries, metadata.coverFilename);
  const coverData = coverEntry
    ? {
        data: coverEntry.data,
        mimeType: mimeTypeForOsuCoverEntry(coverEntry.name),
      }
    : null;
  const tags = buildTags(metadata, request.archivePath, beatmapsetId);
  const outputName = [tags.artist === 'Unknown Artist' ? null : tags.artist, tags.title].filter(Boolean).join(' - ') || tags.title;
  const outputPath = await uniqueOutputPath(outputDirectory, `${sanitizeFilePart(outputName)}.mp3`);

  try {
    await writeAudioEntryAsMp3(audioEntry, outputPath, request.dependencies ?? {});
    if (request.writeEmbeddedTags !== false) {
      const writeTags = request.dependencies?.writeEmbeddedTrackTags ?? writeEmbeddedTrackTags;
      await writeTags({
        filePath: outputPath,
        coverData,
        tags,
      });
    }
  } catch (error) {
    await rm(outputPath, { force: true, maxRetries: 3, retryDelay: 50 });
    throw error;
  }

  return {
    outputPath,
    metadata,
    coverData,
    tags,
  };
};

let osuArchiveImportQueue: Promise<unknown> = Promise.resolve();

export const importOsuArchiveAsMp3Queued = (request: OsuArchiveImportRequest): Promise<OsuArchiveImportResult> => {
  const nextImport = osuArchiveImportQueue.catch(() => undefined).then(() => importOsuArchiveAsMp3(request));
  osuArchiveImportQueue = nextImport;
  void osuArchiveImportQueue.catch(() => undefined);
  return nextImport;
};

export const copyOsuArchiveToTemporaryFile = async (
  sourcePath: string,
  outputDirectory: string,
  preferredName: string,
): Promise<string> => {
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = await uniqueOutputPath(outputDirectory, `${sanitizeFilePart(preferredName)}.osz`);
  await copyFile(sourcePath, outputPath);
  return outputPath;
};
