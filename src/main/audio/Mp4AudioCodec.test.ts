import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readMp4AudioSampleEntryCodec,
  resolveMp4ContainerAudioCodec,
  shouldUseMp4AudioSampleEntryCodec,
} from './Mp4AudioCodec';

const uint32Be = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
};

const box = (type: string, payload: Buffer): Buffer =>
  Buffer.concat([uint32Be(8 + payload.length), Buffer.from(type, 'ascii'), payload]);

const audioSampleEntry = (codecTag: string): Buffer =>
  Buffer.concat([uint32Be(8), Buffer.from(codecTag, 'ascii')]);

const mp4WithAudioCodec = (codecTag: string): Buffer => {
  const stsd = box('stsd', Buffer.concat([Buffer.alloc(4), uint32Be(1), audioSampleEntry(codecTag)]));
  return box('moov', box('trak', box('mdia', box('minf', box('stbl', stsd)))));
};

describe('MP4 audio codec sample-entry reader', () => {
  it('detects Dolby Digital Plus inside an m4a container', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'echo-mp4-codec-'));
    const filePath = join(tempDir, 'dolby.m4a');

    try {
      await writeFile(filePath, mp4WithAudioCodec('ec-3'));

      await expect(readMp4AudioSampleEntryCodec(filePath)).resolves.toBe('E-AC-3');
      await expect(resolveMp4ContainerAudioCodec(filePath, 'ALAC')).resolves.toBe('E-AC-3');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('only applies sample-entry codecs when they are more authoritative', () => {
    expect(shouldUseMp4AudioSampleEntryCodec('ALAC', 'E-AC-3')).toBe(true);
    expect(shouldUseMp4AudioSampleEntryCodec('MPEG-4', 'AAC')).toBe(true);
    expect(shouldUseMp4AudioSampleEntryCodec('FLAC', 'AAC')).toBe(false);
    expect(shouldUseMp4AudioSampleEntryCodec('E-AC-3', 'E-AC-3')).toBe(false);
  });
});
