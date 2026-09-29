import { describe, expect, it } from 'vitest';
import { readStreamingAudioMetadataFromBuffer } from './StreamingAudioMetadataProbe';

const makeFlacStreamInfo = (sampleRate: number, bitDepth: number, channels: number): Buffer => {
  const streamInfo = Buffer.alloc(34);
  streamInfo.writeUInt16BE(4096, 0);
  streamInfo.writeUInt16BE(4096, 2);
  streamInfo[10] = (sampleRate >> 12) & 0xff;
  streamInfo[11] = (sampleRate >> 4) & 0xff;
  streamInfo[12] = ((sampleRate & 0x0f) << 4) | (((channels - 1) & 0x07) << 1) | (((bitDepth - 1) >> 4) & 0x01);
  streamInfo[13] = ((bitDepth - 1) & 0x0f) << 4;

  return Buffer.concat([
    Buffer.from('fLaC'),
    Buffer.from([0x80, 0x00, 0x00, streamInfo.length]),
    streamInfo,
  ]);
};

describe('StreamingAudioMetadataProbe', () => {
  it('reads FLAC sample rate and bit depth from a playback source header', async () => {
    const metadata = await readStreamingAudioMetadataFromBuffer(makeFlacStreamInfo(44_100, 16, 2), {
      codec: 'flac',
      mimeType: 'audio/flac',
      url: 'https://stream.example/song.flac',
    });

    expect(metadata).toMatchObject({
      codec: 'FLAC',
      sampleRate: 44_100,
      bitDepth: 16,
    });
  });
});
