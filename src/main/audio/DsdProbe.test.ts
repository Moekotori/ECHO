import { describe, expect, it } from 'vitest';
import {
  parseDsdNativeSampleRateFromBuffer,
  resolveDsdPcmOutputSampleRate,
  resolveDsdDopTransportSampleRate,
  shouldProbeDsdNativeSampleRate,
} from './DsdProbe';
import {
  packDop24Le,
  parseDsfDopInfoFromBuffer,
} from './DsdDopPipeline';

const createDsfHeader = (sampleRate: number): Buffer => {
  const buffer = Buffer.alloc(28 + 52);

  buffer.write('DSD ', 0, 'ascii');
  buffer.writeBigUInt64LE(28n, 4);
  buffer.writeBigUInt64LE(BigInt(buffer.length), 12);
  buffer.writeBigUInt64LE(0n, 20);
  buffer.write('fmt ', 28, 'ascii');
  buffer.writeBigUInt64LE(52n, 32);
  buffer.writeUInt32LE(1, 40);
  buffer.writeUInt32LE(0, 44);
  buffer.writeUInt32LE(2, 48);
  buffer.writeUInt32LE(2, 52);
  buffer.writeUInt32LE(sampleRate, 56);
  buffer.writeUInt32LE(1, 60);

  return buffer;
};

const createDsfDopFixture = (): Buffer => {
  const data = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const buffer = Buffer.alloc(28 + 52 + 12 + data.length);

  buffer.write('DSD ', 0, 'ascii');
  buffer.writeBigUInt64LE(28n, 4);
  buffer.writeBigUInt64LE(BigInt(buffer.length), 12);
  buffer.writeBigUInt64LE(0n, 20);

  const fmtOffset = 28;
  buffer.write('fmt ', fmtOffset, 'ascii');
  buffer.writeBigUInt64LE(52n, fmtOffset + 4);
  buffer.writeUInt32LE(1, fmtOffset + 12);
  buffer.writeUInt32LE(0, fmtOffset + 16);
  buffer.writeUInt32LE(2, fmtOffset + 20);
  buffer.writeUInt32LE(2, fmtOffset + 24);
  buffer.writeUInt32LE(2_822_400, fmtOffset + 28);
  buffer.writeUInt32LE(1, fmtOffset + 32);
  buffer.writeBigUInt64LE(32n, fmtOffset + 36);
  buffer.writeUInt32LE(4, fmtOffset + 44);

  const dataOffset = 28 + 52;
  buffer.write('data', dataOffset, 'ascii');
  buffer.writeBigUInt64LE(BigInt(12 + data.length), dataOffset + 4);
  data.copy(buffer, dataOffset + 12);

  return buffer;
};

const createDffHeader = (sampleRate: number): Buffer => {
  const buffer = Buffer.alloc(32);

  buffer.write('FRM8', 0, 'ascii');
  buffer.writeBigUInt64BE(20n, 4);
  buffer.write('DSD ', 12, 'ascii');
  buffer.write('FS  ', 16, 'ascii');
  buffer.writeBigUInt64BE(4n, 20);
  buffer.writeUInt32BE(sampleRate, 28);

  return buffer;
};

describe('DSD probing helpers', () => {
  it('reads the native DSD bit clock from a DSF fmt chunk', () => {
    expect(parseDsdNativeSampleRateFromBuffer(createDsfHeader(2_822_400))).toBe(2_822_400);
  });

  it('reads the native DSD bit clock from a DFF FS chunk', () => {
    expect(parseDsdNativeSampleRateFromBuffer(createDffHeader(5_644_800))).toBe(5_644_800);
  });

  it('marks DSF metadata reported as 44.1 kHz for a native-rate refresh', () => {
    expect(shouldProbeDsdNativeSampleRate({
      filePath: 'album/track.dsf',
      codec: 'DSF',
      bitDepth: 1,
      fileSampleRate: 44_100,
    })).toBe(true);
  });

  it('maps DSD rates to the V1 high-rate PCM targets', () => {
    expect(resolveDsdPcmOutputSampleRate({ filePath: 'dsd64.dsf', codec: 'DSF', fileSampleRate: 2_822_400 })).toBe(176_400);
    expect(resolveDsdPcmOutputSampleRate({ filePath: 'dsd128.dsf', codec: 'DSF', fileSampleRate: 5_644_800 })).toBe(352_800);
    expect(resolveDsdPcmOutputSampleRate({ filePath: 'dsd256.dsf', codec: 'DSF', fileSampleRate: 11_289_600 })).toBe(352_800);
  });

  it('maps DSD rates to DoP transport rates', () => {
    expect(resolveDsdDopTransportSampleRate({ filePath: 'dsd64.dsf', codec: 'DSF', fileSampleRate: 2_822_400 })).toBe(176_400);
    expect(resolveDsdDopTransportSampleRate({ filePath: 'dsd128.dsf', codec: 'DSF', fileSampleRate: 5_644_800 })).toBe(352_800);
    expect(resolveDsdDopTransportSampleRate({ filePath: 'dsd256.dsf', codec: 'DSF', fileSampleRate: 11_289_600 })).toBe(705_600);
  });

  it('parses DSF DoP metadata from a local fixture', () => {
    expect(parseDsfDopInfoFromBuffer('fixture.dsf', createDsfDopFixture())).toMatchObject({
      channels: 2,
      nativeSampleRate: 2_822_400,
      transportSampleRate: 176_400,
      sampleCount: 32,
      blockSizePerChannel: 4,
    });
  });

  it('packs DoP24LE markers and interleaves channels', () => {
    const packed = packDop24Le(
      [Buffer.from([1, 2, 3, 4]), Buffer.from([5, 6, 7, 8])],
      0,
      4,
    );

    expect([...packed]).toEqual([1, 2, 0x05, 5, 6, 0x05, 3, 4, 0xfa, 7, 8, 0xfa]);
  });

});
