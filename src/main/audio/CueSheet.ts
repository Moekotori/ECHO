import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { decodeTextFileBytes } from '../../shared/utils/decodeTextFile';

export type CueTrackSource = 'sidecar' | 'embedded';

export type CueTrack = {
  cuePath: string;
  audioPath: string;
  source: CueTrackSource;
  trackNumber: number;
  title: string | null;
  performer: string | null;
  album: string | null;
  albumArtist: string | null;
  startSeconds: number;
  endSeconds: number | null;
};

export type CueSheet = {
  cuePath: string;
  title: string | null;
  performer: string | null;
  tracks: CueTrack[];
};

const cueTrackSuffixPattern = /#cueTrack=(\d+)$/iu;
const flacMarker = Buffer.from('fLaC', 'ascii');
const flacVorbisCommentBlockType = 4;
const maxVorbisCommentBlockBytes = 2 * 1024 * 1024;

const decodeCueText = (buffer: Buffer): string => decodeTextFileBytes(buffer);

const cueValue = (line: string, command: string): string | null => {
  const pattern = new RegExp(`^${command}\\s+(?:"([^"]*)"|(.*))$`, 'iu');
  const match = line.match(pattern);
  const value = match?.[1] ?? match?.[2];
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const cueFileValue = (line: string): string | null => {
  const match = line.match(/^FILE\s+(?:"([^"]+)"|(\S+))/iu);
  const value = match?.[1] ?? match?.[2];
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const parseIndexTime = (value: string): number | null => {
  const match = value.match(/^(\d+):(\d{2}):(\d{2})$/u);
  if (!match) {
    return null;
  }

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const frames = Number(match[3]);
  if (!Number.isFinite(minutes) || seconds > 59 || frames > 74) {
    return null;
  }

  return minutes * 60 + seconds + frames / 75;
};

const readExactly = (fd: number, length: number, position: number): Buffer | null => {
  const buffer = Buffer.alloc(length);
  let offset = 0;

  while (offset < length) {
    const bytesRead = readSync(fd, buffer, offset, length - offset, position + offset);
    if (bytesRead <= 0) {
      return null;
    }
    offset += bytesRead;
  }

  return buffer;
};

const synchsafeSize = (buffer: Buffer): number =>
  ((buffer[0] & 0x7f) << 21) | ((buffer[1] & 0x7f) << 14) | ((buffer[2] & 0x7f) << 7) | (buffer[3] & 0x7f);

const readFlacPreambleOffset = (fd: number): number | null => {
  const initial = readExactly(fd, 10, 0);
  if (!initial) {
    return null;
  }

  let position = 0;
  if (initial.subarray(0, 3).toString('ascii') === 'ID3') {
    position = 10 + synchsafeSize(initial.subarray(6, 10));
    if ((initial[5] & 0x10) !== 0) {
      position += 10;
    }
  }

  const marker = readExactly(fd, flacMarker.length, position);
  return marker?.equals(flacMarker) ? position + flacMarker.length : null;
};

const readUint32Le = (buffer: Buffer, offset: number): number | null =>
  offset + 4 <= buffer.length ? buffer.readUInt32LE(offset) : null;

const readVorbisUserCommentCueSheet = (buffer: Buffer): string | null => {
  let offset = 0;
  const vendorLength = readUint32Le(buffer, offset);
  if (vendorLength === null) {
    return null;
  }
  offset += 4 + vendorLength;

  const commentCount = readUint32Le(buffer, offset);
  if (commentCount === null) {
    return null;
  }
  offset += 4;

  for (let index = 0; index < commentCount; index += 1) {
    const commentLength = readUint32Le(buffer, offset);
    if (commentLength === null) {
      return null;
    }
    offset += 4;

    if (offset + commentLength > buffer.length) {
      return null;
    }

    const comment = buffer.toString('utf8', offset, offset + commentLength);
    offset += commentLength;

    const separatorIndex = comment.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = comment.slice(0, separatorIndex).replace(/[^a-z0-9]/giu, '').toLocaleUpperCase();
    const value = comment.slice(separatorIndex + 1).trim();
    if (key === 'CUESHEET' && value) {
      return value;
    }
  }

  return null;
};

const readEmbeddedCueText = (filePath: string): string | null => {
  let fd: number | null = null;

  try {
    fd = openSync(filePath, 'r');
    let position = readFlacPreambleOffset(fd);
    if (position === null) {
      return null;
    }

    while (true) {
      const header = readExactly(fd, 4, position);
      if (!header) {
        return null;
      }

      position += 4;
      const isLastBlock = (header[0] & 0x80) !== 0;
      const blockType = header[0] & 0x7f;
      const blockLength = header.readUIntBE(1, 3);

      if (blockType === flacVorbisCommentBlockType) {
        if (blockLength > maxVorbisCommentBlockBytes) {
          return null;
        }

        const data = readExactly(fd, blockLength, position);
        return data ? readVorbisUserCommentCueSheet(data) : null;
      }

      position += blockLength;
      if (isLastBlock) {
        return null;
      }
    }
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }
};

export const splitCueTrackPath = (filePath: string): { cuePath: string; trackNumber: number | null } => {
  const match = filePath.match(cueTrackSuffixPattern);
  if (!match) {
    return { cuePath: resolve(filePath), trackNumber: null };
  }

  return {
    cuePath: resolve(filePath.slice(0, match.index)),
    trackNumber: Number(match[1]),
  };
};

export const createCueTrackPath = (cuePath: string, trackNumber: number): string => `${resolve(cuePath)}#cueTrack=${trackNumber}`;

export const isCueTrackPath = (filePath: string): boolean => cueTrackSuffixPattern.test(filePath);

export const isCueSheetPath = (filePath: string): boolean => extname(splitCueTrackPath(filePath).cuePath).toLowerCase() === '.cue';

const parseCueSheetText = (
  text: string,
  cuePath: string,
  options: { source: CueTrackSource; sourceAudioPath?: string | null },
): CueSheet => {
  const cueDir = dirname(cuePath);
  let album: string | null = null;
  let albumArtist: string | null = null;
  const embeddedAudioPath = options.sourceAudioPath ? resolve(options.sourceAudioPath) : null;
  let currentAudioPath: string | null = embeddedAudioPath;
  let currentTrack:
    | {
        trackNumber: number;
        title: string | null;
        performer: string | null;
        audioPath: string | null;
        startSeconds: number | null;
      }
    | null = null;
  const tracks: CueTrack[] = [];

  const commitTrack = (): void => {
    if (!currentTrack || currentTrack.startSeconds === null) {
      currentTrack = null;
      return;
    }

    const audioPath = currentTrack.audioPath ?? currentAudioPath;
    if (!audioPath) {
      currentTrack = null;
      return;
    }

    const previous = tracks.at(-1);
    if (previous && previous.audioPath === audioPath) {
      previous.endSeconds = currentTrack.startSeconds;
    }

    tracks.push({
      cuePath,
      audioPath,
      source: options.source,
      trackNumber: currentTrack.trackNumber,
      title: currentTrack.title,
      performer: currentTrack.performer,
      album,
      albumArtist,
      startSeconds: currentTrack.startSeconds,
      endSeconds: null,
    });
    currentTrack = null;
  };

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const fileValue = cueFileValue(line);
    if (fileValue) {
      commitTrack();
      currentAudioPath = embeddedAudioPath ?? resolve(cueDir, fileValue);
      continue;
    }

    const trackMatch = line.match(/^TRACK\s+(\d+)\s+\S+/iu);
    if (trackMatch) {
      commitTrack();
      currentTrack = {
        trackNumber: Number(trackMatch[1]),
        title: null,
        performer: null,
        audioPath: currentAudioPath,
        startSeconds: null,
      };
      continue;
    }

    const title = cueValue(line, 'TITLE');
    if (title) {
      if (currentTrack) {
        currentTrack.title = title;
      } else {
        album = title;
      }
      continue;
    }

    const performer = cueValue(line, 'PERFORMER');
    if (performer) {
      if (currentTrack) {
        currentTrack.performer = performer;
      } else {
        albumArtist = performer;
      }
      continue;
    }

    const indexMatch = line.match(/^INDEX\s+01\s+(\d+:\d{2}:\d{2})$/iu);
    if (indexMatch && currentTrack) {
      currentTrack.startSeconds = parseIndexTime(indexMatch[1]);
    }
  }

  commitTrack();

  const filteredTracks = tracks.filter((track) => existsSync(track.audioPath));
  return {
    cuePath,
    title: album,
    performer: albumArtist,
    tracks: filteredTracks,
  };
};

export const readEmbeddedCueSheet = (filePath: string): CueSheet | null => {
  const { cuePath } = splitCueTrackPath(filePath);
  if (extname(cuePath).toLowerCase() === '.cue') {
    return null;
  }

  const text = readEmbeddedCueText(cuePath);
  return text ? parseCueSheetText(text, cuePath, { source: 'embedded', sourceAudioPath: cuePath }) : null;
};

export const readCueSheet = (filePath: string): CueSheet => {
  const { cuePath, trackNumber } = splitCueTrackPath(filePath);
  const sheet =
    extname(cuePath).toLowerCase() === '.cue'
      ? parseCueSheetText(decodeCueText(readFileSync(cuePath)), cuePath, { source: 'sidecar' })
      : readEmbeddedCueSheet(cuePath) ?? { cuePath, title: null, performer: null, tracks: [] };

  return {
    ...sheet,
    tracks: trackNumber ? sheet.tracks.filter((track) => track.trackNumber === trackNumber) : sheet.tracks,
  };
};

export const resolveCueTrack = (filePath: string): CueTrack | null => {
  const { trackNumber } = splitCueTrackPath(filePath);
  if (!isCueSheetPath(filePath) && trackNumber === null) {
    return null;
  }

  const sheet = readCueSheet(filePath);
  return sheet.tracks[0] ?? null;
};
