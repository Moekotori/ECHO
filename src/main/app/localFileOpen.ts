import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { SUPPORTED_AUDIO_DIALOG_EXTENSIONS } from '../../shared/constants/audioExtensions';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type { LibraryTrack } from '../../shared/types/library';
import type { LocalFileOpenRejection, LocalFileResolveResult } from '../../shared/types/playback';
import { createCueTrackPath, readCueSheet } from '../audio/CueSheet';
import { getLibraryService } from '../library/LibraryService';
import type { MetadataResult } from '../library/libraryTypes';
import { TsMetadataReader } from '../library/workers/TsMetadataReader';
import { getMainWindow } from './windowManager';

const directPlayableExtensions = new Set(SUPPORTED_AUDIO_DIALOG_EXTENSIONS.map((extension) => `.${extension.toLowerCase()}`));
const temporaryTrackPrefix = 'temporary-local:';
const metadataReader = new TsMetadataReader();

const normalizePathKey = (filePath: string): string => resolve(filePath).toLocaleLowerCase();

const uniqueResolvedPaths = (paths: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const path of paths) {
    if (typeof path !== 'string' || path.trim().length === 0) {
      continue;
    }

    const resolved = resolve(path.trim());
    const key = normalizePathKey(resolved);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(resolved);
  }

  return result;
};

export const isDirectPlayableAudioPath = (filePath: string): boolean =>
  directPlayableExtensions.has(extname(filePath).toLowerCase());

export const classifyLocalAudioPath = (filePath: string): LocalFileOpenRejection | null => {
  if (!existsSync(filePath)) {
    return { path: filePath, reason: 'missing' };
  }

  const fileStat = statSync(filePath);
  if (!fileStat.isFile()) {
    return { path: filePath, reason: 'not_file' };
  }

  if (!isDirectPlayableAudioPath(filePath)) {
    return { path: filePath, reason: 'unsupported' };
  }

  return null;
};

const temporaryTrackId = (filePath: string): string =>
  `${temporaryTrackPrefix}${createHash('sha1').update(normalizePathKey(filePath)).digest('hex')}`;

const fallbackMetadata = (filePath: string): MetadataResult => {
  const title = basename(filePath, extname(filePath)).trim() || 'Untitled';

  return {
    fields: {
      title,
      artist: 'Unknown Artist',
      album: '',
      albumArtist: 'Unknown Artist',
      trackNo: null,
      discNo: null,
      year: null,
      genre: null,
      duration: 0,
      codec: extname(filePath).replace('.', '').toUpperCase() || null,
      sampleRate: null,
      bitDepth: null,
      bitrate: null,
    },
    fieldSources: {
      title: 'filename_fallback',
      artist: 'unknown',
      album: 'unknown',
      albumArtist: 'unknown',
      trackNo: 'unknown',
      discNo: 'unknown',
      year: 'unknown',
      genre: 'unknown',
      duration: 'unknown',
      codec: 'filename_fallback',
      sampleRate: 'unknown',
      bitDepth: 'unknown',
      bitrate: 'unknown',
    },
    embeddedMetadataStatus: 'error',
    embeddedCoverStatus: 'missing',
    warnings: [],
    errors: [],
    status: 'error',
  };
};

const createTemporaryTrack = async (filePath: string): Promise<LibraryTrack> => {
  const metadata = await metadataReader.read(filePath).catch(() => fallbackMetadata(filePath));

  return {
    id: temporaryTrackId(filePath),
    mediaType: 'local',
    isTemporary: true,
    path: filePath,
    title: metadata.fields.title,
    artist: metadata.fields.artist,
    album: metadata.fields.album,
    albumArtist: metadata.fields.albumArtist,
    trackNo: metadata.fields.trackNo,
    discNo: metadata.fields.discNo,
    year: metadata.fields.year,
    genre: metadata.fields.genre,
    duration: metadata.fields.duration,
    codec: metadata.fields.codec,
    sampleRate: metadata.fields.sampleRate,
    bitDepth: metadata.fields.bitDepth,
    bitrate: metadata.fields.bitrate,
    coverId: null,
    coverThumb: null,
    metadataStatus: metadata.status,
    embeddedMetadataStatus: metadata.embeddedMetadataStatus,
    embeddedCoverStatus: metadata.embeddedCoverStatus,
    fieldSources: metadata.fieldSources,
  };
};

const createTemporaryTracks = async (filePath: string): Promise<LibraryTrack[]> => {
  const cueSheet = readCueSheet(filePath);
  if (cueSheet.tracks.length > 0) {
    return Promise.all(cueSheet.tracks.map((track) => createTemporaryTrack(createCueTrackPath(filePath, track.trackNumber))));
  }

  if (extname(filePath).toLowerCase() === '.cue') {
    return [await createTemporaryTrack(filePath)];
  }

  return [await createTemporaryTrack(filePath)];
};

export const parseLocalAudioFileArguments = (argv: string[]): string[] => {
  const paths = uniqueResolvedPaths(argv);

  return paths.filter((filePath) => classifyLocalAudioPath(filePath) === null);
};

export const resolveLocalAudioFiles = async (paths: string[]): Promise<LocalFileResolveResult> => {
  const rejected: LocalFileOpenRejection[] = [];
  const tracks: LibraryTrack[] = [];

  for (const filePath of uniqueResolvedPaths(paths)) {
    const rejection = classifyLocalAudioPath(filePath);
    if (rejection) {
      rejected.push(rejection);
      continue;
    }

    let libraryTrack: LibraryTrack | null = null;
    try {
      libraryTrack = getLibraryService().getTrackByPath(filePath);
    } catch {
      libraryTrack = null;
    }
    if (libraryTrack) {
      tracks.push({ ...libraryTrack, mediaType: libraryTrack.mediaType ?? 'local' });
      continue;
    }

    tracks.push(...await createTemporaryTracks(filePath));
  }

  return { tracks, rejected };
};

let pendingLocalAudioFilePaths: string[] = [];

const consumePendingLocalAudioFilePaths = (): string[] => {
  const paths = uniqueResolvedPaths(pendingLocalAudioFilePaths);
  pendingLocalAudioFilePaths = [];
  return paths;
};

export const flushPendingLocalAudioFiles = (): void => {
  const window = getMainWindow();
  if (!window) {
    return;
  }

  const send = (): void => {
    const paths = consumePendingLocalAudioFilePaths();
    if (paths.length > 0 && !window.isDestroyed()) {
      window.webContents.send(IpcChannels.PlaybackLocalAudioFilesOpened, paths);
    }
  };

  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', send);
    return;
  }

  send();
};

export const dispatchLocalAudioFilesOpened = (paths: string[]): void => {
  const nextPaths = uniqueResolvedPaths(paths).filter((filePath) => classifyLocalAudioPath(filePath) === null);
  if (nextPaths.length === 0) {
    return;
  }

  pendingLocalAudioFilePaths = uniqueResolvedPaths([...pendingLocalAudioFilePaths, ...nextPaths]);
  flushPendingLocalAudioFiles();
};
