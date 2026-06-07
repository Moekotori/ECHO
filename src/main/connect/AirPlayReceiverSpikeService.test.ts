import { EventEmitter } from 'node:events';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { createSocket as createUdpSocket } from 'node:dgram';
import { connect, type Socket } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import type { PassThrough } from 'node:stream';
import type { AudioStatus } from '../../shared/types/audio';
import { AirPlayReceiverSpikeService, convertS16leToF32le, resolveAirPlayHelperNodePath } from './AirPlayReceiverSpikeService';

const audioStatus = (overrides: Partial<AudioStatus> = {}): AudioStatus => ({
  host: 'ready',
  state: 'idle',
  outputDeviceId: null,
  outputDeviceName: null,
  outputDeviceType: null,
  outputBackend: null,
  activeOutputBackendImpl: null,
  outputMode: 'shared',
  sharedBackend: 'auto',
  useJuceOutputRequested: false,
  useJuceDecodeRequested: false,
  activeDecodeBackendImpl: null,
  dsdOutputModeRequested: 'pcm',
  activeDsdOutputMode: null,
  dsdNativeSampleRate: null,
  dsdTransportSampleRate: null,
  volume: 1,
  playbackRate: 1,
  playbackSpeedMode: 'nightcore',
  currentFilePath: null,
  currentTrackId: null,
  durationSeconds: 0,
  positionSeconds: 0,
  channels: null,
  codec: null,
  bitDepth: null,
  bitrate: null,
  fileSampleRate: null,
  decoderOutputSampleRate: null,
  requestedOutputSampleRate: null,
  actualDeviceSampleRate: null,
  sharedDeviceSampleRate: null,
  resampling: false,
  resamplerEngine: 'default',
  resamplerFallbackActive: false,
  bitPerfectCandidate: false,
  sampleRateMismatch: false,
  latencyProfile: 'balanced',
  eqEnabled: false,
  channelBalanceEnabled: false,
  dspActive: false,
  preampDb: 0,
  eqPresetName: null,
  clippingRisk: false,
  bitPerfectDisabledReason: null,
  warnings: [],
  error: null,
  ...overrides,
});

class FakeAudioSession extends EventEmitter {
  status = audioStatus();
  playPcmStream = vi.fn(async (request: {
    stream: PassThrough;
    sourceId: string;
    trackId?: string | null;
    sampleRate: number;
    channels: number;
  }) => {
    this.status = audioStatus({
      state: 'playing',
      currentFilePath: request.sourceId,
      currentTrackId: request.trackId ?? request.sourceId,
      codec: 'pcm-f32le',
      channels: request.channels,
      fileSampleRate: request.sampleRate,
      decoderOutputSampleRate: request.sampleRate,
      requestedOutputSampleRate: request.sampleRate,
    });
    this.emit('status', this.status);
    return this.status;
  });
  pause = vi.fn(async () => {
    this.status = { ...this.status, state: 'paused' };
    this.emit('status', this.status);
    return this.status;
  });
  stop = vi.fn(async () => {
    this.status = { ...this.status, state: 'stopped', currentFilePath: null, currentTrackId: null };
    this.emit('status', this.status);
    return this.status;
  });
  setOutput = vi.fn(async (settings: { volume: number }) => {
    this.status = { ...this.status, volume: settings.volume };
    this.emit('status', this.status);
    return this.status;
  });
  getStatus = (): AudioStatus => this.status;
}

const x25519SpkiPrefix = Buffer.from('302a300506032b656e032100', 'hex');
const ed25519SpkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');

const exportX25519PublicKey = (publicKey: KeyObject): Buffer =>
  Buffer.from(publicKey.export({ format: 'der', type: 'spki' })).subarray(x25519SpkiPrefix.length);

const exportEd25519PublicKey = (publicKey: KeyObject): Buffer =>
  Buffer.from(publicKey.export({ format: 'der', type: 'spki' })).subarray(ed25519SpkiPrefix.length);

const createX25519PublicKey = (rawPublicKey: Buffer): KeyObject =>
  createPublicKey({
    key: Buffer.concat([x25519SpkiPrefix, rawPublicKey]),
    format: 'der',
    type: 'spki',
  });

const createEd25519PublicKey = (rawPublicKey: Buffer): KeyObject =>
  createPublicKey({
    key: Buffer.concat([ed25519SpkiPrefix, rawPublicKey]),
    format: 'der',
    type: 'spki',
  });

const encodeTlv = (fields: Array<{ type: number; value: Buffer }>): Buffer =>
  Buffer.concat(fields.flatMap(({ type, value }) => {
    if (value.length === 0) {
      return [Buffer.from([type, 0])];
    }
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < value.length; offset += 255) {
      const chunk = value.subarray(offset, offset + 255);
      chunks.push(Buffer.from([type, chunk.length]), chunk);
    }
    return chunks;
  }));

const parseTlv = (body: Buffer): Map<number, Buffer[]> => {
  const fields = new Map<number, Buffer[]>();
  let offset = 0;
  while (offset + 2 <= body.length) {
    const type = body[offset];
    const length = body[offset + 1];
    offset += 2;
    const list = fields.get(type) ?? [];
    list.push(body.subarray(offset, offset + length));
    fields.set(type, list);
    offset += length;
  }
  return fields;
};

const tlvValue = (fields: Map<number, Buffer[]>, type: number): Buffer =>
  Buffer.concat(fields.get(type) ?? []);

const derivePairVerifyKey = (sharedSecret: Buffer): Buffer =>
  Buffer.from(hkdfSync(
    'sha512',
    sharedSecret,
    Buffer.from('Pair-Verify-Encrypt-Salt', 'utf8'),
    Buffer.from('Pair-Verify-Encrypt-Info', 'utf8'),
    32,
  ));

const deriveControlKey = (sharedSecret: Buffer, info: string): Buffer =>
  Buffer.from(hkdfSync(
    'sha512',
    sharedSecret,
    Buffer.from('Control-Salt', 'utf8'),
    Buffer.from(info, 'utf8'),
    32,
  ));

const derivePairSetupKey = (sharedSecret: Buffer, salt: string, info: string): Buffer =>
  Buffer.from(hkdfSync(
    'sha512',
    sharedSecret,
    Buffer.from(salt, 'utf8'),
    Buffer.from(info, 'utf8'),
    32,
  ));

const testSrpUsername = 'Pair-Setup';
const testSrpPassword = '3939';
const testSrpModulusHex = [
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD',
  '3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F',
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64',
  '521F2B18177B200CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF',
].join('');
const testSrpModulus = BigInt(`0x${testSrpModulusHex}`);
const testSrpModulusBytes = testSrpModulusHex.length / 2;
const testSrpGenerator = 5n;

const sha512 = (...buffers: Buffer[]): Buffer => {
  const hash = createHash('sha512');
  for (const buffer of buffers) {
    hash.update(buffer);
  }
  return hash.digest();
};

const bigintFromBuffer = (value: Buffer): bigint => BigInt(`0x${value.toString('hex') || '0'}`);

const bigintToBuffer = (value: bigint, byteLength = testSrpModulusBytes): Buffer =>
  Buffer.from(value.toString(16).padStart(byteLength * 2, '0').slice(-byteLength * 2), 'hex');

const bigintToMinimalBuffer = (value: bigint): Buffer => {
  const hex = value.toString(16);
  return Buffer.from(hex.length % 2 === 0 ? hex : `0${hex}`, 'hex');
};

const hashBigint = (...buffers: Buffer[]): bigint => bigintFromBuffer(sha512(...buffers));

const testSrpMultiplier = hashBigint(bigintToBuffer(testSrpModulus), bigintToBuffer(testSrpGenerator));

const modPow = (base: bigint, exponent: bigint, modulus: bigint): bigint => {
  let result = 1n;
  let nextBase = ((base % modulus) + modulus) % modulus;
  let nextExponent = exponent;
  while (nextExponent > 0n) {
    if (nextExponent & 1n) {
      result = (result * nextBase) % modulus;
    }
    nextBase = (nextBase * nextBase) % modulus;
    nextExponent >>= 1n;
  }
  return result;
};

const createSrpClientProof = (
  salt: Buffer,
  serverPublicKey: Buffer,
  clientPrivateKey: bigint,
): { clientPublicKey: Buffer; clientProof: Buffer; serverProof: Buffer; sessionKey: Buffer; sessionSecret: Buffer } => {
  const clientPublic = modPow(testSrpGenerator, clientPrivateKey, testSrpModulus);
  const clientPublicKey = bigintToBuffer(clientPublic);
  const x = hashBigint(salt, sha512(Buffer.from(`${testSrpUsername}:${testSrpPassword}`, 'utf8')));
  const scramblingParameter = hashBigint(clientPublicKey, serverPublicKey);
  const serverPublic = bigintFromBuffer(serverPublicKey);
  const verifierTerm = (testSrpMultiplier * modPow(testSrpGenerator, x, testSrpModulus)) % testSrpModulus;
  const base = ((serverPublic - verifierTerm) % testSrpModulus + testSrpModulus) % testSrpModulus;
  const sessionSecret = modPow(base, clientPrivateKey + (scramblingParameter * x), testSrpModulus);
  const sessionSecretBuffer = bigintToBuffer(sessionSecret);
  const sessionKey = sha512(sessionSecretBuffer);
  const modulusHash = sha512(bigintToBuffer(testSrpModulus));
  const generatorHash = sha512(bigintToMinimalBuffer(testSrpGenerator));
  const groupHash = Buffer.from(modulusHash.map((value, index) => value ^ generatorHash[index]));
  const usernameHash = sha512(Buffer.from(testSrpUsername, 'utf8'));
  const clientProof = sha512(groupHash, usernameHash, salt, clientPublicKey, serverPublicKey, sessionKey);
  const serverProof = sha512(clientPublicKey, clientProof, sessionKey);
  return { clientPublicKey, clientProof, serverProof, sessionKey, sessionSecret: sessionSecretBuffer };
};

const airPlay2Nonce = (label: string): Buffer => Buffer.concat([Buffer.alloc(4), Buffer.from(label, 'utf8')]);

const airPlay2CounterNonce = (counter: number): Buffer => {
  const nonce = Buffer.alloc(12);
  nonce.writeUInt32LE(counter >>> 0, 4);
  nonce.writeUInt32LE(Math.floor(counter / 0x1_0000_0000), 8);
  return nonce;
};

const decryptPairVerifyPayload = (key: Buffer, label: string, body: Buffer): Buffer => {
  const decipher = createDecipheriv('chacha20-poly1305', key, airPlay2Nonce(label), { authTagLength: 16 });
  decipher.setAuthTag(body.subarray(-16));
  return Buffer.concat([decipher.update(body.subarray(0, -16)), decipher.final()]);
};

const encryptPairVerifyPayload = (key: Buffer, label: string, body: Buffer): Buffer => {
  const cipher = createCipheriv('chacha20-poly1305', key, airPlay2Nonce(label), { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  return Buffer.concat([encrypted, cipher.getAuthTag()]);
};

const encryptControlFrame = (key: Buffer, counter: number, payload: Buffer): Buffer => {
  const cipher = createCipheriv('chacha20-poly1305', key, airPlay2CounterNonce(counter), { authTagLength: 16 });
  const header = Buffer.alloc(2);
  header.writeUInt16LE(payload.length, 0);
  cipher.setAAD(header, { plaintextLength: payload.length });
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const frame = Buffer.alloc(2 + encrypted.length + 16);
  header.copy(frame, 0);
  encrypted.copy(frame, 2);
  cipher.getAuthTag().copy(frame, 2 + encrypted.length);
  return frame;
};

const decryptControlFrame = (key: Buffer, counter: number, frame: Buffer): Buffer => {
  const length = frame.readUInt16LE(0);
  const decipher = createDecipheriv('chacha20-poly1305', key, airPlay2CounterNonce(counter), { authTagLength: 16 });
  decipher.setAAD(frame.subarray(0, 2), { plaintextLength: length });
  decipher.setAuthTag(frame.subarray(2 + length));
  return Buffer.concat([decipher.update(frame.subarray(2, 2 + length)), decipher.final()]);
};

const readUntil = (socket: Socket, predicate: (buffer: Buffer) => boolean): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      if (predicate(buffer)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off('data', onData);
      socket.off('error', onError);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });

const hasCompleteTextResponse = (buffer: Buffer): boolean => {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd < 0) {
    return false;
  }
  const headers = buffer.subarray(0, headerEnd).toString('utf8');
  const match = /\r\nContent-Length:\s*(\d+)/iu.exec(headers);
  const length = match ? Number(match[1]) : 0;
  return buffer.length >= headerEnd + 4 + length;
};

const textResponseBody = (buffer: Buffer): Buffer => {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  const headers = buffer.subarray(0, headerEnd).toString('utf8');
  const match = /\r\nContent-Length:\s*(\d+)/iu.exec(headers);
  const length = match ? Number(match[1]) : 0;
  return buffer.subarray(headerEnd + 4, headerEnd + 4 + length);
};

const hasCompleteControlFrame = (buffer: Buffer): boolean =>
  buffer.length >= 2 && buffer.length >= 2 + buffer.readUInt16LE(0) + 16;

const rawRequest = (
  method: string,
  path: string,
  body: Uint8Array = Buffer.alloc(0),
  extraHeaders: string[] = [],
  contentType: string | null = body.length > 0 ? 'application/octet-stream' : null,
): Buffer =>
  Buffer.concat([
    Buffer.from([
      `${method} ${path} RTSP/1.0`,
      ...extraHeaders,
      `Content-Length: ${body.length}`,
      ...(contentType ? [`Content-Type: ${contentType}`] : []),
    ].join('\r\n') + '\r\n\r\n', 'utf8'),
    body,
  ]);

type TestBplistSet = {
  __testBplistSet: TestBplistValue[];
};

type TestBplistValue =
  | null
  | boolean
  | number
  | string
  | Buffer
  | TestBplistValue[]
  | TestBplistSet
  | { [key: string]: TestBplistValue };

type TestBplistRecord = {
  value: TestBplistValue;
  arrayRefs?: number[];
  setRefs?: number[];
  dictKeyRefs?: number[];
  dictValueRefs?: number[];
};

const testBplistSet = (items: TestBplistValue[]): TestBplistSet => ({ __testBplistSet: items });

const isTestBplistSet = (value: TestBplistValue): value is TestBplistSet =>
  Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !Buffer.isBuffer(value) &&
    Object.prototype.hasOwnProperty.call(value, '__testBplistSet'),
  );

const testBplistIntByteLength = (value: number): 1 | 2 | 4 | 8 => {
  if (value >= 0 && value <= 0xff) return 1;
  if (value >= 0 && value <= 0xffff) return 2;
  if (value >= 0 && value <= 0xffff_ffff) return 4;
  return 8;
};

const writeTestBplistUint = (value: number | bigint, byteLength: number): Buffer => {
  const output = Buffer.alloc(byteLength);
  let next = BigInt(value);
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    output[index] = Number(next & 0xffn);
    next >>= 8n;
  }
  return output;
};

const encodeTestBplistInt = (value: number): Buffer => {
  const byteLength = testBplistIntByteLength(value);
  return Buffer.concat([Buffer.from([0x10 | Math.log2(byteLength)]), writeTestBplistUint(value, byteLength)]);
};

const encodeTestBplistLength = (type: number, length: number): Buffer =>
  length < 15
    ? Buffer.from([type | length])
    : Buffer.concat([Buffer.from([type | 0x0f]), encodeTestBplistInt(length)]);

const collectTestBplistObjects = (value: TestBplistValue, objects: TestBplistRecord[]): number => {
  const index = objects.length;
  const record: TestBplistRecord = { value };
  objects.push(record);
  if (isTestBplistSet(value)) {
    record.setRefs = value.__testBplistSet.map((item) => collectTestBplistObjects(item, objects));
  } else if (Array.isArray(value)) {
    record.arrayRefs = value.map((item) => collectTestBplistObjects(item, objects));
  } else if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    const entries = Object.entries(value);
    record.dictKeyRefs = entries.map(([key]) => collectTestBplistObjects(key, objects));
    record.dictValueRefs = entries.map(([, item]) => collectTestBplistObjects(item, objects));
  }
  return index;
};

const encodeTestBplistObject = (record: TestBplistRecord, refSize: number): Buffer => {
  const { value } = record;
  if (value === null) return Buffer.from([0x00]);
  if (typeof value === 'boolean') return Buffer.from([value ? 0x09 : 0x08]);
  if (typeof value === 'number') return encodeTestBplistInt(value);
  if (typeof value === 'string') {
    const content = Buffer.from(value, 'ascii');
    return Buffer.concat([encodeTestBplistLength(0x50, content.length), content]);
  }
  if (Buffer.isBuffer(value)) {
    return Buffer.concat([encodeTestBplistLength(0x40, value.length), value]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([
      encodeTestBplistLength(0xa0, value.length),
      ...(record.arrayRefs ?? []).map((ref) => writeTestBplistUint(ref, refSize)),
    ]);
  }
  if (isTestBplistSet(value)) {
    return Buffer.concat([
      encodeTestBplistLength(0xc0, value.__testBplistSet.length),
      ...(record.setRefs ?? []).map((ref) => writeTestBplistUint(ref, refSize)),
    ]);
  }

  const entries = Object.entries(value);
  return Buffer.concat([
    encodeTestBplistLength(0xd0, entries.length),
    ...(record.dictKeyRefs ?? []).map((ref) => writeTestBplistUint(ref, refSize)),
    ...(record.dictValueRefs ?? []).map((ref) => writeTestBplistUint(ref, refSize)),
  ]);
};

const encodeTestBplist = (value: TestBplistValue): Buffer => {
  const objects: TestBplistRecord[] = [];
  collectTestBplistObjects(value, objects);
  const refSize = objects.length <= 0xff ? 1 : objects.length <= 0xffff ? 2 : 4;
  const encodedObjects = objects.map((object) => encodeTestBplistObject(object, refSize));
  const offsets: number[] = [];
  let offset = 8;
  for (const object of encodedObjects) {
    offsets.push(offset);
    offset += object.length;
  }
  const offsetTableOffset = offset;
  const offsetSize = offset <= 0xff ? 1 : offset <= 0xffff ? 2 : offset <= 0xffff_ffff ? 4 : 8;
  return Buffer.concat([
    Buffer.from('bplist00', 'ascii'),
    ...encodedObjects,
    ...offsets.map((item) => writeTestBplistUint(item, offsetSize)),
    Buffer.alloc(6),
    Buffer.from([offsetSize, refSize]),
    writeTestBplistUint(objects.length, 8),
    writeTestBplistUint(0, 8),
    writeTestBplistUint(offsetTableOffset, 8),
  ]);
};

const encryptRtpPayload = (key: Buffer, rtpHeader: Buffer, plaintext: Buffer): Buffer => {
  const nonceSuffix = Buffer.from('0102030405060708', 'hex');
  const cipher = createCipheriv('chacha20-poly1305', key, Buffer.concat([Buffer.alloc(4), nonceSuffix]), { authTagLength: 16 });
  cipher.setAAD(rtpHeader.subarray(4, 12), { plaintextLength: plaintext.length });
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([encrypted, nonceSuffix, cipher.getAuthTag()]);
};

describe('AirPlayReceiverSpikeService', () => {
  it('uses the current Electron executable for the AirPlay helper in packaged builds', () => {
    const nodePath = resolveAirPlayHelperNodePath({
      isPackaged: true,
      processExecPath: 'C:\\Program Files\\ECHO NEXT\\ECHO NEXT.exe',
      npmNodeExecPath: 'C:\\Program Files\\ECHO Next\\ECHO NEXT.exe',
      nodeEnvPath: 'C:\\stale\\node.exe',
    });

    expect(nodePath).toBe('C:\\Program Files\\ECHO NEXT\\ECHO NEXT.exe');
  });

  it('keeps explicit Node runtimes available for AirPlay helper development runs', () => {
    const nodePath = resolveAirPlayHelperNodePath({
      isPackaged: false,
      processExecPath: 'C:\\Electron\\electron.exe',
      npmNodeExecPath: 'C:\\Node\\node.exe',
      nodeEnvPath: null,
    });

    expect(nodePath).toBe('C:\\Node\\node.exe');
  });

  it('converts signed 16-bit PCM to float32 PCM', () => {
    const input = Buffer.alloc(8);
    input.writeInt16LE(-32768, 0);
    input.writeInt16LE(0, 2);
    input.writeInt16LE(16384, 4);
    input.writeInt16LE(32767, 6);

    const output = convertS16leToF32le(input);

    expect(output.readFloatLE(0)).toBe(-1);
    expect(output.readFloatLE(4)).toBe(0);
    expect(output.readFloatLE(8)).toBeCloseTo(0.5, 4);
    expect(output.readFloatLE(12)).toBeCloseTo(0.99997, 4);
  });

  it('reports native backend failure without enabling the receiver', async () => {
    const service = new AirPlayReceiverSpikeService({
      audioSession: new FakeAudioSession() as never,
      loadRaopModule: async () => {
        throw new Error('Cannot find module @lox-audioserver/node-libraop');
      },
    });

    const status = await service.setEnabled(true);

    expect(status.enabled).toBe(false);
    expect(status.state).toBe('unavailable');
    expect(status.nativeAvailable).toBe(false);
    expect(status.error).toContain('node-libraop');
  });

  it('reports startup timeout when the RAOP receiver does not answer', async () => {
    const service = new AirPlayReceiverSpikeService({
      audioSession: new FakeAudioSession() as never,
      startupTimeoutMs: 5,
      loadRaopModule: async () => ({
        startReceiver: vi.fn(() => new Promise<number>(() => undefined)),
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
    });

    const status = await service.setEnabled(true);

    expect(status.enabled).toBe(false);
    expect(status.state).toBe('unavailable');
    expect(status.nativeAvailable).toBe(false);
    expect(status.error).toContain('timed out');
  });

  it('binds the RAOP receiver to all adapters and advertises each LAN interface', async () => {
    const audio = new FakeAudioSession();
    const startReceiver = vi.fn((options: { portBase: number }) => {
      void options;
      return 23;
    });
    const stopReceiver = vi.fn();
    const mdnsStarts: Array<{ address: string; mac: string; port: number }> = [];
    const mdnsStops: Array<ReturnType<typeof vi.fn>> = [];
    const service = new AirPlayReceiverSpikeService({
      audioSession: audio as never,
      getAdvertiseInterfaces: () => [
        { name: 'Ethernet', address: '192.168.31.214', mac: '60:CF:84:CB:1E:D1' },
        { name: 'Wi-Fi', address: '10.0.0.8', mac: '70:CF:84:CB:1E:D1' },
      ],
      createMdnsAdvertiser: () => {
        const stop = vi.fn(async () => undefined);
        mdnsStops.push(stop);
        return {
          start: vi.fn(async (advertisement) => {
            mdnsStarts.push({
              address: advertisement.address,
              mac: advertisement.mac,
              port: advertisement.port,
            });
          }),
          stop,
        };
      },
      loadRaopModule: async () => ({
        startReceiver,
        stopReceiver,
        sendRemoteCommand: vi.fn(() => true),
      }),
    });

    const status = await service.setEnabled(true);
    const options = startReceiver.mock.calls[0]?.[0];
    expect(options).toBeDefined();

    expect(status.enabled).toBe(true);
    expect(options).toEqual(expect.objectContaining({
      name: 'ECHO Next (AirPlay)',
      model: 'ECHO-Next-AirPlay-Spike',
      mac: '60:CF:84:CB:1E:D1',
      latencies: '1000:1000',
      metadata: true,
      portRange: 100,
    }));
    expect(options).not.toHaveProperty('host');
    expect(mdnsStarts).toEqual([
      { address: '192.168.31.214', mac: '60:CF:84:CB:1E:D1', port: options!.portBase },
      { address: '10.0.0.8', mac: '60:CF:84:CB:1E:D1', port: options!.portBase },
    ]);

    await service.setEnabled(false);

    expect(stopReceiver).toHaveBeenCalledWith(23);
    expect(mdnsStops).toHaveLength(2);
    expect(mdnsStops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
  });

  it('keeps the receiver enabled but surfaces discovery failure when mDNS cannot advertise', async () => {
    const service = new AirPlayReceiverSpikeService({
      audioSession: new FakeAudioSession() as never,
      getAdvertiseInterfaces: () => [
        { name: 'Wi-Fi', address: '192.168.31.214', mac: '60:CF:84:CB:1E:D1' },
      ],
      createMdnsAdvertiser: () => ({
        start: vi.fn(async () => {
          throw new Error('bind EADDRINUSE 0.0.0.0:5353');
        }),
        stop: vi.fn(async () => undefined),
      }),
      loadRaopModule: async () => ({
        startReceiver: vi.fn(() => 23),
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
    });

    const status = await service.setEnabled(true);

    expect(status.enabled).toBe(true);
    expect(status.nativeAvailable).toBe(true);
    expect(status.error).toContain('AirPlay discovery unavailable');
    expect(status.debugEvents.some((event) => event.action === 'mdns' && event.message?.includes('EADDRINUSE'))).toBe(true);
  });

  it('keeps the normal AirPlay receiver toggle on AirPlay 1 discovery by default', async () => {
    const mdnsStarts: Array<{ airPlay2Experimental?: boolean; airPlayPort?: number | null; airPlayPublicKey?: string | null }> = [];
    const service = new AirPlayReceiverSpikeService({
      audioSession: new FakeAudioSession() as never,
      getAdvertiseInterfaces: () => [
        { name: 'Wi-Fi', address: '192.168.31.214', mac: '60:CF:84:CB:1E:D1' },
      ],
      createMdnsAdvertiser: () => ({
        start: vi.fn(async (advertisement) => {
          mdnsStarts.push({
            airPlay2Experimental: advertisement.airPlay2Experimental,
            airPlayPort: advertisement.airPlayPort,
            airPlayPublicKey: advertisement.airPlayPublicKey,
          });
        }),
        stop: vi.fn(async () => undefined),
      }),
      loadRaopModule: async () => ({
        startReceiver: vi.fn(() => 23),
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
    });

    const status = await service.setEnabled(true);

    expect(mdnsStarts).toEqual([{
      airPlay2Experimental: false,
      airPlayPort: null,
      airPlayPublicKey: expect.stringMatching(/^[\da-f]{64}$/u),
    }]);
    expect(status.protocol).toBe('airplay1');
    expect(status.debugEvents.some((event) => event.action === 'airplay2')).toBe(false);
    await service.setEnabled(false);
  });

  it('advertises AirPlay 2 discovery when the receiver protocol setting selects the experimental mode', async () => {
    const mdnsStarts: Array<{ airPlay2Experimental?: boolean; airPlayPort?: number | null; airPlayPublicKey?: string | null }> = [];
    const service = new AirPlayReceiverSpikeService({
      audioSession: new FakeAudioSession() as never,
      getAirPlayReceiverProtocol: () => 'airplay2',
      getAdvertiseInterfaces: () => [
        { name: 'Wi-Fi', address: '192.168.31.214', mac: '60:CF:84:CB:1E:D1' },
      ],
      createMdnsAdvertiser: () => ({
        start: vi.fn(async (advertisement) => {
          mdnsStarts.push({
            airPlay2Experimental: advertisement.airPlay2Experimental,
            airPlayPort: advertisement.airPlayPort,
            airPlayPublicKey: advertisement.airPlayPublicKey,
          });
        }),
        stop: vi.fn(async () => undefined),
      }),
      loadRaopModule: async () => ({
        startReceiver: vi.fn(() => 23),
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
    });

    const status = await service.setEnabled(true);

    expect(mdnsStarts).toEqual([{
      airPlay2Experimental: true,
      airPlayPort: expect.any(Number),
      airPlayPublicKey: expect.stringMatching(/^[\da-f]{64}$/u),
    }]);
    expect(status.protocol).toBe('airplay2');
    expect(status.debugEvents.some((event) => event.action === 'airplay2')).toBe(true);
    await service.setEnabled(false);
  });

  it('answers AirPlay 2 experimental info probes on the AirPlay control port', async () => {
    const mdnsStarts: Array<{ airPlayPort?: number | null; raopPort: number }> = [];
    const service = new AirPlayReceiverSpikeService({
      audioSession: new FakeAudioSession() as never,
      airPlay2Experimental: true,
      getAdvertiseInterfaces: () => [
        { name: 'Wi-Fi', address: '192.168.31.214', mac: '60:CF:84:CB:1E:D1' },
      ],
      createMdnsAdvertiser: () => ({
        start: vi.fn(async (advertisement) => {
          mdnsStarts.push({ airPlayPort: advertisement.airPlayPort, raopPort: advertisement.port });
        }),
        stop: vi.fn(async () => undefined),
      }),
      loadRaopModule: async () => ({
        startReceiver: vi.fn(() => 23),
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
    });

    await service.setEnabled(true);
    const advertised = mdnsStarts[0]!;
    expect(advertised.airPlayPort).toEqual(expect.any(Number));
    expect(advertised.airPlayPort).not.toBe(advertised.raopPort);

    const emittedActions: string[] = [];
    service.on('status', (status) => {
      const action = status.debugEvents[0]?.action;
      if (action) {
        emittedActions.push(action);
      }
    });

    const response = await fetch(`http://127.0.0.1:${advertised.airPlayPort}/info`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/x-apple-plist+xml');
    expect(body).toContain('<key>sourceVersion</key>');
    expect(body).toContain('366.0');
    expect(body).toContain('<integer>496155702053376</integer>');
    expect(body).toContain('<key>audioFormats</key>');
    expect(body).toContain('<integer>1572860</integer>');
    expect(body).not.toContain('<integer>67108860</integer>');
    expect(emittedActions).toContain('info');

    const socket = connect(advertised.airPlayPort!, '127.0.0.1');
    try {
      socket.write(rawRequest(
        'GET',
        '/info',
        encodeTestBplist({ qualifier: ['txtAirPlay'] }),
        ['CSeq: 1', 'X-Apple-ProtocolVersion: 1'],
        'application/x-apple-binary-plist',
      ));
      const binaryInfoResponse = await readUntil(socket, hasCompleteTextResponse);
      const responseText = binaryInfoResponse.toString('utf8');
      const responseBody = textResponseBody(binaryInfoResponse);

      expect(responseText).toContain('RTSP/1.0 200 OK');
      expect(responseText).toContain('Content-Type: application/x-apple-binary-plist');
      expect(responseText).toContain('CSeq: 1');
      expect(responseBody.subarray(0, 8).toString('ascii')).toBe('bplist00');
      expect(responseBody.toString('binary')).toContain('audioFormats');
      expect(responseBody.toString('binary')).toContain('protocolVersion');
      expect(responseBody.toString('binary')).toContain('sourceVersion');
      expect(responseBody.toString('binary')).toContain('pk');
    } finally {
      socket.destroy();
    }

    await service.setEnabled(false);
  });

  it('answers AirPlay 2 Pair-Setup M1-M6 exchange', async () => {
    const mdnsStarts: Array<{ airPlayPort?: number | null }> = [];
    const service = new AirPlayReceiverSpikeService({
      audioSession: new FakeAudioSession() as never,
      airPlay2Experimental: true,
      getAdvertiseInterfaces: () => [
        { name: 'Wi-Fi', address: '192.168.31.214', mac: '60:CF:84:CB:1E:D1' },
      ],
      createMdnsAdvertiser: () => ({
        start: vi.fn(async (advertisement) => {
          mdnsStarts.push({ airPlayPort: advertisement.airPlayPort });
        }),
        stop: vi.fn(async () => undefined),
      }),
      loadRaopModule: async () => ({
        startReceiver: vi.fn(() => 23),
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
    });

    await service.setEnabled(true);
    const airPlayPort = mdnsStarts[0]!.airPlayPort;
    expect(airPlayPort).toEqual(expect.any(Number));

    const m1Body = encodeTlv([
      { type: 6, value: Buffer.from([1]) },
      { type: 0, value: Buffer.from([1]) },
    ]);
    const m1Response = await fetch(`http://127.0.0.1:${airPlayPort}/pair-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(m1Body),
    });

    expect(m1Response.status).toBe(200);
    const m2Fields = parseTlv(Buffer.from(await m1Response.arrayBuffer()));
    expect(tlvValue(m2Fields, 6).readUInt8(0)).toBe(2);
    const salt = tlvValue(m2Fields, 2);
    const serverPublicKey = tlvValue(m2Fields, 3);
    expect(salt).toHaveLength(16);
    expect(serverPublicKey).toHaveLength(testSrpModulusBytes);

    const srpClient = createSrpClientProof(salt, serverPublicKey, 123_456_789n);
    const m3Body = encodeTlv([
      { type: 6, value: Buffer.from([3]) },
      { type: 3, value: srpClient.clientPublicKey },
      { type: 4, value: srpClient.clientProof },
    ]);
    const m3Response = await fetch(`http://127.0.0.1:${airPlayPort}/pair-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(m3Body),
    });

    expect(m3Response.status).toBe(200);
    const m4Fields = parseTlv(Buffer.from(await m3Response.arrayBuffer()));
    expect(tlvValue(m4Fields, 6).readUInt8(0)).toBe(4);
    expect(tlvValue(m4Fields, 4)).toEqual(srpClient.serverProof);

    const pairSetupKey = derivePairSetupKey(
      srpClient.sessionKey,
      'Pair-Setup-Encrypt-Salt',
      'Pair-Setup-Encrypt-Info',
    );
    const controllerKeys = generateKeyPairSync('ed25519');
    const controllerPublicKey = exportEd25519PublicKey(controllerKeys.publicKey);
    const controllerIdentifier = Buffer.from('test-controller', 'utf8');
    const controllerSigningKey = derivePairSetupKey(
      srpClient.sessionKey,
      'Pair-Setup-Controller-Sign-Salt',
      'Pair-Setup-Controller-Sign-Info',
    );
    const controllerSignature = sign(
      null,
      Buffer.concat([controllerSigningKey, controllerIdentifier, controllerPublicKey]),
      controllerKeys.privateKey,
    );
    const m5EncryptedData = encryptPairVerifyPayload(
      pairSetupKey,
      'PS-Msg05',
      encodeTlv([
        { type: 1, value: controllerIdentifier },
        { type: 3, value: controllerPublicKey },
        { type: 10, value: controllerSignature },
      ]),
    );
    const m5Body = encodeTlv([
      { type: 6, value: Buffer.from([5]) },
      { type: 5, value: m5EncryptedData },
    ]);
    const m5Response = await fetch(`http://127.0.0.1:${airPlayPort}/pair-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(m5Body),
    });

    expect(m5Response.status).toBe(200);
    const m6Fields = parseTlv(Buffer.from(await m5Response.arrayBuffer()));
    expect(tlvValue(m6Fields, 6).readUInt8(0)).toBe(6);
    const accessoryFields = parseTlv(decryptPairVerifyPayload(pairSetupKey, 'PS-Msg06', tlvValue(m6Fields, 5)));
    const accessoryIdentifier = tlvValue(accessoryFields, 1);
    const accessoryPublicKey = tlvValue(accessoryFields, 3);
    const accessorySignature = tlvValue(accessoryFields, 10);
    const accessorySigningKey = derivePairSetupKey(
      srpClient.sessionKey,
      'Pair-Setup-Accessory-Sign-Salt',
      'Pair-Setup-Accessory-Sign-Info',
    );
    expect(accessoryIdentifier.toString('utf8')).toBe('60:CF:84:CB:1E:D1');
    expect(accessoryPublicKey).toHaveLength(32);
    expect(verify(
      null,
      Buffer.concat([accessorySigningKey, accessoryIdentifier, accessoryPublicKey]),
      createEd25519PublicKey(accessoryPublicKey),
      accessorySignature,
    )).toBe(true);
    const status = service.getStatus();
    const setupEvent = status.debugEvents.find((event) =>
      event.action === 'pair-setup' && event.message?.includes('M5 controller signature verified'),
    );
    expect(setupEvent).toEqual(expect.objectContaining({
      method: 'POST',
      path: '/pair-setup',
      statusCode: 200,
    }));

    await service.setEnabled(false);
  });

  it('enables encrypted control frames after transient AirPlay 2 Pair-Setup M1-M4 with the fallback cipher', async () => {
    const previousFallback = process.env.ECHO_FORCE_AIRPLAY2_CHACHA_FALLBACK;
    process.env.ECHO_FORCE_AIRPLAY2_CHACHA_FALLBACK = '1';
    const mdnsStarts: Array<{ airPlayPort?: number | null }> = [];
    const service = new AirPlayReceiverSpikeService({
      audioSession: new FakeAudioSession() as never,
      airPlay2Experimental: true,
      getAdvertiseInterfaces: () => [
        { name: 'Wi-Fi', address: '192.168.31.214', mac: '60:CF:84:CB:1E:D1' },
      ],
      createMdnsAdvertiser: () => ({
        start: vi.fn(async (advertisement) => {
          mdnsStarts.push({ airPlayPort: advertisement.airPlayPort });
        }),
        stop: vi.fn(async () => undefined),
      }),
      loadRaopModule: async () => ({
        startReceiver: vi.fn(() => 23),
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
    });

    await service.setEnabled(true);
    const airPlayPort = mdnsStarts[0]!.airPlayPort;
    expect(airPlayPort).toEqual(expect.any(Number));

    const socket = connect({ host: '127.0.0.1', port: airPlayPort! });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });

      const transientFlags = Buffer.from([0, 0, 0, 0x10]);
      socket.write(rawRequest('POST', '/pair-setup', encodeTlv([
        { type: 6, value: Buffer.from([1]) },
        { type: 0, value: Buffer.from([0]) },
        { type: 19, value: transientFlags },
      ]), ['CSeq: 31']));
      const m2Response = await readUntil(socket, hasCompleteTextResponse);
      expect(m2Response.toString('utf8')).toContain('RTSP/1.0 200 OK');
      expect(m2Response.toString('utf8')).toContain('CSeq: 31');
      const m2Fields = parseTlv(textResponseBody(m2Response));
      expect(tlvValue(m2Fields, 6).readUInt8(0)).toBe(2);
      expect(tlvValue(m2Fields, 19)).toEqual(transientFlags);
      const salt = tlvValue(m2Fields, 2);
      const serverPublicKey = tlvValue(m2Fields, 3);

      const srpClient = createSrpClientProof(salt, serverPublicKey, 987_654_321n);
      socket.write(rawRequest('POST', '/pair-setup', encodeTlv([
        { type: 6, value: Buffer.from([3]) },
        { type: 3, value: srpClient.clientPublicKey },
        { type: 4, value: srpClient.clientProof },
      ]), ['CSeq: 32']));
      const m4Response = await readUntil(socket, hasCompleteTextResponse);
      expect(m4Response.toString('utf8')).toContain('RTSP/1.0 200 OK');
      expect(m4Response.toString('utf8')).toContain('CSeq: 32');
      const m4Fields = parseTlv(textResponseBody(m4Response));
      expect(tlvValue(m4Fields, 6).readUInt8(0)).toBe(4);
      expect(tlvValue(m4Fields, 4)).toEqual(srpClient.serverProof);

      const controlWriteKey = deriveControlKey(srpClient.sessionSecret, 'Control-Write-Encryption-Key');
      const controlReadKey = deriveControlKey(srpClient.sessionSecret, 'Control-Read-Encryption-Key');
      socket.write(encryptControlFrame(controlWriteKey, 0, rawRequest(
        'OPTIONS',
        '*',
        Buffer.alloc(0),
        ['CSeq: 33'],
      )));
      const encryptedResponse = await readUntil(socket, hasCompleteControlFrame);
      const plaintextResponse = decryptControlFrame(controlReadKey, 0, encryptedResponse);
      expect(plaintextResponse.toString('utf8')).toContain('RTSP/1.0 200 OK');
      expect(plaintextResponse.toString('utf8')).toContain('CSeq: 33');
      expect(plaintextResponse.toString('utf8')).toContain('Public: ANNOUNCE, SETUP');
      const splitRequest = rawRequest(
        'POST',
        '/feedback',
        Buffer.alloc(1100, 0x66),
        ['CSeq: 34'],
        'application/octet-stream',
      );
      socket.write(encryptControlFrame(controlWriteKey, 1, splitRequest.subarray(0, 1024)));
      socket.write(encryptControlFrame(controlWriteKey, 2, splitRequest.subarray(1024)));
      const encryptedSplitResponse = await readUntil(socket, hasCompleteControlFrame);
      const plaintextSplitResponse = decryptControlFrame(controlReadKey, 1, encryptedSplitResponse);
      expect(plaintextSplitResponse.toString('utf8')).toContain('RTSP/1.0 200 OK');
      expect(plaintextSplitResponse.toString('utf8')).toContain('CSeq: 34');
      expect(service.getStatus().debugEvents.some((event) =>
        event.action === 'pair-setup' && event.message?.includes('transient control channel ready'),
      )).toBe(true);
      expect(service.getStatus().debugEvents.some((event) =>
        event.action === 'crypto' && event.message?.includes('key=srp-shared-secret-padded'),
      )).toBe(true);
      expect(service.getStatus().debugEvents.some((event) =>
        event.action === 'crypto' && event.message?.includes('provider=fallback'),
      )).toBe(true);
    } finally {
      socket.destroy();
      await service.setEnabled(false);
      if (previousFallback === undefined) {
        Reflect.deleteProperty(process.env, 'ECHO_FORCE_AIRPLAY2_CHACHA_FALLBACK');
      } else {
        process.env.ECHO_FORCE_AIRPLAY2_CHACHA_FALLBACK = previousFallback;
      }
    }
  });

  it('answers AirPlay 2 FairPlay setup seq1/seq3 probes', async () => {
    const mdnsStarts: Array<{ airPlayPort?: number | null }> = [];
    const service = new AirPlayReceiverSpikeService({
      audioSession: new FakeAudioSession() as never,
      airPlay2Experimental: true,
      getAdvertiseInterfaces: () => [
        { name: 'Wi-Fi', address: '192.168.31.214', mac: '60:CF:84:CB:1E:D1' },
      ],
      createMdnsAdvertiser: () => ({
        start: vi.fn(async (advertisement) => {
          mdnsStarts.push({ airPlayPort: advertisement.airPlayPort });
        }),
        stop: vi.fn(async () => undefined),
      }),
      loadRaopModule: async () => ({
        startReceiver: vi.fn(() => 23),
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
    });

    await service.setEnabled(true);
    const airPlayPort = mdnsStarts[0]!.airPlayPort;
    expect(airPlayPort).toEqual(expect.any(Number));

    for (const mode of [0, 1, 2, 3]) {
      const setup1 = Buffer.from('46504c590301010000000004020000bb', 'hex');
      setup1[14] = mode;
      const setup1Response = await fetch(`http://127.0.0.1:${airPlayPort}/fp-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(setup1),
      });
      const setup1Body = Buffer.from(await setup1Response.arrayBuffer());
      expect(setup1Response.status).toBe(200);
      expect(setup1Response.headers.get('content-type')).toContain('application/octet-stream');
      expect(setup1Body).toHaveLength(142);
      expect(setup1Body.subarray(0, 12).toString('hex')).toBe('46504c590301020000000082');
      expect(setup1Body[13]).toBe(mode);
    }

    const setup2Suffix = Buffer.from('5c604c516704846d5f14fd5a916348cce7df54a4', 'hex');
    const setup2 = Buffer.concat([
      Buffer.from('46504c590301030000000098038f1a9cca3535b1994b980e4b746e4a', 'hex'),
      Buffer.alloc(124, 0xa5),
      setup2Suffix,
    ]);
    const setup2Response = await fetch(`http://127.0.0.1:${airPlayPort}/fp-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(setup2),
    });
    const setup2Body = Buffer.from(await setup2Response.arrayBuffer());
    expect(setup2Response.status).toBe(200);
    expect(setup2Body).toHaveLength(32);
    expect(setup2Body.subarray(0, 12).toString('hex')).toBe('46504c590301040000000014');
    expect(setup2Body.subarray(12)).toEqual(setup2Suffix);
    expect(service.getStatus().debugEvents.some((event) =>
      event.action === 'fp-setup' && event.message?.includes('key message captured'),
    )).toBe(true);

    await service.setEnabled(false);
  });

  it('answers the AirPlay 2 Pair-Verify M1/M3 cryptographic exchange', async () => {
    const mdnsStarts: Array<{ airPlayPort?: number | null }> = [];
    const service = new AirPlayReceiverSpikeService({
      audioSession: new FakeAudioSession() as never,
      airPlay2Experimental: true,
      getAdvertiseInterfaces: () => [
        { name: 'Wi-Fi', address: '192.168.31.214', mac: '60:CF:84:CB:1E:D1' },
      ],
      createMdnsAdvertiser: () => ({
        start: vi.fn(async (advertisement) => {
          mdnsStarts.push({ airPlayPort: advertisement.airPlayPort });
        }),
        stop: vi.fn(async () => undefined),
      }),
      loadRaopModule: async () => ({
        startReceiver: vi.fn(() => 23),
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
    });

    await service.setEnabled(true);
    const airPlayPort = mdnsStarts[0]!.airPlayPort;
    expect(airPlayPort).toEqual(expect.any(Number));

    const clientKeys = generateKeyPairSync('x25519');
    const clientPublicKey = exportX25519PublicKey(clientKeys.publicKey);
    const m1Body = encodeTlv([
      { type: 6, value: Buffer.from([1]) },
      { type: 3, value: clientPublicKey },
    ]);
    const m1Response = await fetch(`http://127.0.0.1:${airPlayPort}/pair-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(m1Body),
    });

    expect(m1Response.status).toBe(200);
    const m2Fields = parseTlv(Buffer.from(await m1Response.arrayBuffer()));
    expect(tlvValue(m2Fields, 6).readUInt8(0)).toBe(2);
    const serverPublicKey = tlvValue(m2Fields, 3);
    expect(serverPublicKey).toHaveLength(32);
    const encryptedM2 = tlvValue(m2Fields, 5);
    expect(encryptedM2.length).toBeGreaterThan(16);

    const sharedSecret = diffieHellman({
      privateKey: clientKeys.privateKey,
      publicKey: createX25519PublicKey(serverPublicKey),
    });
    const pairVerifyKey = derivePairVerifyKey(sharedSecret);
    const decryptedM2 = parseTlv(decryptPairVerifyPayload(pairVerifyKey, 'PV-Msg02', encryptedM2));
    expect(tlvValue(decryptedM2, 1).toString('utf8')).toBe('60:CF:84:CB:1E:D1');
    expect(tlvValue(decryptedM2, 10)).toHaveLength(64);

    const encryptedM3 = encryptPairVerifyPayload(
      pairVerifyKey,
      'PV-Msg03',
      encodeTlv([
        { type: 1, value: Buffer.from('test-client', 'utf8') },
        { type: 10, value: Buffer.alloc(64, 5) },
      ]),
    );
    const m3Body = encodeTlv([
      { type: 6, value: Buffer.from([3]) },
      { type: 5, value: encryptedM3 },
    ]);
    const m3Response = await fetch(`http://127.0.0.1:${airPlayPort}/pair-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(m3Body),
    });

    expect(m3Response.status).toBe(200);
    const m4Fields = parseTlv(Buffer.from(await m3Response.arrayBuffer()));
    expect(tlvValue(m4Fields, 6).readUInt8(0)).toBe(4);
    expect(service.getStatus().debugEvents.some((event) =>
      event.action === 'pair-verify' && event.message?.includes('encrypted control channel ready'),
    )).toBe(true);

    await service.setEnabled(false);
  });

  it('decrypts AirPlay 2 control/RTP frames after Pair-Verify with the fallback cipher', async () => {
    const previousFallback = process.env.ECHO_FORCE_AIRPLAY2_CHACHA_FALLBACK;
    process.env.ECHO_FORCE_AIRPLAY2_CHACHA_FALLBACK = '1';
    const mdnsStarts: Array<{ airPlayPort?: number | null }> = [];
    const audio = new FakeAudioSession();
    const alacDecodeFrame = vi.fn(() => Buffer.from([
      0x00, 0x00,
      0x00, 0x40,
      0x00, 0xc0,
      0xff, 0x7f,
    ]));
    const alacClose = vi.fn();
    const alacFormats: Array<{ sampleRate: number; bitDepth: number; channels: number; framesPerPacket: number }> = [];
    const service = new AirPlayReceiverSpikeService({
      audioSession: audio as never,
      airPlay2Experimental: true,
      createAirPlay2AlacDecoder: async (format) => {
        alacFormats.push(format);
        return {
          decodeFrame: alacDecodeFrame,
          close: alacClose,
        };
      },
      getAdvertiseInterfaces: () => [
        { name: 'Wi-Fi', address: '192.168.31.214', mac: '60:CF:84:CB:1E:D1' },
      ],
      createMdnsAdvertiser: () => ({
        start: vi.fn(async (advertisement) => {
          mdnsStarts.push({ airPlayPort: advertisement.airPlayPort });
        }),
        stop: vi.fn(async () => undefined),
      }),
      loadRaopModule: async () => ({
        startReceiver: vi.fn(() => 23),
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
    });

    await service.setEnabled(true);
    const airPlayPort = mdnsStarts[0]!.airPlayPort;
    expect(airPlayPort).toEqual(expect.any(Number));

    const socket = connect({ host: '127.0.0.1', port: airPlayPort! });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });

      const clientKeys = generateKeyPairSync('x25519');
      const clientPublicKey = exportX25519PublicKey(clientKeys.publicKey);
      socket.write(rawRequest('POST', '/pair-verify', encodeTlv([
        { type: 6, value: Buffer.from([1]) },
        { type: 3, value: clientPublicKey },
      ]), ['CSeq: 11']));
      const m2Response = await readUntil(socket, hasCompleteTextResponse);
      expect(m2Response.toString('utf8', 0, m2Response.indexOf('\r\n'))).toContain('RTSP/1.0 200');
      expect(m2Response.toString('utf8')).toContain('Server: AirTunes/366.0');
      expect(m2Response.toString('utf8')).toContain('CSeq: 11');
      const m2Fields = parseTlv(textResponseBody(m2Response));
      const serverPublicKey = tlvValue(m2Fields, 3);
      const sharedSecret = diffieHellman({
        privateKey: clientKeys.privateKey,
        publicKey: createX25519PublicKey(serverPublicKey),
      });
      const pairVerifyKey = derivePairVerifyKey(sharedSecret);
      decryptPairVerifyPayload(pairVerifyKey, 'PV-Msg02', tlvValue(m2Fields, 5));

      const encryptedM3 = encryptPairVerifyPayload(pairVerifyKey, 'PV-Msg03', encodeTlv([
        { type: 1, value: Buffer.from('rtsp-client', 'utf8') },
        { type: 10, value: Buffer.alloc(64, 9) },
      ]));
      socket.write(rawRequest('POST', '/pair-verify', encodeTlv([
        { type: 6, value: Buffer.from([3]) },
        { type: 5, value: encryptedM3 },
      ]), ['CSeq: 12']));
      const m4Response = await readUntil(socket, hasCompleteTextResponse);
      expect(m4Response.toString('utf8')).toContain('CSeq: 12');
      expect(tlvValue(parseTlv(textResponseBody(m4Response)), 6).readUInt8(0)).toBe(4);

      const controlWriteKey = deriveControlKey(sharedSecret, 'Control-Write-Encryption-Key');
      const controlReadKey = deriveControlKey(sharedSecret, 'Control-Read-Encryption-Key');
      let writeCounter = 0;
      let readCounter = 0;
      const sendEncryptedRequest = async (
        method: string,
        path: string,
        body: Uint8Array = Buffer.alloc(0),
        extraHeaders: string[] = [],
        contentType?: string | null,
      ): Promise<Buffer> => {
        socket.write(encryptControlFrame(controlWriteKey, writeCounter, rawRequest(
          method,
          path,
          body,
          extraHeaders,
          contentType,
        )));
        writeCounter += 1;
        const encrypted = await readUntil(socket, hasCompleteControlFrame);
        const response = decryptControlFrame(controlReadKey, readCounter, encrypted);
        readCounter += 1;
        return response;
      };
      socket.write(encryptControlFrame(controlWriteKey, writeCounter, rawRequest(
        'OPTIONS',
        '*',
        Buffer.alloc(0),
        ['CSeq: 13'],
      )));
      writeCounter += 1;
      const encryptedResponse = await readUntil(socket, hasCompleteControlFrame);
      const plaintextResponse = decryptControlFrame(controlReadKey, readCounter, encryptedResponse);
      readCounter += 1;

      expect(plaintextResponse.toString('utf8')).toContain('RTSP/1.0 200 OK');
      expect(plaintextResponse.toString('utf8')).toContain('Server: AirTunes/366.0');
      expect(plaintextResponse.toString('utf8')).toContain('CSeq: 13');
      expect(plaintextResponse.toString('utf8')).toContain('Public: ANNOUNCE, SETUP');

      socket.write(encryptControlFrame(controlWriteKey, writeCounter, rawRequest(
        'SETUP',
        `rtsp://127.0.0.1/${Date.now()}`,
        encodeTestBplist({
          deviceID: '60:CF:84:CB:1E:D1',
          ekey: Buffer.alloc(16, 1),
          eiv: Buffer.alloc(16, 2),
          et: 0,
          timingProtocol: 'NTP',
          name: 'Test iPhone',
          model: 'iPhone16,2',
          sourceVersion: '409.16',
          sessionUUID: '11111111-2222-4333-8444-555555555555',
        }),
        ['CSeq: 14'],
      )));
      writeCounter += 1;
      const encryptedSessionSetup = await readUntil(socket, hasCompleteControlFrame);
      const sessionSetupResponse = decryptControlFrame(controlReadKey, readCounter, encryptedSessionSetup);
      readCounter += 1;
      expect(sessionSetupResponse.toString('utf8')).toContain('RTSP/1.0 200 OK');
      expect(sessionSetupResponse.toString('utf8')).toContain('CSeq: 14');
      expect(sessionSetupResponse.toString('binary')).toContain('bplist00');
      expect(sessionSetupResponse.toString('binary')).toContain('eventPort');
      expect(sessionSetupResponse.toString('binary')).toContain('timingPort');
      const sessionSetupEvent = service.getStatus().debugEvents.find((event) =>
        event.action === 'setup' && event.message?.includes('session setup acknowledged'),
      );
      expect(sessionSetupEvent?.message).toContain('ekey=16b');
      expect(sessionSetupEvent?.message).toContain('eiv=16b');
      expect(sessionSetupEvent?.message).toContain('et=0');
      expect(sessionSetupEvent?.message).toContain('sender=Test iPhone');

      socket.write(encryptControlFrame(controlWriteKey, writeCounter, rawRequest(
        'GET',
        '/info',
        Buffer.alloc(0),
        ['CSeq: 15'],
      )));
      writeCounter += 1;
      const encryptedInitialInfo = await readUntil(socket, hasCompleteControlFrame);
      const initialInfoResponse = decryptControlFrame(controlReadKey, readCounter, encryptedInitialInfo);
      readCounter += 1;
      expect(initialInfoResponse.toString('utf8')).toContain('RTSP/1.0 200 OK');
      expect(initialInfoResponse.toString('utf8')).toContain('Content-Type: application/x-apple-binary-plist');
      expect(initialInfoResponse.toString('utf8')).toContain('CSeq: 15');
      expect(initialInfoResponse.toString('binary')).toContain('bplist00');
      expect(initialInfoResponse.toString('binary')).toContain('initialVolume');

      const setupSharedKey = Buffer.alloc(32, 7);
      socket.write(encryptControlFrame(controlWriteKey, writeCounter, rawRequest(
        'SETUP',
        `rtsp://127.0.0.1/${Date.now()}`,
        encodeTestBplist({
          streams: [
            {
              type: 96,
              ct: 2,
              audioFormat: 0x80000,
              spf: 352,
              shk: setupSharedKey,
            },
          ],
        }),
        ['CSeq: 16'],
      )));
      writeCounter += 1;
      const encryptedUnsupportedSetup = await readUntil(socket, hasCompleteControlFrame);
      const unsupportedSetupResponse = decryptControlFrame(controlReadKey, readCounter, encryptedUnsupportedSetup);
      readCounter += 1;
      expect(unsupportedSetupResponse.toString('utf8')).toContain('RTSP/1.0 501 Not Implemented');
      expect(unsupportedSetupResponse.toString('utf8')).toContain('CSeq: 16');
      const unsupportedSetupEvent = service.getStatus().debugEvents.find((event) =>
        event.action === 'setup' && event.message?.includes('supported path requires realtime LPCM'),
      );
      expect(unsupportedSetupEvent?.message).toContain('ct=2');
      expect(unsupportedSetupEvent?.message).toContain('audioFormat=524288');

      socket.write(encryptControlFrame(controlWriteKey, writeCounter, rawRequest(
        'SETUP',
        `rtsp://127.0.0.1/${Date.now()}`,
        encodeTestBplist({
          streams: [
            {
              type: 96,
              ct: 1,
              audioFormat: 0x800,
              spf: 352,
            },
          ],
        }),
        ['CSeq: 17'],
      )));
      writeCounter += 1;
      const encryptedMissingKeySetup = await readUntil(socket, hasCompleteControlFrame);
      const missingKeySetupResponse = decryptControlFrame(controlReadKey, readCounter, encryptedMissingKeySetup);
      readCounter += 1;
      expect(missingKeySetupResponse.toString('utf8')).toContain('RTSP/1.0 501 Not Implemented');
      expect(missingKeySetupResponse.toString('utf8')).toContain('CSeq: 17');
      const missingKeySetupEvent = service.getStatus().debugEvents.find((event) =>
        event.action === 'setup' && event.message?.includes('supported RTP path requires a 32-byte shared key'),
      );
      expect(missingKeySetupEvent?.message).toContain('shk=missing');

      socket.write(encryptControlFrame(controlWriteKey, writeCounter, rawRequest(
        'SETUP',
        `rtsp://127.0.0.1/${Date.now()}`,
        encodeTestBplist({
          streams: testBplistSet([
            {
              type: 96,
              ct: 1,
              audioFormat: 0x800,
              spf: 352,
              shk: setupSharedKey,
            },
          ]),
        }),
        ['CSeq: 18'],
      )));
      writeCounter += 1;
      const encryptedStreamSetup = await readUntil(socket, hasCompleteControlFrame);
      const streamSetupResponse = decryptControlFrame(controlReadKey, readCounter, encryptedStreamSetup);
      readCounter += 1;
      expect(streamSetupResponse.toString('utf8')).toContain('RTSP/1.0 200 OK');
      expect(streamSetupResponse.toString('utf8')).toContain('CSeq: 18');
      expect(streamSetupResponse.toString('binary')).toContain('streams');
      expect(streamSetupResponse.toString('binary')).toContain('controlPort');
      expect(streamSetupResponse.toString('binary')).toContain('dataPort');
      const streamSetupEvent = service.getStatus().debugEvents.find((event) =>
        event.action === 'setup' && event.message?.includes('dataPort='),
      );
      const dataPort = Number(streamSetupEvent?.message?.match(/dataPort=(\d+)/u)?.[1]);
      expect(dataPort).toBeGreaterThan(0);
      expect(streamSetupEvent?.message).toContain('ct=1');
      expect(streamSetupEvent?.message).toContain('audioFormat=2048');
      expect(streamSetupEvent?.message).toContain('spf=352');
      expect(streamSetupEvent?.message).toContain('shk=32b');
      expect(streamSetupEvent?.message).toContain('pcm=44100/16/2');

      socket.write(encryptControlFrame(controlWriteKey, writeCounter, rawRequest(
        'SETUP',
        `rtsp://127.0.0.1/${Date.now()}`,
        encodeTestBplist({
          streams: [
            {
              type: 103,
              ct: 2,
              audioFormat: 0x40000,
              spf: 352,
              shk: setupSharedKey,
            },
          ],
        }),
        ['CSeq: 19'],
      )));
      writeCounter += 1;
      const encryptedBufferedSetup = await readUntil(socket, hasCompleteControlFrame);
      const bufferedSetupResponse = decryptControlFrame(controlReadKey, readCounter, encryptedBufferedSetup);
      readCounter += 1;
      expect(bufferedSetupResponse.toString('utf8')).toContain('RTSP/1.0 501 Not Implemented');
      expect(bufferedSetupResponse.toString('utf8')).toContain('CSeq: 19');
      const bufferedSetupEvent = service.getStatus().debugEvents.find((event) =>
        event.action === 'setup' && event.message?.includes('supported path requires realtime stream type 96'),
      );
      expect(bufferedSetupEvent?.message).toContain('type=103');
      expect(alacFormats).toHaveLength(0);

      socket.write(encryptControlFrame(controlWriteKey, writeCounter, rawRequest(
        'RECORD',
        '*',
        Buffer.alloc(0),
        ['CSeq: 20'],
      )));
      writeCounter += 1;
      const encryptedRecord = await readUntil(socket, hasCompleteControlFrame);
      const recordResponse = decryptControlFrame(controlReadKey, readCounter, encryptedRecord);
      readCounter += 1;
      expect(recordResponse.toString('utf8')).toContain('RTSP/1.0 200 OK');
      expect(recordResponse.toString('utf8')).toContain('CSeq: 20');
      expect(recordResponse.toString('utf8')).toContain('Audio-Latency: 0');

      socket.write(encryptControlFrame(controlWriteKey, writeCounter, rawRequest(
        'SET_PARAMETER',
        '*',
        Buffer.from('volume: -6.020600\r\nprogress: 0/22050/88200\r\n', 'utf8'),
        ['CSeq: 21'],
        'text/parameters',
      )));
      writeCounter += 1;
      const encryptedSetParameter = await readUntil(socket, hasCompleteControlFrame);
      const setParameterResponse = decryptControlFrame(controlReadKey, readCounter, encryptedSetParameter);
      readCounter += 1;
      expect(setParameterResponse.toString('utf8')).toContain('RTSP/1.0 200 OK');
      expect(setParameterResponse.toString('utf8')).toContain('CSeq: 21');
      expect(audio.setOutput).toHaveBeenCalledWith({ volume: 0.5 });
      expect(service.getStatus()).toEqual(expect.objectContaining({
        volume: 50,
        positionSeconds: 0.5,
        durationSeconds: 2,
      }));

      socket.write(encryptControlFrame(controlWriteKey, writeCounter, rawRequest(
        'GET_PARAMETER',
        '*',
        Buffer.from('volume\r\nprogress\r\n', 'utf8'),
        ['CSeq: 22'],
        'text/parameters',
      )));
      writeCounter += 1;
      const encryptedGetParameter = await readUntil(socket, hasCompleteControlFrame);
      const getParameterResponse = decryptControlFrame(controlReadKey, readCounter, encryptedGetParameter);
      readCounter += 1;
      expect(getParameterResponse.toString('utf8')).toContain('RTSP/1.0 200 OK');
      expect(getParameterResponse.toString('utf8')).toContain('CSeq: 22');
      expect(getParameterResponse.toString('utf8')).toContain('Content-Type: text/parameters');
      expect(textResponseBody(getParameterResponse).toString('utf8')).toContain('volume: -6');
      expect(textResponseBody(getParameterResponse).toString('utf8')).toContain('progress: 0/22050/88200');

      socket.write(encryptControlFrame(controlWriteKey, writeCounter, rawRequest(
        'POST',
        '/audioMode',
        Buffer.alloc(0),
        ['CSeq: 23'],
      )));
      writeCounter += 1;
      const encryptedAudioMode = await readUntil(socket, hasCompleteControlFrame);
      const audioModeResponse = decryptControlFrame(controlReadKey, readCounter, encryptedAudioMode);
      readCounter += 1;
      expect(audioModeResponse.toString('utf8')).toContain('RTSP/1.0 200 OK');
      expect(audioModeResponse.toString('utf8')).toContain('CSeq: 23');

      const rtpHeader = Buffer.alloc(12);
      rtpHeader[0] = 0x80;
      rtpHeader[1] = 96;
      rtpHeader.writeUInt16BE(7, 2);
      rtpHeader.writeUInt32BE(123_456, 4);
      rtpHeader.writeUInt32BE(0x01020304, 8);
      const lpcmPayload = Buffer.from([
        0x00, 0x00,
        0x40, 0x00,
        0xc0, 0x00,
        0x7f, 0xff,
      ]);
      const rtpPacket = Buffer.concat([rtpHeader, encryptRtpPayload(setupSharedKey, rtpHeader, lpcmPayload)]);
      const udpSocket = createUdpSocket('udp4');
      try {
        await new Promise<void>((resolve, reject) => {
          udpSocket.send(rtpPacket, dataPort, '127.0.0.1', (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      } finally {
        udpSocket.close();
      }

      let rtpEvent: ReturnType<typeof service.getStatus>['debugEvents'][number] | undefined;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        rtpEvent = service.getStatus().debugEvents.find((event) =>
          event.action === 'rtp' && event.message?.includes('seq=7'),
        );
        if (rtpEvent) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(rtpEvent?.message).toContain('pt=96');
      expect(rtpEvent?.message).toContain('payload=32b');
      expect(rtpEvent?.message).toContain('decrypted=8b');
      expect(rtpEvent?.message).toContain('pcm=f32le');
      expect(audio.playPcmStream).toHaveBeenCalledTimes(1);
      const pcmRequest = audio.playPcmStream.mock.calls[0]?.[0];
      expect(pcmRequest).toEqual(expect.objectContaining({
        sourceId: expect.stringMatching(/^airplay-receiver:/u),
        trackId: expect.stringMatching(/^airplay-receiver:/u),
        sampleRate: 44_100,
        channels: 2,
      }));
      const pcmChunk = pcmRequest?.stream.read() as Buffer | null;
      expect(pcmChunk).toHaveLength(16);
      expect(pcmChunk?.readFloatLE(0)).toBeCloseTo(0, 5);
      expect(pcmChunk?.readFloatLE(4)).toBeCloseTo(0.5, 5);
      expect(pcmChunk?.readFloatLE(8)).toBeCloseTo(-0.5, 5);
      expect(pcmChunk?.readFloatLE(12)).toBeCloseTo(32767 / 32768, 5);

      socket.write(encryptControlFrame(controlWriteKey, writeCounter, rawRequest(
        'SETUP',
        `rtsp://127.0.0.1/${Date.now()}`,
        encodeTestBplist({
          streams: [
            {
              type: 96,
              ct: 2,
              audioFormat: 0x40000,
              spf: 352,
              shk: setupSharedKey,
            },
          ],
        }),
        ['CSeq: 24'],
      )));
      writeCounter += 1;
      const encryptedAlacSetup = await readUntil(socket, hasCompleteControlFrame);
      const alacSetupResponse = decryptControlFrame(controlReadKey, readCounter, encryptedAlacSetup);
      readCounter += 1;
      expect(alacSetupResponse.toString('utf8')).toContain('RTSP/1.0 200 OK');
      expect(alacSetupResponse.toString('utf8')).toContain('CSeq: 24');
      expect(alacFormats).toEqual([{
        audioFormat: 0x40000,
        sampleRate: 44_100,
        bitDepth: 16,
        channels: 2,
        framesPerPacket: 352,
      }]);
      const alacSetupEvent = [...service.getStatus().debugEvents].reverse().find((event) =>
        event.action === 'setup' && event.message?.includes('encrypted ALAC RTP ready'),
      );
      const alacDataPort = Number(alacSetupEvent?.message?.match(/dataPort=(\d+)/u)?.[1]);
      expect(alacDataPort).toBeGreaterThan(0);
      expect(alacSetupEvent?.message).toContain('ct=2');
      expect(alacSetupEvent?.message).toContain('audioFormat=262144');
      expect(alacSetupEvent?.message).toContain('alac=44100/16/2');

      const alacRtpHeader = Buffer.alloc(12);
      alacRtpHeader[0] = 0x80;
      alacRtpHeader[1] = 96;
      alacRtpHeader.writeUInt16BE(8, 2);
      alacRtpHeader.writeUInt32BE(124_000, 4);
      alacRtpHeader.writeUInt32BE(0x01020304, 8);
      const alacPayload = Buffer.from('alac-frame');
      const alacRtpPacket = Buffer.concat([alacRtpHeader, encryptRtpPayload(setupSharedKey, alacRtpHeader, alacPayload)]);
      const alacUdpSocket = createUdpSocket('udp4');
      try {
        await new Promise<void>((resolve, reject) => {
          alacUdpSocket.send(alacRtpPacket, alacDataPort, '127.0.0.1', (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      } finally {
        alacUdpSocket.close();
      }

      let alacRtpEvent: ReturnType<typeof service.getStatus>['debugEvents'][number] | undefined;
      let alacPcmChunk: Buffer | null = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        alacRtpEvent = service.getStatus().debugEvents.find((event) =>
          event.action === 'rtp' && event.message?.includes('seq=8'),
        );
        alacPcmChunk = pcmRequest?.stream.read() as Buffer | null;
        if (alacRtpEvent && alacPcmChunk) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(alacDecodeFrame).toHaveBeenCalledWith(alacPayload);
      expect(alacRtpEvent?.message).toContain('alacPcm=8b');
      expect(alacRtpEvent?.message).toContain('decodedPackets=1');
      expect(alacPcmChunk).toHaveLength(16);
      expect(alacPcmChunk?.readFloatLE(0)).toBeCloseTo(0, 5);
      expect(alacPcmChunk?.readFloatLE(4)).toBeCloseTo(0.5, 5);
      expect(alacPcmChunk?.readFloatLE(8)).toBeCloseTo(-0.5, 5);
      expect(alacPcmChunk?.readFloatLE(12)).toBeCloseTo(32767 / 32768, 5);

      const pauseTeardownResponse = await sendEncryptedRequest(
        'TEARDOWN',
        '*',
        encodeTestBplist({ streams: [{ type: 96 }] }),
        ['CSeq: 25'],
        'application/x-apple-binary-plist',
      );
      expect(pauseTeardownResponse.toString('utf8')).toContain('RTSP/1.0 200 OK');
      expect(pauseTeardownResponse.toString('utf8')).toContain('CSeq: 25');
      expect(audio.pause).toHaveBeenCalledTimes(1);
      expect(alacClose).not.toHaveBeenCalled();
      expect(service.getStatus()).toEqual(expect.objectContaining({
        state: 'paused',
      }));
      expect(service.getStatus().debugEvents.some((event) =>
        event.action === 'teardown' && event.message?.includes('stream ports retained'),
      )).toBe(true);

      const resumeRecordResponse = await sendEncryptedRequest('RECORD', '*', Buffer.alloc(0), ['CSeq: 26']);
      expect(resumeRecordResponse.toString('utf8')).toContain('RTSP/1.0 200 OK');
      expect(resumeRecordResponse.toString('utf8')).toContain('CSeq: 26');

      const resumeFlushResponse = await sendEncryptedRequest('FLUSH', '*', Buffer.alloc(0), [
        'CSeq: 27',
        'RTP-Info: seq=9;rtptime=124352',
      ]);
      expect(resumeFlushResponse.toString('utf8')).toContain('RTSP/1.0 200 OK');
      expect(resumeFlushResponse.toString('utf8')).toContain('CSeq: 27');

      const resumedRtpHeader = Buffer.alloc(12);
      resumedRtpHeader[0] = 0x80;
      resumedRtpHeader[1] = 96;
      resumedRtpHeader.writeUInt16BE(9, 2);
      resumedRtpHeader.writeUInt32BE(124_352, 4);
      resumedRtpHeader.writeUInt32BE(0x01020304, 8);
      const resumedAlacPacket = Buffer.concat([
        resumedRtpHeader,
        encryptRtpPayload(setupSharedKey, resumedRtpHeader, Buffer.from('alac-resume')),
      ]);
      const resumedUdpSocket = createUdpSocket('udp4');
      try {
        await new Promise<void>((resolve, reject) => {
          resumedUdpSocket.send(resumedAlacPacket, alacDataPort, '127.0.0.1', (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      } finally {
        resumedUdpSocket.close();
      }

      let resumedPcmChunk: Buffer | null = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const resumedPcmRequest = audio.playPcmStream.mock.calls[1]?.[0];
        resumedPcmChunk = resumedPcmRequest?.stream.read() as Buffer | null;
        if (resumedPcmChunk) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(alacDecodeFrame).toHaveBeenLastCalledWith(Buffer.from('alac-resume'));
      expect(audio.playPcmStream).toHaveBeenCalledTimes(2);
      expect(resumedPcmChunk).toHaveLength(16);

      const disconnectTeardownResponse = await sendEncryptedRequest('TEARDOWN', '*', Buffer.alloc(0), ['CSeq: 28']);
      expect(disconnectTeardownResponse.toString('utf8')).toContain('RTSP/1.0 200 OK');
      expect(disconnectTeardownResponse.toString('utf8')).toContain('CSeq: 28');
      expect(audio.stop).toHaveBeenCalledTimes(1);
      expect(alacClose).toHaveBeenCalledTimes(1);
      expect(service.getStatus()).toEqual(expect.objectContaining({
        state: 'idle',
        currentSourceId: null,
      }));
      expect(service.getStatus().debugEvents.some((event) =>
        event.action === 'options' && event.method === 'OPTIONS',
      )).toBe(true);
      expect(service.getStatus().debugEvents.some((event) =>
        event.action === 'setup' && event.message?.includes('dataPort='),
      )).toBe(true);
    } finally {
      socket.destroy();
      await service.setEnabled(false);
      if (previousFallback === undefined) {
        Reflect.deleteProperty(process.env, 'ECHO_FORCE_AIRPLAY2_CHACHA_FALLBACK');
      } else {
        process.env.ECHO_FORCE_AIRPLAY2_CHACHA_FALLBACK = previousFallback;
      }
    }
  });

  it('does not leave AirPlay startup pending when mDNS advertisement hangs', async () => {
    const stopAdvertiser = vi.fn(async () => undefined);
    const service = new AirPlayReceiverSpikeService({
      audioSession: new FakeAudioSession() as never,
      startupTimeoutMs: 5,
      getAdvertiseInterfaces: () => [
        { name: 'Wi-Fi', address: '192.168.31.214', mac: '60:CF:84:CB:1E:D1' },
      ],
      createMdnsAdvertiser: () => ({
        start: vi.fn(() => new Promise<void>(() => undefined)),
        stop: stopAdvertiser,
      }),
      loadRaopModule: async () => ({
        startReceiver: vi.fn(() => 23),
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
    });

    const status = await service.setEnabled(true);

    expect(status.enabled).toBe(true);
    expect(status.nativeAvailable).toBe(true);
    expect(status.error).toContain('AirPlay discovery unavailable');
    expect(status.debugEvents.some((event) => event.action === 'mdns' && event.message?.includes('timed out'))).toBe(true);
    expect(stopAdvertiser).toHaveBeenCalledWith(false);
  });

  it('surfaces unsupported modern AirPlay POST attempts from native logs', async () => {
    const logHandlers: Array<(event: unknown) => void> = [];
    const service = new AirPlayReceiverSpikeService({
      audioSession: new FakeAudioSession() as never,
      getAdvertiseInterfaces: () => [
        { name: 'Wi-Fi', address: '192.168.31.214', mac: '60:CF:84:CB:1E:D1' },
      ],
      createMdnsAdvertiser: () => ({
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      }),
      loadRaopModule: async () => ({
        startReceiver: vi.fn(() => 23),
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
        setLogHandler: vi.fn((handler) => {
          logHandlers.push(handler);
        }),
      }),
    });

    await service.setEnabled(true);
    logHandlers[0]?.({ source: 'raop', level: 'info', line: 'handle_rtsp:591 unknown/unhandled method POST' });

    const status = service.getStatus();
    expect(status.state).toBe('error');
    expect(status.error).toContain('unsupported AirPlay RTSP POST');
  });

  it('does not label non-POST RTSP 501 responses as unsupported POST flow', async () => {
    const logHandlers: Array<(event: unknown) => void> = [];
    const service = new AirPlayReceiverSpikeService({
      audioSession: new FakeAudioSession() as never,
      getAdvertiseInterfaces: () => [
        { name: 'Wi-Fi', address: '192.168.31.214', mac: '60:CF:84:CB:1E:D1' },
      ],
      createMdnsAdvertiser: () => ({
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      }),
      loadRaopModule: async () => ({
        startReceiver: vi.fn(() => 23),
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
        setLogHandler: vi.fn((handler) => {
          logHandlers.push(handler);
        }),
      }),
    });

    await service.setEnabled(true);
    logHandlers[0]?.({ source: 'raop', level: 'info', line: 'handle_rtsp:625 responding: RTSP/1.0 501 Not Implemented' });

    const status = service.getStatus();
    expect(status.state).toBe('idle');
    expect(status.error).toBeNull();
  });

  it('maps RAOP metadata artwork and PCM events into an AirPlay playback session', async () => {
    const audio = new FakeAudioSession();
    const harness: { handler?: (event: Record<string, unknown>) => void } = {};
    const stopReceiver = vi.fn();
    const service = new AirPlayReceiverSpikeService({
      audioSession: audio as never,
      loadRaopModule: async () => ({
        startReceiver: (_options, nextHandler) => {
          harness.handler = nextHandler;
          return 7;
        },
        stopReceiver,
        sendRemoteCommand: vi.fn(() => true),
      }),
      now: () => 1_000,
    });

    await service.setEnabled(true);
    harness.handler?.({ type: 'stream', remoteAddress: '192.168.1.50' });
    harness.handler?.({ type: 'metadata', title: 'Air Song', artist: 'Singer', album: 'Album', durationMs: 180_000 });
    harness.handler?.({ type: 'artwork', data: Buffer.from([1, 2, 3]), mimeType: 'image/png' });
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(32767, 0);
    pcm.writeInt16LE(-32768, 2);
    harness.handler?.({ type: 'pcm', data: pcm, sampleRate: 44100, channels: 2 });
    await Promise.resolve();

    const status = service.getStatus();
    expect(audio.playPcmStream).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: expect.stringMatching(/^airplay-receiver:/u),
      sampleRate: 44100,
      channels: 2,
      output: expect.objectContaining({
        outputMode: 'shared',
        sharedBackend: 'auto',
        requestedOutputSampleRate: 48000,
        latencyProfile: 'stable',
        bufferSizeFrames: 8192,
        useJuceDecode: false,
        dsdOutputMode: 'pcm',
        asioNativeDsdExperimentalEnabled: false,
        releaseExclusiveOnPauseExperimentalEnabled: false,
      }),
    }));
    expect(status.state).toBe('playing');
    expect(status.currentClient?.address).toBe('192.168.1.50');
    expect(status.metadata?.title).toBe('Air Song');
    expect(status.metadata?.artist).toBe('Singer');
    expect(status.metadata?.coverHttpUrl).toMatch(/^data:image\/png;base64,/u);
  });

  it('waits for direct AirPlay PCM before starting audio playback by default', async () => {
    const audio = new FakeAudioSession();
    const harness: { handler?: (event: Record<string, unknown>) => void } = {};
    const service = new AirPlayReceiverSpikeService({
      audioSession: audio as never,
      loadRaopModule: async () => ({
        startReceiver: (_options, nextHandler) => {
          harness.handler = nextHandler;
          return 19;
        },
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
      now: () => 1_000,
    });

    await service.setEnabled(true);
    harness.handler?.({ type: 'stream', port: 9, remoteAddress: '192.168.1.51' });
    await Promise.resolve();

    expect(audio.playPcmStream).not.toHaveBeenCalled();
    expect(service.getStatus().state).toBe('ready');
    expect(service.getStatus().debugEvents.some((event) => event.action === 'stream' && event.message === 'using direct PCM events')).toBe(true);
  });

  it('falls back to direct PCM events when AirPlay HTTP PCM has not produced audio', async () => {
    const audio = new FakeAudioSession();
    const harness: { handler?: (event: Record<string, unknown>) => void } = {};
    const service = new AirPlayReceiverSpikeService({
      audioSession: audio as never,
      loadRaopModule: async () => ({
        startReceiver: (_options, nextHandler) => {
          harness.handler = nextHandler;
          return 13;
        },
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
      useHttpPcmBridge: true,
      now: () => 1_000,
    });

    await service.setEnabled(true);
    harness.handler?.({ type: 'stream', port: 9, remoteAddress: '192.168.1.51' });
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(32767, 0);
    pcm.writeInt16LE(-32768, 2);
    harness.handler?.({ type: 'pcm', data: pcm, sampleRate: 48000, channels: 2 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(audio.playPcmStream).toHaveBeenCalledTimes(2);
    expect(audio.playPcmStream).toHaveBeenLastCalledWith(expect.objectContaining({
      sourceId: expect.stringMatching(/^airplay-receiver:/u),
      sampleRate: 48000,
      channels: 2,
    }));
    expect(service.getStatus().state).toBe('playing');
  });

  it('sends AirPlay remote commands for computer transport controls', async () => {
    const audio = new FakeAudioSession();
    const harness: { handler?: (event: Record<string, unknown>) => void } = {};
    const sendRemoteCommand = vi.fn(() => true);
    const service = new AirPlayReceiverSpikeService({
      audioSession: audio as never,
      loadRaopModule: async () => ({
        startReceiver: (_options, nextHandler) => {
          harness.handler = nextHandler;
          return 15;
        },
        stopReceiver: vi.fn(),
        sendRemoteCommand,
      }),
      now: () => 1_000,
    });

    await service.setEnabled(true);
    harness.handler?.({ type: 'stream', remoteAddress: '192.168.1.50' });
    harness.handler?.({ type: 'pcm', data: Buffer.from([0, 0]), sampleRate: 44100, channels: 2 });
    await Promise.resolve();

    const sourceId = service.getStatus().currentSourceId;
    expect(service.isCurrentSource(sourceId)).toBe(true);
    expect(service.isCurrentSource('local.flac')).toBe(false);

    await service.pausePlayback();
    expect(sendRemoteCommand).toHaveBeenCalledWith(15, 'pause');
    expect(audio.pause).not.toHaveBeenCalled();
    expect(service.getStatus().state).toBe('paused');

    await service.playPlayback();
    expect(sendRemoteCommand).toHaveBeenCalledWith(15, 'play');
    expect(service.getStatus().state).toBe('playing');
  });

  it('maps AirPlay dB volume events without muting normal playback', async () => {
    const audio = new FakeAudioSession();
    const harness: { handler?: (event: Record<string, unknown>) => void } = {};
    const service = new AirPlayReceiverSpikeService({
      audioSession: audio as never,
      loadRaopModule: async () => ({
        startReceiver: (_options, nextHandler) => {
          harness.handler = nextHandler;
          return 19;
        },
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
    });

    await service.setEnabled(true);
    harness.handler?.({ type: 'volume', value: -20 });
    await Promise.resolve();

    expect(audio.setOutput).toHaveBeenCalledWith({ volume: 0.1 });
    expect(service.getStatus().volume).toBe(10);
  });

  it('does not fake AirPlay seek state when the native backend cannot seek the sender', async () => {
    const audio = new FakeAudioSession();
    const harness: { handler?: (event: Record<string, unknown>) => void } = {};
    const service = new AirPlayReceiverSpikeService({
      audioSession: audio as never,
      loadRaopModule: async () => ({
        startReceiver: (_options, nextHandler) => {
          harness.handler = nextHandler;
          return 16;
        },
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
      now: () => 1_000,
    });

    await service.setEnabled(true);
    harness.handler?.({ type: 'stream', remoteAddress: '192.168.1.50' });
    harness.handler?.({ type: 'metadata', title: 'Air Song', artist: 'Singer', durationMs: 180_000 });
    harness.handler?.({ type: 'pcm', data: Buffer.from([0, 0]), sampleRate: 44100, channels: 2 });
    await Promise.resolve();

    const status = await service.seekPlayback(42);

    expect(status.positionSeconds).toBe(0);
    expect(audio.status.positionSeconds).toBe(0);
  });

  it('resets the AirPlay song clock when metadata switches to a new track', async () => {
    const audio = new FakeAudioSession();
    const harness: { handler?: (event: Record<string, unknown>) => void } = {};
    const service = new AirPlayReceiverSpikeService({
      audioSession: audio as never,
      loadRaopModule: async () => ({
        startReceiver: (_options, nextHandler) => {
          harness.handler = nextHandler;
          return 17;
        },
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
      now: () => 1_000,
    });

    await service.setEnabled(true);
    harness.handler?.({ type: 'stream', remoteAddress: '192.168.1.50' });
    harness.handler?.({ type: 'metadata', title: 'First Song', artist: 'Singer', durationMs: 180_000, elapsedMs: 30_000 });
    expect(service.getStatus().positionSeconds).toBe(30);

    harness.handler?.({ type: 'metadata', title: 'Second Song', artist: 'Singer', durationMs: 200_000 });

    const status = service.getStatus();
    expect(status.metadata?.title).toBe('Second Song');
    expect(status.positionSeconds).toBe(0);
    expect(status.durationSeconds).toBe(200);
  });

  it('keeps an active AirPlay PCM HTTP stream alive across flush events', async () => {
    const service = new AirPlayReceiverSpikeService({
      audioSession: new FakeAudioSession() as never,
      loadRaopModule: async () => ({
        startReceiver: vi.fn(() => 18),
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
    });
    const internals = service as unknown as {
      currentSourceId: string;
      httpPcmRequest: { destroy: () => void };
      httpPcmTransform: { destroy: () => void };
      httpPcmBytesReceived: number;
      handleRaopEvent: (event: Record<string, unknown>) => void;
    };

    await service.setEnabled(true);
    internals.currentSourceId = 'airplay-receiver:active';
    internals.httpPcmRequest = { destroy: vi.fn() };
    internals.httpPcmTransform = { destroy: vi.fn() };
    internals.httpPcmBytesReceived = 4;

    internals.handleRaopEvent({ type: 'flush' });

    expect(internals.httpPcmRequest.destroy).not.toHaveBeenCalled();
    expect(internals.httpPcmTransform.destroy).not.toHaveBeenCalled();
    expect(service.getStatus().state).toBe('paused');
    expect(service.getStatus().debugEvents.some((event) => event.action === 'stream' && event.message === 'keep PCM HTTP alive after flush')).toBe(true);
  });

  it('uses album metadata when AirPlay sends a generic instrumental title', async () => {
    const audio = new FakeAudioSession();
    const harness: { handler?: (event: Record<string, unknown>) => void } = {};
    const service = new AirPlayReceiverSpikeService({
      audioSession: audio as never,
      loadRaopModule: async () => ({
        startReceiver: (_options, nextHandler) => {
          harness.handler = nextHandler;
          return 11;
        },
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
      now: () => 1_000,
    });

    await service.setEnabled(true);
    harness.handler?.({
      type: 'metadata',
      title: '纯音乐，请欣赏',
      artist: 'lapix/Flamenco House',
      album: 'Flamenco House',
      durationMs: 144_000,
    });

    const status = service.getStatus();
    expect(status.metadata?.title).toBe('Flamenco House');
    expect(status.metadata?.artist).toBe('lapix');
    expect(status.metadata?.album).toBe('Flamenco House');
    expect(status.metadata?.durationSeconds).toBe(144);
  });

  it('uses album metadata when AirPlay sends a lyric line as title', async () => {
    const audio = new FakeAudioSession();
    const harness: { handler?: (event: Record<string, unknown>) => void } = {};
    const service = new AirPlayReceiverSpikeService({
      audioSession: audio as never,
      loadRaopModule: async () => ({
        startReceiver: (_options, nextHandler) => {
          harness.handler = nextHandler;
          return 12;
        },
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
      now: () => 1_000,
    });

    await service.setEnabled(true);
    harness.handler?.({
      type: 'metadata',
      title: "And I know, I'm not alone",
      artist: 'Porter Robinson/Madeon/Shelter (シェルター)',
      album: 'Shelter',
      durationMs: 219_000,
    });

    const status = service.getStatus();
    expect(status.metadata?.title).toBe('Shelter');
    expect(status.metadata?.artist).toBe('Porter Robinson / Madeon');
    expect(status.metadata?.album).toBe('Shelter');
  });

  it('keeps stable song metadata when AirPlay sends lyric lines as title updates', async () => {
    const audio = new FakeAudioSession();
    const harness: { handler?: (event: Record<string, unknown>) => void } = {};
    const service = new AirPlayReceiverSpikeService({
      audioSession: audio as never,
      loadRaopModule: async () => ({
        startReceiver: (_options, nextHandler) => {
          harness.handler = nextHandler;
          return 14;
        },
        stopReceiver: vi.fn(),
        sendRemoteCommand: vi.fn(() => true),
      }),
      now: () => 1_000,
    });

    await service.setEnabled(true);
    harness.handler?.({
      type: 'metadata',
      title: 'Shelter',
      artist: 'Porter Robinson / Madeon',
      album: 'Shelter',
      durationMs: 219_000,
    });
    harness.handler?.({
      type: 'metadata',
      title: "And I know, I'm not alone",
      artist: 'Porter Robinson / Madeon',
      album: 'Shelter',
      durationMs: 219_000,
      elapsedMs: 30_000,
    });

    const status = service.getStatus();
    expect(status.metadata?.title).toBe('Shelter');
    expect(status.metadata?.artist).toBe('Porter Robinson / Madeon');
    expect(status.currentLyricLine).toBe("And I know, I'm not alone");
    expect(status.positionSeconds).toBe(30);
  });

  it('lets an incoming AirPlay stream preempt stale local playback status', async () => {
    const audio = new FakeAudioSession();
    audio.status = audioStatus({ state: 'playing', currentFilePath: 'local.flac', currentTrackId: 'local-track' });
    const harness: { handler?: (event: Record<string, unknown>) => void } = {};
    const sendRemoteCommand = vi.fn(() => true);
    const service = new AirPlayReceiverSpikeService({
      audioSession: audio as never,
      loadRaopModule: async () => ({
        startReceiver: (_options, nextHandler) => {
          harness.handler = nextHandler;
          return 10;
        },
        stopReceiver: vi.fn(),
        sendRemoteCommand,
      }),
      now: () => 1_000,
    });

    await service.setEnabled(true);
    harness.handler?.({ type: 'stream', remoteAddress: '192.168.1.50' });
    audio.emit('status', audio.status);
    harness.handler?.({ type: 'pcm', data: Buffer.from([0, 0]), sampleRate: 44100, channels: 2 });
    await Promise.resolve();

    expect(sendRemoteCommand).not.toHaveBeenCalledWith(10, 'stop');
    expect(audio.playPcmStream).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: expect.stringMatching(/^airplay-receiver:/u) }),
    );
    expect(service.getStatus().state).toBe('playing');
  });

  it('releases the AirPlay session when local playback takes over', async () => {
    const audio = new FakeAudioSession();
    const harness: { handler?: (event: Record<string, unknown>) => void } = {};
    const sendRemoteCommand = vi.fn(() => true);
    const service = new AirPlayReceiverSpikeService({
      audioSession: audio as never,
      loadRaopModule: async () => ({
        startReceiver: (_options, nextHandler) => {
          harness.handler = nextHandler;
          return 8;
        },
        stopReceiver: vi.fn(),
        sendRemoteCommand,
      }),
    });

    await service.setEnabled(true);
    harness.handler?.({ type: 'stream', remoteAddress: '192.168.1.50' });
    harness.handler?.({ type: 'metadata', title: 'Air Song', artist: 'Singer' });
    harness.handler?.({ type: 'pcm', data: Buffer.from([0, 0]), sampleRate: 44100, channels: 2 });
    await Promise.resolve();
    audio.status = audioStatus({ state: 'loading', currentFilePath: 'local.flac' });
    audio.emit('status', audio.status);
    harness.handler?.({ type: 'pcm', data: Buffer.from([0, 0]), sampleRate: 44100, channels: 2 });

    const status = service.getStatus();
    expect(sendRemoteCommand).toHaveBeenCalledWith(8, 'stop');
    expect(audio.playPcmStream).toHaveBeenCalledTimes(1);
    expect(status.state).toBe('idle');
    expect(status.metadata).toBeNull();
    expect(status.currentSourceId).toBeNull();
  });

  it('does not stop local audio when disabling an idle AirPlay receiver', async () => {
    const audio = new FakeAudioSession();
    audio.status = audioStatus({ state: 'playing', currentFilePath: 'local.flac', currentTrackId: 'local-track' });
    const stopReceiver = vi.fn();
    const service = new AirPlayReceiverSpikeService({
      audioSession: audio as never,
      loadRaopModule: async () => ({
        startReceiver: () => 9,
        stopReceiver,
        sendRemoteCommand: vi.fn(() => true),
      }),
    });

    await service.setEnabled(true);
    await service.setEnabled(false);

    expect(stopReceiver).toHaveBeenCalledWith(9);
    expect(audio.stop).not.toHaveBeenCalled();
    expect(audio.status.currentFilePath).toBe('local.flac');
  });
});
