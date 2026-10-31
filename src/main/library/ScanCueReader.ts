import { open, stat } from 'node:fs/promises';
import { cueLosslessSourceCandidates } from '../audio/CueAudioSource';
import { isCueSourceInsideRoot, type ScanCueFileIssue } from './ScanCueFileIssue';
import type { FileHandle } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { decodeTextFileBytes } from '../../shared/utils/decodeTextFile';
import { parseCueSheetText, readVorbisUserCommentCueSheet, type CueTrack } from '../audio/CueSheet';

export type ScanCueTrack = { trackNumber: number; audioPath: string; sizeBytes: number; mtimeMs: number; cueTrack?: CueTrack };
export type ScanCueResult = { tracks: ScanCueTrack[]; issue?: ScanCueFileIssue };
export type ScanCueReadOptions = { rootPath?: string };
export type ScanCueFile = { filePath: string; embedded: boolean };
export type ScanCueReader = ((path: string, embedded: boolean, options?: ScanCueReadOptions) => Promise<ScanCueResult>) & {
  readBatch?: (files: readonly ScanCueFile[], options?: ScanCueReadOptions) => Promise<ScanCueResult[]>;
};
const maxCueBytes = 2 * 1024 * 1024;

/** Bounded asynchronous CUE discovery; source media is opened read-only. */
export const readScanCueAsync: ScanCueReader = async (path, embedded, options) => {
  try { return await readCueSource(path, embedded, options); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { tracks: [], issue: 'source_missing' };
    if (code === 'EACCES' || code === 'EPERM') return { tracks: [], issue: 'source_denied' };
    if (code === 'EIO') return { tracks: [], issue: 'source_unreadable' };
    if (error instanceof RangeError) return { tracks: [], issue: 'source_limit' };
    throw error;
  }
};

async function readCueSource(path: string, embedded: boolean, options?: ScanCueReadOptions): Promise<ScanCueResult> {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    const text = embedded ? await embeddedText(handle, info.size) : await sidecarText(handle, info.size);
    if (!text) return embedded ? { tracks: [] } : { tracks: [], issue: 'source_unreadable' };
    const sheet = parseCueSheetText(text, resolve(path), {
      source: embedded ? 'embedded' : 'sidecar', sourceAudioPath: embedded ? path : null,
      fileExists: () => true,
    });
    const tracks: ScanCueTrack[] = [];
    const sources = new Map<string, { audioPath: string; size: number; mtimeMs: number }>();
    let pathChars = 0;
    for (const track of sheet.tracks) {
      if (!isCueSourceInsideRoot(track.audioPath, options?.rootPath)) continue;
      if (!sources.has(track.audioPath)) {
        let audioPath = track.audioPath;
        let info;
        try { info = await stat(audioPath); }
        catch (error) {
          if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          const matches: Array<{ path: string; info: Awaited<ReturnType<typeof stat>> }> = [];
          for (const candidate of cueLosslessSourceCandidates(audioPath)) {
            if (!isCueSourceInsideRoot(candidate, options?.rootPath)) continue;
            try { const candidateInfo = await stat(candidate); if (candidateInfo.isFile()) matches.push({ path: candidate, info: candidateInfo }); }
            catch (candidateError) { if (!['ENOENT', 'ENOTDIR'].includes((candidateError as NodeJS.ErrnoException).code ?? '')) throw candidateError; }
          }
          if (matches.length !== 1) return { tracks: [], issue: 'source_unreadable' };
          audioPath = matches[0]!.path; info = matches[0]!.info;
        }
        if (!info.isFile()) return { tracks: [], issue: 'source_unreadable' };
        sources.set(track.audioPath, { audioPath, size: Number(info.size), mtimeMs: Math.round(Number(info.mtimeMs)) });
      }
      const source = sources.get(track.audioPath);
      if (!source) continue;
      pathChars += track.audioPath.length;
      if (tracks.length >= 4096 || pathChars > 1024 * 1024) throw new RangeError('CUE discovery result is too large.');
      tracks.push({ trackNumber: track.trackNumber, audioPath: source.audioPath,
        sizeBytes: source.size, mtimeMs: source.mtimeMs, cueTrack: { ...track, audioPath: source.audioPath } });
    }
    return !embedded && tracks.length === 0 ? { tracks, issue: 'source_unreadable' } : { tracks };
  } finally { await handle.close(); }
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer | null> {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(bytes, offset, length - offset, position + offset);
    if (!bytesRead) return null;
    offset += bytesRead;
  }
  return bytes;
}

async function sidecarText(handle: FileHandle, size: number): Promise<string | null> {
  if (size > maxCueBytes) throw new RangeError('CUE text is too large.');
  const bytes = await readAt(handle, 0, size);
  return bytes ? decodeTextFileBytes(bytes) : null;
}

async function embeddedText(handle: FileHandle, size: number): Promise<string | null> {
  const initial = await readAt(handle, 0, 10);
  if (!initial) return null;
  let position = 0;
  if (initial.subarray(0, 3).toString() === 'ID3') {
    position = 10 + ((initial[6] & 127) << 21) + ((initial[7] & 127) << 14)
      + ((initial[8] & 127) << 7) + (initial[9] & 127) + ((initial[5] & 16) ? 10 : 0);
  }
  if ((await readAt(handle, position, 4))?.toString() !== 'fLaC') return null;
  position += 4;
  for (let block = 0; block < 4096; block++) {
    const header = await readAt(handle, position, 4);
    if (!header) return null;
    position += 4;
    const length = header.readUIntBE(1, 3);
    if (position + length > size) return null;
    if ((header[0] & 127) === 4) {
      if (length > maxCueBytes) throw new RangeError('FLAC CUE comments are too large.');
      const bytes = await readAt(handle, position, length);
      return bytes ? readVorbisUserCommentCueSheet(bytes) : null;
    }
    if (header[0] & 128) return null;
    position += length;
  }
  throw new RangeError('FLAC metadata has too many blocks.');
}

export const isEmbeddedCueSource = (path: string): boolean => ['.flac', '.fla'].includes(extname(path).toLowerCase());
