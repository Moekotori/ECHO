import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  getCiphers,
  hkdfSync,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject,
} from 'node:crypto';
import { createSocket, type RemoteInfo, type Socket as UdpSocket } from 'node:dgram';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type ClientRequest } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import readline from 'node:readline';
import { PassThrough, Transform } from 'node:stream';
import { app } from 'electron';
import type { AudioOutputSettings, AudioStatus } from '../../shared/types/audio';
import type { AirPlayReceiverStatus, ConnectMetadata, ConnectReceiverClient, ConnectReceiverDebugEvent } from '../../shared/types/connect';
import { getAudioSession } from '../audio/AudioSession';
import { AirPlayMdnsAdvertiser, airPlay2FeatureMask, createAirPlay2PairingUuid } from './AirPlayMdnsAdvertiser';

type RaopEvent = Record<string, unknown> & {
  type?: string;
  data?: Buffer;
  sampleRate?: number;
  channels?: number;
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  elapsedMs?: number;
  value?: number;
  remoteAddress?: string;
  address?: string;
  host?: string;
  mimeType?: string;
  contentType?: string;
};

type RaopReceiverOptions = {
  name: string;
  model: string;
  host?: string;
  mac?: string;
  latencies: string;
  metadata: boolean;
  portBase: number;
  portRange: number;
};

type RaopModule = {
  checkAvailable?: () => void | Promise<void>;
  startReceiver: (options: RaopReceiverOptions, handler: (event: RaopEvent) => void) => number | Promise<number>;
  stopReceiver: (handle: number) => void | Promise<void>;
  sendRemoteCommand?: (handle: number, command: 'play' | 'pause' | 'stop' | 'next' | 'prev' | 'previous') => boolean | Promise<boolean>;
  setPcmForwarding?: (enabled: boolean) => boolean | Promise<boolean>;
  setLogHandler?: (handler: ((event: unknown) => void) | null, level?: string, raopLevel?: string, utilLevel?: string) => void;
};

type AirPlayAudioSession = {
  getStatus: () => AudioStatus;
  playPcmStream: (request: {
    stream: PassThrough;
    sourceId: string;
    trackId?: string | null;
    sampleRate: number;
    channels: number;
    durationSeconds?: number;
    output?: AudioOutputSettings;
  }) => Promise<AudioStatus>;
  pause: () => Promise<AudioStatus> | AudioStatus;
  stop: () => Promise<AudioStatus> | AudioStatus;
  setOutput: (settings: { volume: number }) => Promise<AudioStatus> | AudioStatus;
  on: (event: 'status', listener: (status: AudioStatus) => void) => AirPlayAudioSession;
  off?: (event: 'status', listener: (status: AudioStatus) => void) => AirPlayAudioSession;
};

type AirPlayReceiverEvents = {
  status: [AirPlayReceiverStatus];
};

type AirPlayReceiverDependencies = {
  audioSession?: AirPlayAudioSession;
  advertisedName?: string;
  loadRaopModule?: () => Promise<RaopModule>;
  createAirPlay2AlacDecoder?: AirPlay2AlacDecoderFactory;
  getAdvertiseInterfaces?: () => AirPlayAdvertiseInterface[];
  createMdnsAdvertiser?: () => AirPlayMdnsAdvertiserLike;
  useHttpPcmBridge?: boolean;
  airPlay2Experimental?: boolean;
  startupTimeoutMs?: number;
  now?: () => number;
};

type AirPlayHelperRuntimeOptions = {
  isPackaged: boolean;
  processExecPath: string;
  npmNodeExecPath?: string | null;
  nodeEnvPath?: string | null;
};

type AirPlay2Identity = {
  publicKey: Buffer;
  privateKey: KeyObject;
};

type AirPlay2PairVerifyState = {
  clientPublicKey: Buffer;
  serverPublicKey: Buffer;
  sessionKey: Buffer;
  controlReadKey: Buffer;
  controlWriteKey: Buffer;
};

type AirPlay2EncryptedControlState = Pick<AirPlay2PairVerifyState, 'controlReadKey' | 'controlWriteKey'> & {
  keyLabel: string;
};

type AirPlay2PairSetupState = {
  salt: Buffer;
  privateKey: bigint;
  publicKey: Buffer;
  verifier: bigint;
  sessionKey: Buffer | null;
  transient: boolean;
};

type AirPlay2FairPlayState = {
  keyMessage: Buffer | null;
};

type AirPlay2SessionSetupInfo = {
  encryptionKey: Buffer | null;
  encryptionIv: Buffer | null;
  encryptionType: number | null;
  timingProtocol: string | null;
  senderName: string | null;
  senderModel: string | null;
  sourceVersion: string | null;
  sessionUuid: string | null;
};

type AirPlay2ControlCipherState = {
  readCounter: number;
  writeCounter: number;
  readCounterOffset: number;
  writeCounterOffset: number;
};

type AirPlay2TlvField = {
  type: number;
  value: Buffer;
};

type AirPlay2ProbeRequest = {
  method: string;
  path: string;
  protocol: string;
  headers: Record<string, string>;
  body: Buffer;
};

type AirPlay2ProbeResponse = {
  statusCode: number;
  headers?: Record<string, string | number>;
  body?: Buffer | string;
  encryptedAfterWrite?: boolean;
};

type AirPlay2TcpConnection = {
  buffer: Buffer;
  plaintextBuffer: Buffer;
  encrypted: boolean;
  draining: boolean;
  cipher: AirPlay2ControlCipherState;
  lastFrameSummary: string | null;
};

type AirPlay2UdpListener = {
  kind: 'data' | 'control';
  socket: UdpSocket;
  port: number;
};

type AirPlay2RtpPacket = {
  version: number;
  payloadType: number;
  marker: boolean;
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
  headerLength: number;
  aad: Buffer;
  payload: Buffer;
};

type AirPlay2SetupStreamInfo = {
  type: number | null;
  compressionType: number | null;
  audioFormat: number | null;
  framesPerPacket: number | null;
  sharedKey: Buffer | null;
};

type AirPlay2PcmFormat = {
  audioFormat: number;
  sampleRate: number;
  bitDepth: 16 | 24;
  channels: number;
};

type AirPlay2AlacFormat = {
  audioFormat: number;
  sampleRate: number;
  bitDepth: 16;
  channels: 2;
  framesPerPacket: number;
};

type AirPlay2AlacDecoder = {
  decodeFrame: (frame: Buffer) => Buffer;
  close: () => void;
};

type AirPlay2AlacDecoderFactory = (format: AirPlay2AlacFormat) => Promise<AirPlay2AlacDecoder>;

type AirPlay2StreamState = {
  dataPort: number;
  controlPort: number;
  streamType: number | null;
  compressionType: number | null;
  audioFormat: number | null;
  framesPerPacket: number | null;
  sharedKey: Buffer | null;
  pcmFormat: AirPlay2PcmFormat | null;
  alacFormat: AirPlay2AlacFormat | null;
  alacDecoder: AirPlay2AlacDecoder | null;
  packetCount: number;
  byteCount: number;
  decryptedPacketCount: number;
  decodedPacketCount: number;
  decryptFailureCount: number;
  firstPacketAt: number | null;
  lastSequenceNumber: number | null;
  lastTimestamp: number | null;
};

type AirPlay2BplistValue =
  | null
  | boolean
  | number
  | string
  | Buffer
  | AirPlay2BplistValue[]
  | { [key: string]: AirPlay2BplistValue };

type AirPlay2BplistObjectRecord = {
  value: AirPlay2BplistValue;
  arrayRefs?: number[];
  dictKeyRefs?: number[];
  dictValueRefs?: number[];
};

const defaultAdvertisedName = (): string =>
  process.env.ELECTRON_RENDERER_URL ? 'ECHO Next Dev (AirPlay)' : 'ECHO Next (AirPlay)';
const defaultTitle = 'AirPlay stream';
const unknownArtist = 'Unknown Artist';
const debugEventLimit = 24;
const defaultSampleRate = 44_100;
const defaultChannels = 2;
const airPlayModel = 'ECHO-Next-AirPlay-Spike';
const airPlayPcmHighWaterMark = 4 * 1024 * 1024;
const airPlayOutputSampleRate = 48_000;
const airPlayOutputBufferFrames = 8192;
const airPlayHttpPcmFallbackMs = 1_500;
const airPlayHttpPcmReconnectMs = 120;
const airPlayRaopLatencies = '1000:1000';
const airPlayStartupStepTimeoutMs = 10_000;
const shouldUseAirPlayHttpPcmBridge = (): boolean => process.env.ECHO_AIRPLAY_HTTP_PCM === '1';
const shouldAdvertiseAirPlay2Experimental = (): boolean => process.env.ECHO_AIRPLAY2_EXPERIMENTAL !== '0';
const highVolumeDebugActions = new Set(['pcm', 'rtp', 'rtcp']);
const airPlay2ProbeSourceVersion = '366.0';
const airPlay2ProbeBodyLimitBytes = 64 * 1024;
const airPlay2SupportedPcmAudioFormats = 0x3fffc;
const airPlay2SupportedAlacAudioFormats = 0x140000;
const airPlay2SupportedAudioFormats = airPlay2SupportedPcmAudioFormats | airPlay2SupportedAlacAudioFormats;
const x25519SpkiPrefix = Buffer.from('302a300506032b656e032100', 'hex');
const ed25519SpkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
const airPlay2PairVerifySalt = 'Pair-Verify-Encrypt-Salt';
const airPlay2PairVerifyInfo = 'Pair-Verify-Encrypt-Info';
const airPlay2PairSetupEncryptSalt = 'Pair-Setup-Encrypt-Salt';
const airPlay2PairSetupEncryptInfo = 'Pair-Setup-Encrypt-Info';
const airPlay2PairSetupControllerSignSalt = 'Pair-Setup-Controller-Sign-Salt';
const airPlay2PairSetupControllerSignInfo = 'Pair-Setup-Controller-Sign-Info';
const airPlay2PairSetupAccessorySignSalt = 'Pair-Setup-Accessory-Sign-Salt';
const airPlay2PairSetupAccessorySignInfo = 'Pair-Setup-Accessory-Sign-Info';
const airPlay2ControlSalt = 'Control-Salt';
const airPlay2EncryptedFrameLimitBytes = 1024;
const airPlay2RtpTrailerBytes = 24;
const airPlay2PairingFlagTransient = 0x10;
const airPlay2PairSetupUsername = 'Pair-Setup';
const airPlay2PairSetupPassword = '3939';
const airPlay2SrpModulusHex = [
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD',
  '3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F',
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64',
  '521F2B18177B200CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF',
].join('');
const airPlay2SrpModulus = BigInt(`0x${airPlay2SrpModulusHex}`);
const airPlay2SrpModulusBytes = airPlay2SrpModulusHex.length / 2;
const airPlay2SrpGenerator = 5n;
const airPlay2FairPlaySetup1Responses = [
  [
    '46504c59030102000000008202000f9f3f9e0a2521dbdf312ab2bfb29e8d232b6376a8c818701d22ae93d82737feaf9db4fdf41c2d',
    'ba9d1f49caaabf6591ac1f7bc6f7e0663d21afe01565953eab81f418ceed095adb7c3d0e254909a79831d49c3982973434',
    'facb42c63a1cd911a6fe941a8a6d4a743b46c3a7649e44c78955e49d8155009549c4e2f7a3f6d5ba',
  ],
  [
    '46504c5903010200000000820201cf32a25714b2524f8aa0ad7af164e37bcf4424e200047efc0ad67afcd95ded1c2730bb591b962ed63a9c4d',
    'ed88ba8fc78de64d91ccfd5c7b56da88e31f5cceafc7431995a01665a54e1939d25b94db64b9e45d8d063e1e6af07e',
    '9656162b0efa404275ea5a44d9591c7256b9fbe6513898b80227721988571650942ad946688a',
  ],
  [
    '46504c5903010200000000820202c169a352eeed35b18cdd9c58d64f16c1519a89eb5317bd0d4336cd68f638ff9d016a5b52b7',
    'fa9216b2b65482c78444118121a2c7fed83db7119e9182aad7d18c7063e2a457555910af9e0efc76347d164043807f58',
    '1ee4fbe42ca9dedc1b5eb2a3aa3d2ecd59e7eee70b3629f22afd161d877353ddb99adc8e07006e56f850ce',
  ],
  [
    '46504c59030102000000008202039001e1727e0f57f9f5880db104a6257a23f5cfff1abbe1e93045251afb97eb9fc001',
    '1ebe0f3a81df5b691d76acb2f7a5c708e3d328f56bb39dbde5f29c8a17f481487e3ae863c678325422e6f78e166d18aa',
    '7fd636258bce28726f661f738893ce44311e4be6c0535193e5ef72e8686233729c227d820c999445d89246c8c359',
  ],
].map((chunks) => Buffer.from(chunks.join(''), 'hex'));
const airPlay2FairPlaySetup2ResponsePrefix = Buffer.from('46504c590301040000000014', 'hex');
const airPlay2FairPlaySetup2SuffixBytes = 20;

const airPlay2PcmFormats: AirPlay2PcmFormat[] = [
  { audioFormat: 0x4, sampleRate: 8_000, bitDepth: 16, channels: 1 },
  { audioFormat: 0x8, sampleRate: 8_000, bitDepth: 16, channels: 2 },
  { audioFormat: 0x10, sampleRate: 16_000, bitDepth: 16, channels: 1 },
  { audioFormat: 0x20, sampleRate: 16_000, bitDepth: 16, channels: 2 },
  { audioFormat: 0x40, sampleRate: 24_000, bitDepth: 16, channels: 1 },
  { audioFormat: 0x80, sampleRate: 24_000, bitDepth: 16, channels: 2 },
  { audioFormat: 0x100, sampleRate: 32_000, bitDepth: 16, channels: 1 },
  { audioFormat: 0x200, sampleRate: 32_000, bitDepth: 16, channels: 2 },
  { audioFormat: 0x400, sampleRate: 44_100, bitDepth: 16, channels: 1 },
  { audioFormat: 0x800, sampleRate: 44_100, bitDepth: 16, channels: 2 },
  { audioFormat: 0x1000, sampleRate: 44_100, bitDepth: 24, channels: 1 },
  { audioFormat: 0x2000, sampleRate: 44_100, bitDepth: 24, channels: 2 },
  { audioFormat: 0x4000, sampleRate: 48_000, bitDepth: 16, channels: 1 },
  { audioFormat: 0x8000, sampleRate: 48_000, bitDepth: 16, channels: 2 },
  { audioFormat: 0x10000, sampleRate: 48_000, bitDepth: 24, channels: 1 },
  { audioFormat: 0x20000, sampleRate: 48_000, bitDepth: 24, channels: 2 },
];

const airPlay2AlacFormats: Array<Omit<AirPlay2AlacFormat, 'framesPerPacket'>> = [
  { audioFormat: 0x40000, sampleRate: 44_100, bitDepth: 16, channels: 2 },
  { audioFormat: 0x100000, sampleRate: 48_000, bitDepth: 16, channels: 2 },
];

const airPlay2TlvNames: Record<number, string> = {
  0: 'method',
  1: 'identifier',
  2: 'salt',
  3: 'publicKey',
  4: 'proof',
  5: 'encryptedData',
  6: 'state',
  7: 'error',
  8: 'retryDelay',
  9: 'certificate',
  10: 'signature',
  11: 'permissions',
  12: 'fragmentData',
  13: 'fragmentLast',
  19: 'flags',
};

type AirPlayAdvertiseInterface = {
  name: string;
  address: string;
  mac: string;
};

type AirPlayMdnsAdvertiserLike = Pick<AirPlayMdnsAdvertiser, 'start' | 'stop'>;

const loadDefaultRaopModule = async (): Promise<RaopModule> => {
  return new AirPlayRaopHelperModule();
};

type NodeLibraopAlacExports = {
  default?: NodeLibraopAlacExports;
  startAlacDecoder?: (options: {
    sampleRate: number;
    sampleSize: number;
    channels: number;
    framesPerPacket: number;
  }) => number;
  decodeAlacFrame?: (handle: number, frame: Buffer) => Buffer;
  stopAlacDecoder?: (handle: number) => void;
};

const createDefaultAirPlay2AlacDecoder: AirPlay2AlacDecoderFactory = async (format) => {
  const imported = (await import('@lox-audioserver/node-libraop')) as unknown as NodeLibraopAlacExports;
  const raop = imported.default ?? imported;
  if (
    typeof raop.startAlacDecoder !== 'function' ||
    typeof raop.decodeAlacFrame !== 'function' ||
    typeof raop.stopAlacDecoder !== 'function'
  ) {
    throw new Error('AirPlay 2 ALAC decoder is not available in @lox-audioserver/node-libraop.');
  }

  const handle = raop.startAlacDecoder({
    sampleRate: format.sampleRate,
    sampleSize: format.bitDepth,
    channels: format.channels,
    framesPerPacket: format.framesPerPacket,
  });
  let closed = false;
  return {
    decodeFrame: (frame) => {
      if (closed) {
        return Buffer.alloc(0);
      }
      return Buffer.from(raop.decodeAlacFrame!(handle, frame));
    },
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      raop.stopAlacDecoder!(handle);
    },
  };
};

const withTimeout = async <T>(operation: PromiseLike<T> | T, timeoutMs: number, message: string): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

export const resolveAirPlayHelperNodePath = (options: AirPlayHelperRuntimeOptions): string => {
  if (options.isPackaged) {
    return options.processExecPath;
  }

  const explicitRuntime = [
    options.npmNodeExecPath,
    options.nodeEnvPath,
  ].filter((value): value is string => Boolean(value));
  return explicitRuntime[0] ?? options.processExecPath;
};

const prependNodePaths = (env: NodeJS.ProcessEnv, nodePaths: string[]): void => {
  const existing = env.NODE_PATH ? [env.NODE_PATH] : [];
  env.NODE_PATH = [...nodePaths, ...existing].join(delimiter);
};

const trimText = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : null;
};

const normalizeAirPlayDeviceId = (mac: string | null | undefined): string => {
  const cleaned = (mac ?? '').replace(/[^a-fA-F0-9]/gu, '').toUpperCase();
  const value = cleaned.length === 12 ? cleaned : '024543484F00';
  return value.match(/.{1,2}/gu)?.join(':') ?? '02:45:43:48:4F:00';
};

const compactAirPlayText = (value: string | null): string =>
  (value ?? '')
    .replace(/[\s"'`.,!?，。！？、:：;；-]+/gu, '')
    .toLocaleLowerCase();

const comparableAirPlayText = (value: string | null): string =>
  compactAirPlayText(value?.replace(/\s*[(（][^()（）]*[)）]\s*/gu, '') ?? null);

const isGenericAirPlayTitle = (title: string | null): boolean => {
  if (!title) {
    return true;
  }

  const normalized = compactAirPlayText(title);
  return normalized === '纯音乐' || normalized === '纯音乐请欣赏' || normalized === 'airplaystream';
};

const sameText = (left: string | null, right: string | null): boolean => {
  if (!left || !right) {
    return false;
  }
  return comparableAirPlayText(left) === comparableAirPlayText(right);
};

const isAlbumLikeArtistPart = (part: string | null, album: string | null): boolean => {
  const normalizedPart = comparableAirPlayText(part);
  const normalizedAlbum = comparableAirPlayText(album);
  return Boolean(normalizedPart && normalizedAlbum && (normalizedPart === normalizedAlbum || normalizedPart.startsWith(normalizedAlbum)));
};

const looksLikeAirPlayLyricLine = (title: string | null): boolean =>
  Boolean(
    title &&
      title.length >= 8 &&
      (/\s/u.test(title) || /[,'"!?，。！？、…]/u.test(title) || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(title)),
  );

const shouldKeepCurrentMetadataForLyricLine = (title: string | null, current: ConnectMetadata | null): boolean =>
  Boolean(
    current?.title &&
      !isGenericAirPlayTitle(current.title) &&
      looksLikeAirPlayLyricLine(title) &&
      !sameText(title, current.title),
  );

const normalizeAirPlayMetadataText = (
  title: string | null,
  artist: string | null,
  album: string | null,
): { title: string | null; artist: string | null; album: string | null } => {
  if (!album) {
    return { title, artist, album };
  }

  const artistParts = artist?.split(/[/／]/u).map((part) => part.trim()).filter(Boolean) ?? [];
  const albumPartIndex = artistParts.findIndex((part) => isAlbumLikeArtistPart(part, album));
  const shouldPreferAlbumTitle =
    isGenericAirPlayTitle(title) || (albumPartIndex >= 0 && !sameText(title, album) && looksLikeAirPlayLyricLine(title));

  if (!shouldPreferAlbumTitle) {
    return { title, artist, album };
  }

  return {
    title: album,
    artist: albumPartIndex > 0 ? artistParts.slice(0, albumPartIndex).join(' / ') : artist,
    album,
  };
};

const summarizeBuffer = (value: Buffer): string => {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 12);
  return `${value.length}b:${digest}`;
};

const summarizeBufferPrefix = (value: Buffer, maxBytes = 16): string =>
  value.subarray(0, Math.min(value.length, maxBytes)).toString('hex') || '-';

const airPlay2CipherName = 'chacha20-poly1305';

const airPlay2CipherAvailable = (): boolean => {
  try {
    return getCiphers().includes(airPlay2CipherName);
  } catch {
    return false;
  }
};

const shouldUseAirPlay2NativeCipher = (): boolean =>
  process.env.ECHO_FORCE_AIRPLAY2_CHACHA_FALLBACK !== '1' && airPlay2CipherAvailable();

const airPlay2CipherProvider = (): 'native' | 'fallback' =>
  shouldUseAirPlay2NativeCipher() ? 'native' : 'fallback';

const summarizeAirPlay2CryptoError = (operation: string, error: unknown, details: string): string => {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error
    ? ` code=${String((error as { code?: unknown }).code)}`
    : '';
  return `${operation} failed cipher=${airPlay2CipherName} provider=${airPlay2CipherProvider()} available=${airPlay2CipherAvailable() ? 'yes' : 'no'}${code}; ${details}; ${message}`;
};

const summarizeAirPlay2EncryptedControlFrame = (frame: Buffer): string => {
  const declaredLength = frame.length >= 2 ? frame.readUInt16LE(0) : null;
  const expectedLength = declaredLength === null ? null : 2 + declaredLength + 16;
  const cipherLength = declaredLength === null ? null : Math.max(0, Math.min(declaredLength, Math.max(0, frame.length - 2)));
  const tagLength = declaredLength === null ? null : Math.max(0, Math.min(16, frame.length - 2 - (cipherLength ?? 0)));
  return [
    `frame=${frame.length}b`,
    `declared=${declaredLength ?? 'missing'}`,
    `expected=${expectedLength ?? 'unknown'}b`,
    `cipher=${cipherLength ?? 'unknown'}b`,
    `tag=${tagLength ?? 'unknown'}b`,
    `prefix=${summarizeBufferPrefix(frame)}`,
    `hash=${summarizeBuffer(frame)}`,
  ].join(' ');
};

const airPlay2SocketPeer = (socket: Socket): string =>
  `${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 'unknown'}`;

const readUInt32Le = (buffer: Buffer, offset: number): number => buffer.readUInt32LE(offset) >>> 0;

const writeUInt32Le = (buffer: Buffer, value: number, offset: number): void => {
  buffer.writeUInt32LE(value >>> 0, offset);
};

const rotateLeft32 = (value: number, shift: number): number =>
  ((value << shift) | (value >>> (32 - shift))) >>> 0;

const chacha20QuarterRound = (state: number[], a: number, b: number, c: number, d: number): void => {
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] = rotateLeft32(state[d] ^ state[a], 16);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotateLeft32(state[b] ^ state[c], 12);
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] = rotateLeft32(state[d] ^ state[a], 8);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotateLeft32(state[b] ^ state[c], 7);
};

const chacha20Block = (key: Buffer, nonce: Buffer, counter: number): Buffer => {
  if (key.length !== 32) {
    throw new Error(`ChaCha20-Poly1305 key must be 32 bytes; got ${key.length}.`);
  }
  if (nonce.length !== 12) {
    throw new Error(`ChaCha20-Poly1305 nonce must be 12 bytes; got ${nonce.length}.`);
  }

  const initialState = [
    0x61707865,
    0x3320646e,
    0x79622d32,
    0x6b206574,
    readUInt32Le(key, 0),
    readUInt32Le(key, 4),
    readUInt32Le(key, 8),
    readUInt32Le(key, 12),
    readUInt32Le(key, 16),
    readUInt32Le(key, 20),
    readUInt32Le(key, 24),
    readUInt32Le(key, 28),
    counter >>> 0,
    readUInt32Le(nonce, 0),
    readUInt32Le(nonce, 4),
    readUInt32Le(nonce, 8),
  ];
  const workingState = [...initialState];
  for (let round = 0; round < 10; round += 1) {
    chacha20QuarterRound(workingState, 0, 4, 8, 12);
    chacha20QuarterRound(workingState, 1, 5, 9, 13);
    chacha20QuarterRound(workingState, 2, 6, 10, 14);
    chacha20QuarterRound(workingState, 3, 7, 11, 15);
    chacha20QuarterRound(workingState, 0, 5, 10, 15);
    chacha20QuarterRound(workingState, 1, 6, 11, 12);
    chacha20QuarterRound(workingState, 2, 7, 8, 13);
    chacha20QuarterRound(workingState, 3, 4, 9, 14);
  }

  const output = Buffer.allocUnsafe(64);
  for (let index = 0; index < 16; index += 1) {
    writeUInt32Le(output, (workingState[index] + initialState[index]) >>> 0, index * 4);
  }
  return output;
};

const chacha20Xor = (key: Buffer, nonce: Buffer, counter: number, input: Buffer): Buffer => {
  const output = Buffer.allocUnsafe(input.length);
  for (let offset = 0; offset < input.length; offset += 64) {
    const block = chacha20Block(key, nonce, counter);
    const chunkLength = Math.min(64, input.length - offset);
    for (let index = 0; index < chunkLength; index += 1) {
      output[offset + index] = input[offset + index] ^ block[index];
    }
    counter = (counter + 1) >>> 0;
  }
  return output;
};

const bigintFromLittleEndian = (value: Buffer): bigint => {
  let result = 0n;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    result = (result << 8n) + BigInt(value[index]);
  }
  return result;
};

const bigintToLittleEndian = (value: bigint, length: number): Buffer => {
  const output = Buffer.alloc(length);
  let next = value;
  for (let index = 0; index < length; index += 1) {
    output[index] = Number(next & 0xffn);
    next >>= 8n;
  }
  return output;
};

const poly1305Authenticate = (key: Buffer, message: Buffer): Buffer => {
  if (key.length !== 32) {
    throw new Error(`Poly1305 key must be 32 bytes; got ${key.length}.`);
  }
  const rBytes = Buffer.from(key.subarray(0, 16));
  rBytes[3] &= 15;
  rBytes[7] &= 15;
  rBytes[11] &= 15;
  rBytes[15] &= 15;
  rBytes[4] &= 252;
  rBytes[8] &= 252;
  rBytes[12] &= 252;
  const r = bigintFromLittleEndian(rBytes);
  const s = bigintFromLittleEndian(key.subarray(16, 32));
  const p = (1n << 130n) - 5n;
  let accumulator = 0n;
  for (let offset = 0; offset < message.length; offset += 16) {
    const chunk = message.subarray(offset, Math.min(offset + 16, message.length));
    const n = bigintFromLittleEndian(chunk) + (1n << BigInt(8 * chunk.length));
    accumulator = ((accumulator + n) * r) % p;
  }
  return bigintToLittleEndian((accumulator + s) & ((1n << 128n) - 1n), 16);
};

const pad16 = (value: Buffer): Buffer =>
  value.length % 16 === 0 ? Buffer.alloc(0) : Buffer.alloc(16 - (value.length % 16));

const uint64LittleEndian = (value: number): Buffer => {
  const output = Buffer.alloc(8);
  output.writeUInt32LE(value >>> 0, 0);
  output.writeUInt32LE(Math.floor(value / 0x1_0000_0000), 4);
  return output;
};

const chacha20Poly1305MacData = (aad: Buffer, ciphertext: Buffer): Buffer =>
  Buffer.concat([
    aad,
    pad16(aad),
    ciphertext,
    pad16(ciphertext),
    uint64LittleEndian(aad.length),
    uint64LittleEndian(ciphertext.length),
  ]);

const fallbackEncryptChaCha20Poly1305 = (
  key: Buffer,
  nonce: Buffer,
  plaintext: Buffer,
  aad = Buffer.alloc(0),
): { encrypted: Buffer; tag: Buffer } => {
  const polyKey = chacha20Block(key, nonce, 0).subarray(0, 32);
  const encrypted = chacha20Xor(key, nonce, 1, plaintext);
  const tag = poly1305Authenticate(polyKey, chacha20Poly1305MacData(aad, encrypted));
  return { encrypted, tag };
};

const fallbackDecryptChaCha20Poly1305 = (
  key: Buffer,
  nonce: Buffer,
  encrypted: Buffer,
  tag: Buffer,
  aad = Buffer.alloc(0),
): Buffer => {
  const polyKey = chacha20Block(key, nonce, 0).subarray(0, 32);
  const expectedTag = poly1305Authenticate(polyKey, chacha20Poly1305MacData(aad, encrypted));
  if (tag.length !== 16 || !timingSafeEqual(tag, expectedTag)) {
    throw new Error(`ChaCha20-Poly1305 authentication tag did not verify; expected=${summarizeBuffer(expectedTag)} got=${summarizeBuffer(tag)}.`);
  }
  return chacha20Xor(key, nonce, 1, encrypted);
};

const parseAirPlay2RtpPacket = (packet: Buffer): AirPlay2RtpPacket | null => {
  if (packet.length < 12) {
    return null;
  }
  const version = packet[0] >>> 6;
  if (version !== 2) {
    return null;
  }
  const csrcCount = packet[0] & 0x0f;
  const hasExtension = (packet[0] & 0x10) !== 0;
  const hasPadding = (packet[0] & 0x20) !== 0;
  let headerLength = 12 + csrcCount * 4;
  if (packet.length < headerLength) {
    return null;
  }
  if (hasExtension) {
    if (packet.length < headerLength + 4) {
      return null;
    }
    const extensionLength = packet.readUInt16BE(headerLength + 2) * 4;
    headerLength += 4 + extensionLength;
    if (packet.length < headerLength) {
      return null;
    }
  }

  let payloadEnd = packet.length;
  if (hasPadding) {
    const paddingLength = packet[packet.length - 1];
    if (paddingLength <= 0 || paddingLength > packet.length - headerLength) {
      return null;
    }
    payloadEnd -= paddingLength;
  }

  return {
    version,
    payloadType: packet[1] & 0x7f,
    marker: (packet[1] & 0x80) !== 0,
    sequenceNumber: packet.readUInt16BE(2),
    timestamp: packet.readUInt32BE(4),
    ssrc: packet.readUInt32BE(8),
    headerLength,
    aad: packet.subarray(4, 12),
    payload: packet.subarray(headerLength, payloadEnd),
  };
};

const summarizeAirPlay2RtpPacket = (packet: AirPlay2RtpPacket): string => {
  const marker = packet.marker ? ' marker=1' : '';
  return `RTP v=${packet.version} pt=${packet.payloadType}${marker} seq=${packet.sequenceNumber} ts=${packet.timestamp} ssrc=${packet.ssrc.toString(16).padStart(8, '0')} header=${packet.headerLength}b payload=${packet.payload.length}b`;
};

const decryptAirPlay2RtpPayload = (packet: AirPlay2RtpPacket, sharedKey: Buffer): Buffer => {
  if (sharedKey.length !== 32) {
    throw new Error(`AirPlay 2 RTP shared key must be 32 bytes; got ${sharedKey.length}.`);
  }
  if (packet.payload.length < airPlay2RtpTrailerBytes) {
    throw new Error(`AirPlay 2 RTP payload missing ${airPlay2RtpTrailerBytes}-byte encryption trailer.`);
  }
  const encryptedEnd = packet.payload.length - airPlay2RtpTrailerBytes;
  const encrypted = packet.payload.subarray(0, encryptedEnd);
  const nonce = Buffer.concat([Buffer.alloc(4), packet.payload.subarray(encryptedEnd, encryptedEnd + 8)]);
  const tag = packet.payload.subarray(encryptedEnd + 8);
  try {
    if (shouldUseAirPlay2NativeCipher()) {
      const decipher = createDecipheriv(airPlay2CipherName, sharedKey, nonce, { authTagLength: 16 });
      decipher.setAAD(packet.aad, { plaintextLength: encrypted.length });
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]);
    }
    return fallbackDecryptChaCha20Poly1305(sharedKey, nonce, encrypted, tag, Buffer.from(packet.aad));
  } catch (error) {
    throw new Error(summarizeAirPlay2CryptoError(
      'RTP decrypt',
      error,
      `${summarizeAirPlay2RtpPacket(packet)} nonce=${nonce.toString('hex')} encrypted=${encrypted.length}b tag=${summarizeBuffer(tag)}`,
    ));
  }
};

const resolveAirPlay2PcmFormat = (streamInfo: AirPlay2SetupStreamInfo | null): AirPlay2PcmFormat | null => {
  if (streamInfo?.compressionType !== 1 || !streamInfo.audioFormat) {
    return null;
  }
  return airPlay2PcmFormats.find((format) => (streamInfo.audioFormat! & format.audioFormat) !== 0) ?? null;
};

const resolveAirPlay2AlacFormat = (streamInfo: AirPlay2SetupStreamInfo | null): AirPlay2AlacFormat | null => {
  if (streamInfo?.compressionType !== 2 || !streamInfo.audioFormat) {
    return null;
  }
  const format = airPlay2AlacFormats.find((candidate) => (streamInfo.audioFormat! & candidate.audioFormat) !== 0);
  if (!format) {
    return null;
  }
  return {
    ...format,
    framesPerPacket: streamInfo.framesPerPacket && streamInfo.framesPerPacket > 0 ? streamInfo.framesPerPacket : 352,
  };
};

const convertAirPlay2LpcmToF32le = (input: Buffer, format: AirPlay2PcmFormat): Buffer => {
  const sampleBytes = format.bitDepth / 8;
  const sampleCount = Math.floor(input.length / sampleBytes);
  const output = Buffer.allocUnsafe(sampleCount * 4);
  for (let index = 0; index < sampleCount; index += 1) {
    const offset = index * sampleBytes;
    let sample: number;
    if (format.bitDepth === 16) {
      sample = input.readInt16BE(offset) / 32768;
    } else {
      let value = (input[offset] << 16) | (input[offset + 1] << 8) | input[offset + 2];
      if ((value & 0x80_0000) !== 0) {
        value -= 0x100_0000;
      }
      sample = value / 8_388_608;
    }
    output.writeFloatLE(Math.max(-1, Math.min(1, sample)), index * 4);
  }
  return output;
};

const airPlay2IdentityFileName = 'airplay2-identity.json';

type StoredAirPlay2Identity = {
  version?: number;
  publicKey?: string;
  privateKey?: string;
};

const exportAirPlay2Ed25519PublicKey = (publicKey: KeyObject): Buffer => {
  const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
  return Buffer.from(publicKeyDer).subarray(ed25519SpkiPrefix.length);
};

const createAirPlay2Identity = (): AirPlay2Identity => {
  const keyPair = generateKeyPairSync('ed25519');
  return {
    publicKey: exportAirPlay2Ed25519PublicKey(keyPair.publicKey),
    privateKey: keyPair.privateKey,
  };
};

const loadStoredAirPlay2Identity = (filePath: string): AirPlay2Identity | null => {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as StoredAirPlay2Identity;
    if (!parsed.privateKey) {
      return null;
    }
    const privateKey = createPrivateKey({
      key: Buffer.from(parsed.privateKey, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
    const publicKey = exportAirPlay2Ed25519PublicKey(createPublicKey(privateKey));
    if (parsed.publicKey && parsed.publicKey !== publicKey.toString('hex')) {
      return null;
    }
    return { publicKey, privateKey };
  } catch {
    return null;
  }
};

const saveAirPlay2Identity = (filePath: string, identity: AirPlay2Identity): void => {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const privateKey = identity.privateKey.export({ format: 'der', type: 'pkcs8' });
    const payload: StoredAirPlay2Identity = {
      version: 1,
      publicKey: identity.publicKey.toString('hex'),
      privateKey: Buffer.from(privateKey).toString('base64'),
    };
    writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch {
    // A stable AirPlay identity is best-effort; pairing can still run with an in-memory key.
  }
};

const resolveAirPlay2IdentityPath = (): string | null => {
  try {
    const userDataPath = app?.getPath?.('userData');
    return userDataPath ? join(userDataPath, airPlay2IdentityFileName) : null;
  } catch {
    return null;
  }
};

const loadOrCreateAirPlay2Identity = (): AirPlay2Identity => {
  const filePath = resolveAirPlay2IdentityPath();
  const stored = filePath ? loadStoredAirPlay2Identity(filePath) : null;
  if (stored) {
    return stored;
  }
  const identity = createAirPlay2Identity();
  if (filePath) {
    saveAirPlay2Identity(filePath, identity);
  }
  return identity;
};

const exportX25519PublicKey = (publicKey: KeyObject): Buffer => {
  const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
  return Buffer.from(publicKeyDer).subarray(x25519SpkiPrefix.length);
};

const createX25519PublicKey = (rawPublicKey: Buffer): KeyObject => {
  if (rawPublicKey.length !== 32) {
    throw new Error(`Invalid X25519 public key length: ${rawPublicKey.length}.`);
  }
  return createPublicKey({
    key: Buffer.concat([x25519SpkiPrefix, rawPublicKey]),
    format: 'der',
    type: 'spki',
  });
};

const createEd25519PublicKey = (rawPublicKey: Buffer): KeyObject => {
  if (rawPublicKey.length !== 32) {
    throw new Error(`Invalid Ed25519 public key length: ${rawPublicKey.length}.`);
  }
  return createPublicKey({
    key: Buffer.concat([ed25519SpkiPrefix, rawPublicKey]),
    format: 'der',
    type: 'spki',
  });
};

const createAirPlay2Nonce = (label: string): Buffer => {
  const value = Buffer.from(label, 'utf8');
  if (value.length !== 8) {
    throw new Error(`AirPlay 2 nonce labels must be 8 bytes: ${label}`);
  }
  return Buffer.concat([Buffer.alloc(4), value]);
};

const createAirPlay2CounterNonce = (counter: number): Buffer => {
  const nonce = Buffer.alloc(12);
  nonce.writeUInt32LE(counter >>> 0, 4);
  nonce.writeUInt32LE(Math.floor(counter / 0x1_0000_0000), 8);
  return nonce;
};

const deriveAirPlay2Key = (inputKey: Buffer, salt: string, info: string): Buffer =>
  Buffer.from(hkdfSync('sha512', inputKey, Buffer.from(salt, 'utf8'), Buffer.from(info, 'utf8'), 32));

const createAirPlay2EncryptedControlState = (
  encryptionKey: Buffer,
  keyLabel: string,
  swapped = false,
): AirPlay2EncryptedControlState => ({
  controlReadKey: deriveAirPlay2Key(
    encryptionKey,
    airPlay2ControlSalt,
    swapped ? 'Control-Write-Encryption-Key' : 'Control-Read-Encryption-Key',
  ),
  controlWriteKey: deriveAirPlay2Key(
    encryptionKey,
    airPlay2ControlSalt,
    swapped ? 'Control-Read-Encryption-Key' : 'Control-Write-Encryption-Key',
  ),
  keyLabel,
});

const uniqueAirPlay2EncryptedControlStates = (
  states: AirPlay2EncryptedControlState[],
): AirPlay2EncryptedControlState[] => {
  const unique: AirPlay2EncryptedControlState[] = [];
  for (const state of states) {
    if (!unique.some((item) =>
      item.controlReadKey.equals(state.controlReadKey) && item.controlWriteKey.equals(state.controlWriteKey)
    )) {
      unique.push(state);
    }
  }
  return unique;
};

const createAirPlay2TransientControlStates = (session: ReturnType<typeof calculateAirPlay2SrpSession>): AirPlay2EncryptedControlState[] => {
  const setupKeyFromSessionKey = deriveAirPlay2Key(
    session.sessionKey,
    airPlay2PairSetupEncryptSalt,
    airPlay2PairSetupEncryptInfo,
  );
  const setupKeyFromSharedSecret = deriveAirPlay2Key(
    session.sessionSecret,
    airPlay2PairSetupEncryptSalt,
    airPlay2PairSetupEncryptInfo,
  );
  const keyMaterials: Array<{ label: string; value: Buffer }> = [
    { label: 'srp-session-key', value: session.sessionKey },
    { label: 'srp-shared-secret-padded', value: session.sessionSecret },
    { label: 'srp-shared-secret-minimal', value: session.sessionSecretMinimal },
    { label: 'pair-setup-encrypt-key/session-key', value: setupKeyFromSessionKey },
    { label: 'pair-setup-encrypt-key/shared-secret', value: setupKeyFromSharedSecret },
  ];

  return uniqueAirPlay2EncryptedControlStates(keyMaterials.flatMap(({ label, value }) => [
    createAirPlay2EncryptedControlState(value, label),
    createAirPlay2EncryptedControlState(value, `${label}/swapped`, true),
  ]));
};

const createAirPlay2PairVerifyControlStates = (
  state: AirPlay2PairVerifyState | null,
): AirPlay2EncryptedControlState[] => {
  if (!state) {
    return [];
  }
  return uniqueAirPlay2EncryptedControlStates([
    {
      controlReadKey: state.controlReadKey,
      controlWriteKey: state.controlWriteKey,
      keyLabel: 'pair-verify-m1-shared-secret',
    },
    {
      controlReadKey: state.controlWriteKey,
      controlWriteKey: state.controlReadKey,
      keyLabel: 'pair-verify-m1-shared-secret/swapped',
    },
  ]);
};

const hashAirPlay2Sha512 = (...buffers: Buffer[]): Buffer => {
  const hash = createHash('sha512');
  for (const buffer of buffers) {
    hash.update(buffer);
  }
  return hash.digest();
};

const airPlay2BigintFromBuffer = (value: Buffer): bigint => BigInt(`0x${value.toString('hex') || '0'}`);

const airPlay2BigintToBuffer = (value: bigint, byteLength = airPlay2SrpModulusBytes): Buffer => {
  const hex = value.toString(16).padStart(byteLength * 2, '0');
  return Buffer.from(hex.slice(-byteLength * 2), 'hex');
};

const airPlay2BigintToMinimalBuffer = (value: bigint): Buffer => {
  const hex = value.toString(16);
  return Buffer.from(hex.length % 2 === 0 ? hex : `0${hex}`, 'hex');
};

const airPlay2SrpHashBigint = (...buffers: Buffer[]): bigint => airPlay2BigintFromBuffer(hashAirPlay2Sha512(...buffers));

const airPlay2SrpMultiplier = airPlay2SrpHashBigint(
  airPlay2BigintToBuffer(airPlay2SrpModulus),
  airPlay2BigintToBuffer(airPlay2SrpGenerator),
);

const airPlay2ModPow = (base: bigint, exponent: bigint, modulus: bigint): bigint => {
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

const createAirPlay2SrpVerifier = (salt: Buffer): bigint => {
  const userHash = hashAirPlay2Sha512(Buffer.from(`${airPlay2PairSetupUsername}:${airPlay2PairSetupPassword}`, 'utf8'));
  const x = airPlay2SrpHashBigint(salt, userHash);
  return airPlay2ModPow(airPlay2SrpGenerator, x, airPlay2SrpModulus);
};

const createAirPlay2SrpPrivateKey = (): bigint => {
  let value = 0n;
  while (value === 0n) {
    value = airPlay2BigintFromBuffer(randomBytes(32));
  }
  return value;
};

const createAirPlay2SrpServerPublicKey = (verifier: bigint, privateKey: bigint): Buffer => {
  const publicKey = (
    (airPlay2SrpMultiplier * verifier) +
    airPlay2ModPow(airPlay2SrpGenerator, privateKey, airPlay2SrpModulus)
  ) % airPlay2SrpModulus;
  return airPlay2BigintToBuffer(publicKey);
};

const calculateAirPlay2SrpSession = (
  salt: Buffer,
  clientPublicKey: Buffer,
  serverPublicKey: Buffer,
  privateKey: bigint,
  verifier: bigint,
): { sessionKey: Buffer; sessionSecret: Buffer; sessionSecretMinimal: Buffer; clientProof: Buffer; serverProof: Buffer } => {
  const clientPublic = airPlay2BigintFromBuffer(clientPublicKey);
  if (clientPublic % airPlay2SrpModulus === 0n) {
    throw new Error('Pair-Setup M3 client SRP public key is invalid.');
  }
  const scramblingParameter = airPlay2SrpHashBigint(clientPublicKey, serverPublicKey);
  const sessionSecret = airPlay2ModPow(
    (clientPublic * airPlay2ModPow(verifier, scramblingParameter, airPlay2SrpModulus)) % airPlay2SrpModulus,
    privateKey,
    airPlay2SrpModulus,
  );
  const sessionSecretBuffer = airPlay2BigintToBuffer(sessionSecret);
  const sessionKey = hashAirPlay2Sha512(sessionSecretBuffer);
  const modulusHash = hashAirPlay2Sha512(airPlay2BigintToBuffer(airPlay2SrpModulus));
  const generatorHash = hashAirPlay2Sha512(airPlay2BigintToMinimalBuffer(airPlay2SrpGenerator));
  const groupHash = Buffer.from(modulusHash.map((value, index) => value ^ generatorHash[index]));
  const usernameHash = hashAirPlay2Sha512(Buffer.from(airPlay2PairSetupUsername, 'utf8'));
  const clientProof = hashAirPlay2Sha512(groupHash, usernameHash, salt, clientPublicKey, serverPublicKey, sessionKey);
  const serverProof = hashAirPlay2Sha512(clientPublicKey, clientProof, sessionKey);
  return {
    sessionKey,
    sessionSecret: sessionSecretBuffer,
    sessionSecretMinimal: airPlay2BigintToMinimalBuffer(sessionSecret),
    clientProof,
    serverProof,
  };
};

const encodeAirPlay2Tlv = (fields: AirPlay2TlvField[]): Buffer => {
  const chunks: Buffer[] = [];
  for (const field of fields) {
    if (field.value.length === 0) {
      chunks.push(Buffer.from([field.type & 0xff, 0]));
      continue;
    }
    let offset = 0;
    while (offset < field.value.length) {
      const chunk = field.value.subarray(offset, offset + 255);
      chunks.push(Buffer.from([field.type & 0xff, chunk.length]));
      chunks.push(chunk);
      offset += chunk.length;
    }
  }
  return Buffer.concat(chunks);
};

const parseAirPlay2Tlv = (body: Buffer): { fields: Map<number, Buffer[]>; error: null } | { fields: null; error: string } => {
  const fields = new Map<number, Buffer[]>();
  let offset = 0;
  while (offset + 2 <= body.length) {
    const type = body[offset];
    const length = body[offset + 1];
    offset += 2;
    if (offset + length > body.length) {
      return { fields: null, error: `malformed TLV at ${offset - 2}; body=${summarizeBuffer(body)}` };
    }
    const chunk = body.subarray(offset, offset + length);
    offset += length;
    const list = fields.get(type) ?? [];
    list.push(chunk);
    fields.set(type, list);
  }

  if (offset !== body.length) {
    return { fields: null, error: `malformed TLV trailing byte; body=${summarizeBuffer(body)}` };
  }

  return { fields, error: null };
};

const getAirPlay2TlvValue = (fields: Map<number, Buffer[]>, type: number): Buffer | null => {
  const chunks = fields.get(type);
  return chunks ? Buffer.concat(chunks) : null;
};

const getAirPlay2TlvByte = (fields: Map<number, Buffer[]>, type: number): number | null => {
  const value = getAirPlay2TlvValue(fields, type);
  return value && value.length > 0 ? value.readUInt8(0) : null;
};

const airPlay2TlvNumber = (value: Buffer | null): number =>
  value ? value.reduce((next, byte) => (next * 256) + byte, 0) : 0;

const encryptAirPlay2Payload = (key: Buffer, nonceLabel: string, body: Buffer): Buffer => {
  const nonce = createAirPlay2Nonce(nonceLabel);
  try {
    if (shouldUseAirPlay2NativeCipher()) {
      const cipher = createCipheriv(airPlay2CipherName, key, nonce, { authTagLength: 16 });
      const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
      return Buffer.concat([encrypted, cipher.getAuthTag()]);
    }
    const { encrypted, tag } = fallbackEncryptChaCha20Poly1305(key, nonce, body);
    return Buffer.concat([encrypted, tag]);
  } catch (error) {
    throw new Error(summarizeAirPlay2CryptoError(
      `payload encrypt ${nonceLabel}`,
      error,
      `key=${key.length}b nonce=${nonce.toString('hex')} body=${summarizeBuffer(body)}`,
    ));
  }
};

const decryptAirPlay2Payload = (key: Buffer, nonceLabel: string, body: Buffer): Buffer => {
  if (body.length < 16) {
    throw new Error('AirPlay 2 encrypted payload is missing its authentication tag.');
  }
  const encrypted = body.subarray(0, -16);
  const tag = body.subarray(-16);
  const nonce = createAirPlay2Nonce(nonceLabel);
  try {
    if (shouldUseAirPlay2NativeCipher()) {
      const decipher = createDecipheriv(airPlay2CipherName, key, nonce, { authTagLength: 16 });
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]);
    }
    return fallbackDecryptChaCha20Poly1305(key, nonce, encrypted, tag);
  } catch (error) {
    throw new Error(summarizeAirPlay2CryptoError(
      `payload decrypt ${nonceLabel}`,
      error,
      `key=${key.length}b nonce=${nonce.toString('hex')} encrypted=${encrypted.length}b tag=${summarizeBuffer(tag)} body=${summarizeBuffer(body)}`,
    ));
  }
};

const encryptAirPlay2ControlFrame = (key: Buffer, counter: number, payload: Buffer): Buffer => {
  const nonce = createAirPlay2CounterNonce(counter);
  try {
    const header = Buffer.alloc(2);
    header.writeUInt16LE(payload.length, 0);
    const { encrypted, tag } = shouldUseAirPlay2NativeCipher()
      ? (() => {
        const cipher = createCipheriv(airPlay2CipherName, key, nonce, { authTagLength: 16 });
        cipher.setAAD(header, { plaintextLength: payload.length });
        const encryptedPayload = Buffer.concat([cipher.update(payload), cipher.final()]);
        return { encrypted: encryptedPayload, tag: cipher.getAuthTag() };
      })()
      : fallbackEncryptChaCha20Poly1305(key, nonce, payload, header);
    const frame = Buffer.alloc(2 + encrypted.length + 16);
    header.copy(frame, 0);
    encrypted.copy(frame, 2);
    tag.copy(frame, 2 + encrypted.length);
    return frame;
  } catch (error) {
    throw new Error(summarizeAirPlay2CryptoError(
      'control frame encrypt',
      error,
      `key=${key.length}b counter=${counter} nonce=${nonce.toString('hex')} payload=${summarizeBuffer(payload)}`,
    ));
  }
};

const decryptAirPlay2ControlFrame = (key: Buffer, counter: number, frame: Buffer): Buffer => {
  if (frame.length < 18) {
    throw new Error(`AirPlay 2 encrypted control frame is too short; ${summarizeAirPlay2EncryptedControlFrame(frame)}.`);
  }
  const length = frame.readUInt16LE(0);
  if (frame.length !== 2 + length + 16) {
    throw new Error(`AirPlay 2 encrypted control frame length mismatch; ${summarizeAirPlay2EncryptedControlFrame(frame)}.`);
  }
  const nonce = createAirPlay2CounterNonce(counter);
  try {
    const header = frame.subarray(0, 2);
    const encrypted = frame.subarray(2, 2 + length);
    const tag = frame.subarray(2 + length);
    if (shouldUseAirPlay2NativeCipher()) {
      const decipher = createDecipheriv(airPlay2CipherName, key, nonce, { authTagLength: 16 });
      decipher.setAAD(header, { plaintextLength: encrypted.length });
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]);
    }
    const encryptedCopy = Buffer.alloc(encrypted.length);
    const tagCopy = Buffer.alloc(tag.length);
    const headerCopy = Buffer.alloc(header.length);
    encrypted.copy(encryptedCopy);
    tag.copy(tagCopy);
    header.copy(headerCopy);
    return fallbackDecryptChaCha20Poly1305(key, nonce, encryptedCopy, tagCopy, headerCopy);
  } catch (error) {
    throw new Error(summarizeAirPlay2CryptoError(
      'control frame decrypt',
      error,
      `key=${key.length}b counter=${counter} nonce=${nonce.toString('hex')} ${summarizeAirPlay2EncryptedControlFrame(frame)}`,
    ));
  }
};

const summarizeAirPlay2Tlv = (body: Buffer): string | null => {
  if (body.length === 0) {
    return 'empty body';
  }

  const parsed = parseAirPlay2Tlv(body);
  if (!parsed.fields) {
    return parsed.error;
  }

  const parts = [...parsed.fields.entries()]
    .sort(([left], [right]) => left - right)
    .map(([type, chunks]) => {
      const value = Buffer.concat(chunks);
      const name = airPlay2TlvNames[type] ?? `type${type}`;
      if ((type === 0 || type === 6 || type === 7 || type === 11 || type === 13 || type === 19) && value.length > 0) {
        return `${name}=${value.readUInt8(0)}`;
      }
      if (type === 1 && value.length > 0) {
        const text = value.toString('utf8').replace(/[^\w:.-]/gu, '?').slice(0, 48);
        return `${name}=${text}`;
      }
      return `${name}=${summarizeBuffer(value)}`;
    });

  return parts.length > 0 ? parts.join(' ') : `unparsed body=${summarizeBuffer(body)}`;
};

const parseAirPlay2TextRequest = (buffer: Buffer): { request: AirPlay2ProbeRequest; consumed: number } | null => {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd < 0) {
    return null;
  }

  const headerText = buffer.subarray(0, headerEnd).toString('utf8');
  const [requestLine, ...headerLines] = headerText.split('\r\n');
  const match = /^([A-Z_]+)\s+(\S+)\s+(\S+)$/u.exec(requestLine ?? '');
  if (!match) {
    throw new Error(`Invalid AirPlay 2 request line: ${requestLine ?? ''}`);
  }

  const headers: Record<string, string> = {};
  for (const line of headerLines) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      continue;
    }
    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }

  const contentLength = Number(headers['content-length'] ?? 0);
  if (!Number.isInteger(contentLength) || contentLength < 0 || contentLength > airPlay2ProbeBodyLimitBytes) {
    throw new Error(`Invalid AirPlay 2 Content-Length: ${headers['content-length'] ?? 'missing'}.`);
  }

  const bodyStart = headerEnd + 4;
  const totalLength = bodyStart + contentLength;
  if (buffer.length < totalLength) {
    return null;
  }

  return {
    request: {
      method: match[1],
      path: match[2].split('?')[0] ?? '/',
      protocol: match[3],
      headers,
      body: buffer.subarray(bodyStart, totalLength),
    },
    consumed: totalLength,
  };
};

const airPlay2ReasonPhrase = (statusCode: number): string => {
  if (statusCode === 200) return 'OK';
  if (statusCode === 400) return 'Bad Request';
  if (statusCode === 501) return 'Not Implemented';
  return 'Internal Server Error';
};

const serializeAirPlay2ProbeResponse = (request: AirPlay2ProbeRequest, response: AirPlay2ProbeResponse): Buffer => {
  const protocol = request.protocol.startsWith('RTSP/') ? 'RTSP/1.0' : 'HTTP/1.1';
  const body = typeof response.body === 'string'
    ? Buffer.from(response.body, 'utf8')
    : response.body ?? Buffer.alloc(0);
  const cseq = request.headers.cseq;
  const headers = {
    Server: `AirTunes/${airPlay2ProbeSourceVersion}`,
    ...(cseq ? { CSeq: cseq } : {}),
    'Content-Length': body.length,
    ...(response.headers ?? {}),
  };
  const headerText = [
    `${protocol} ${response.statusCode} ${airPlay2ReasonPhrase(response.statusCode)}`,
    ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
    '',
    '',
  ].join('\r\n');
  return Buffer.concat([Buffer.from(headerText, 'utf8'), body]);
};

const airPlay2BplistIntByteLength = (value: number): 1 | 2 | 4 | 8 => {
  if (value >= 0 && value <= 0xff) return 1;
  if (value >= 0 && value <= 0xffff) return 2;
  if (value >= 0 && value <= 0xffff_ffff) return 4;
  return 8;
};

const writeAirPlay2BplistUint = (value: number | bigint, byteLength: number): Buffer => {
  const output = Buffer.alloc(byteLength);
  let next = BigInt(value);
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    output[index] = Number(next & 0xffn);
    next >>= 8n;
  }
  return output;
};

const encodeAirPlay2BplistInt = (value: number): Buffer => {
  const byteLength = airPlay2BplistIntByteLength(value);
  const exponent = Math.log2(byteLength);
  return Buffer.concat([Buffer.from([0x10 | exponent]), writeAirPlay2BplistUint(value, byteLength)]);
};

const encodeAirPlay2BplistLength = (type: number, length: number): Buffer => {
  if (length < 15) {
    return Buffer.from([type | length]);
  }
  return Buffer.concat([Buffer.from([type | 0x0f]), encodeAirPlay2BplistInt(length)]);
};

const collectAirPlay2BplistObjects = (value: AirPlay2BplistValue, objects: AirPlay2BplistObjectRecord[]): number => {
  const index = objects.length;
  const record: AirPlay2BplistObjectRecord = { value };
  objects.push(record);
  if (Array.isArray(value)) {
    record.arrayRefs = value.map((item) => collectAirPlay2BplistObjects(item, objects));
  } else if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    const entries = Object.entries(value);
    record.dictKeyRefs = entries.map(([key]) => collectAirPlay2BplistObjects(key, objects));
    record.dictValueRefs = entries.map(([, item]) => collectAirPlay2BplistObjects(item, objects));
  }
  return index;
};

const encodeAirPlay2BplistRef = (index: number, refSize: number): Buffer => writeAirPlay2BplistUint(index, refSize);

const encodeAirPlay2BplistObject = (
  record: AirPlay2BplistObjectRecord,
  refSize: number,
): Buffer => {
  const { value } = record;
  if (value === null) return Buffer.from([0x00]);
  if (typeof value === 'boolean') return Buffer.from([value ? 0x09 : 0x08]);
  if (typeof value === 'number') return encodeAirPlay2BplistInt(value);
  if (typeof value === 'string') {
    const ascii = [...value].every((char) => char.charCodeAt(0) <= 0x7f);
    if (ascii) {
      const content = Buffer.from(value, 'ascii');
      return Buffer.concat([encodeAirPlay2BplistLength(0x50, content.length), content]);
    }
    const content = Buffer.from(value, 'utf16le');
    for (let index = 0; index < content.length; index += 2) {
      const next = content[index];
      content[index] = content[index + 1];
      content[index + 1] = next;
    }
    return Buffer.concat([encodeAirPlay2BplistLength(0x60, value.length), content]);
  }
  if (Buffer.isBuffer(value)) {
    return Buffer.concat([encodeAirPlay2BplistLength(0x40, value.length), value]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([
      encodeAirPlay2BplistLength(0xa0, value.length),
      ...(record.arrayRefs ?? []).map((childRef) => encodeAirPlay2BplistRef(childRef, refSize)),
    ]);
  }

  const entries = Object.entries(value);
  return Buffer.concat([
    encodeAirPlay2BplistLength(0xd0, entries.length),
    ...(record.dictKeyRefs ?? []).map((childRef) => encodeAirPlay2BplistRef(childRef, refSize)),
    ...(record.dictValueRefs ?? []).map((childRef) => encodeAirPlay2BplistRef(childRef, refSize)),
  ]);
};

const encodeAirPlay2Bplist = (value: AirPlay2BplistValue): Buffer => {
  const objects: AirPlay2BplistObjectRecord[] = [];
  collectAirPlay2BplistObjects(value, objects);
  const refSize = objects.length <= 0xff ? 1 : objects.length <= 0xffff ? 2 : 4;
  const encodedObjects = objects.map((object) => encodeAirPlay2BplistObject(object, refSize));
  const offsets: number[] = [];
  let offset = 8;
  for (const object of encodedObjects) {
    offsets.push(offset);
    offset += object.length;
  }
  const offsetTableOffset = offset;
  const offsetSize = offset <= 0xff ? 1 : offset <= 0xffff ? 2 : offset <= 0xffff_ffff ? 4 : 8;
  const offsetTable = Buffer.concat(offsets.map((item) => writeAirPlay2BplistUint(item, offsetSize)));
  const trailer = Buffer.concat([
    Buffer.alloc(6),
    Buffer.from([offsetSize, refSize]),
    writeAirPlay2BplistUint(objects.length, 8),
    writeAirPlay2BplistUint(0, 8),
    writeAirPlay2BplistUint(offsetTableOffset, 8),
  ]);
  return Buffer.concat([Buffer.from('bplist00', 'ascii'), ...encodedObjects, offsetTable, trailer]);
};

const readAirPlay2BplistBigUint = (body: Buffer, offset: number, byteLength: number): bigint | null => {
  if (offset < 0 || byteLength <= 0 || offset + byteLength > body.length) {
    return null;
  }
  let value = 0n;
  for (let index = offset; index < offset + byteLength; index += 1) {
    value = (value << 8n) | BigInt(body[index]);
  }
  return value;
};

const readAirPlay2BplistUintNumber = (body: Buffer, offset: number, byteLength: number): number | null => {
  const value = readAirPlay2BplistBigUint(body, offset, byteLength);
  if (value === null || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(value);
};

const readAirPlay2BplistIntNumber = (body: Buffer, offset: number, byteLength: number): number | null => {
  const unsigned = readAirPlay2BplistBigUint(body, offset, byteLength);
  if (unsigned === null) {
    return null;
  }
  const bits = BigInt(byteLength * 8);
  const signBit = 1n << (bits - 1n);
  const signed = (unsigned & signBit) !== 0n ? unsigned - (1n << bits) : unsigned;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) {
    return null;
  }
  return Number(signed);
};

const readAirPlay2BplistLength = (
  body: Buffer,
  objectOffset: number,
  info: number,
): { length: number; cursor: number } | null => {
  if (info < 0x0f) {
    return { length: info, cursor: objectOffset + 1 };
  }
  const markerOffset = objectOffset + 1;
  const marker = body[markerOffset];
  if ((marker & 0xf0) !== 0x10) {
    return null;
  }
  const byteLength = 1 << (marker & 0x0f);
  const length = readAirPlay2BplistUintNumber(body, markerOffset + 1, byteLength);
  if (length === null) {
    return null;
  }
  return { length, cursor: markerOffset + 1 + byteLength };
};

const decodeAirPlay2Bplist = (body: Buffer): { value: AirPlay2BplistValue; error: null } | { value: null; error: string } => {
  if (body.length < 40 || body.subarray(0, 8).toString('ascii') !== 'bplist00') {
    return { value: null, error: 'not a binary plist' };
  }
  const trailerOffset = body.length - 32;
  const offsetSize = body[trailerOffset + 6];
  const refSize = body[trailerOffset + 7];
  const objectCount = readAirPlay2BplistUintNumber(body, trailerOffset + 8, 8);
  const topObject = readAirPlay2BplistUintNumber(body, trailerOffset + 16, 8);
  const offsetTableOffset = readAirPlay2BplistUintNumber(body, trailerOffset + 24, 8);
  if (
    !offsetSize ||
    !refSize ||
    objectCount === null ||
    topObject === null ||
    offsetTableOffset === null ||
    objectCount <= 0 ||
    topObject >= objectCount ||
    offsetTableOffset >= trailerOffset
  ) {
    return { value: null, error: 'invalid binary plist trailer' };
  }

  const offsets: number[] = [];
  for (let index = 0; index < objectCount; index += 1) {
    const offset = readAirPlay2BplistUintNumber(body, offsetTableOffset + index * offsetSize, offsetSize);
    if (offset === null || offset < 8 || offset >= trailerOffset) {
      return { value: null, error: `invalid binary plist object offset ${index}` };
    }
    offsets.push(offset);
  }

  const cache = new Map<number, AirPlay2BplistValue>();
  let parseError: string | null = null;
  const markParseError = (ref: number, reason: string): void => {
    if (parseError) {
      return;
    }
    const objectOffset = offsets[ref];
    const marker = body[objectOffset];
    parseError = [
      reason,
      `ref=${ref}`,
      `offset=${objectOffset}`,
      `marker=0x${marker.toString(16).padStart(2, '0')}`,
      `type=0x${(marker & 0xf0).toString(16).padStart(2, '0')}`,
      `info=0x${(marker & 0x0f).toString(16)}`,
    ].join(' ');
  };
  const parseRef = (ref: number, depth = 0): AirPlay2BplistValue | undefined => {
    if (ref < 0 || ref >= offsets.length || depth > 64) {
      parseError ??= `invalid binary plist reference ref=${ref} depth=${depth}`;
      return undefined;
    }
    const cached = cache.get(ref);
    if (cached !== undefined) {
      return cached;
    }

    const objectOffset = offsets[ref];
    const marker = body[objectOffset];
    const type = marker & 0xf0;
    const info = marker & 0x0f;
    let value: AirPlay2BplistValue | undefined;

    if (type === 0x00) {
      if (info === 0x00) value = null;
      else if (info === 0x08) value = false;
      else if (info === 0x09) value = true;
    } else if (type === 0x10) {
      const byteLength = 1 << info;
      value = readAirPlay2BplistIntNumber(body, objectOffset + 1, byteLength) ?? undefined;
    } else if (type === 0x20) {
      const byteLength = 1 << info;
      if (byteLength === 4 && objectOffset + 5 <= body.length) value = body.readFloatBE(objectOffset + 1);
      if (byteLength === 8 && objectOffset + 9 <= body.length) value = body.readDoubleBE(objectOffset + 1);
    } else if (type === 0x30) {
      if (info === 0x03 && objectOffset + 9 <= body.length) value = body.readDoubleBE(objectOffset + 1);
    } else if (type === 0x40) {
      const lengthInfo = readAirPlay2BplistLength(body, objectOffset, info);
      if (lengthInfo && lengthInfo.cursor + lengthInfo.length <= trailerOffset) {
        value = body.subarray(lengthInfo.cursor, lengthInfo.cursor + lengthInfo.length);
      }
    } else if (type === 0x50) {
      const lengthInfo = readAirPlay2BplistLength(body, objectOffset, info);
      if (lengthInfo && lengthInfo.cursor + lengthInfo.length <= trailerOffset) {
        value = body.toString('ascii', lengthInfo.cursor, lengthInfo.cursor + lengthInfo.length);
      }
    } else if (type === 0x60) {
      const lengthInfo = readAirPlay2BplistLength(body, objectOffset, info);
      const byteLength = lengthInfo ? lengthInfo.length * 2 : 0;
      if (lengthInfo && lengthInfo.cursor + byteLength <= trailerOffset) {
        const chars: string[] = [];
        for (let cursor = lengthInfo.cursor; cursor < lengthInfo.cursor + byteLength; cursor += 2) {
          chars.push(String.fromCharCode(body.readUInt16BE(cursor)));
        }
        value = chars.join('');
      }
    } else if (type === 0x80) {
      value = readAirPlay2BplistUintNumber(body, objectOffset + 1, info + 1) ?? undefined;
    } else if (type === 0xa0) {
      const lengthInfo = readAirPlay2BplistLength(body, objectOffset, info);
      if (lengthInfo && lengthInfo.cursor + lengthInfo.length * refSize <= trailerOffset) {
        const array: AirPlay2BplistValue[] = [];
        cache.set(ref, array);
        for (let index = 0; index < lengthInfo.length; index += 1) {
          const childRef = readAirPlay2BplistUintNumber(body, lengthInfo.cursor + index * refSize, refSize);
          const child = childRef === null ? undefined : parseRef(childRef, depth + 1);
          if (child === undefined) {
            return undefined;
          }
          array.push(child);
        }
        value = array;
      }
    } else if (type === 0xc0) {
      const lengthInfo = readAirPlay2BplistLength(body, objectOffset, info);
      if (lengthInfo && lengthInfo.cursor + lengthInfo.length * refSize <= trailerOffset) {
        const setItems: AirPlay2BplistValue[] = [];
        cache.set(ref, setItems);
        for (let index = 0; index < lengthInfo.length; index += 1) {
          const childRef = readAirPlay2BplistUintNumber(body, lengthInfo.cursor + index * refSize, refSize);
          const child = childRef === null ? undefined : parseRef(childRef, depth + 1);
          if (child === undefined) {
            return undefined;
          }
          setItems.push(child);
        }
        value = setItems;
      }
    } else if (type === 0xd0) {
      const lengthInfo = readAirPlay2BplistLength(body, objectOffset, info);
      if (lengthInfo && lengthInfo.cursor + lengthInfo.length * refSize * 2 <= trailerOffset) {
        const record: { [key: string]: AirPlay2BplistValue } = {};
        cache.set(ref, record);
        const valueRefsOffset = lengthInfo.cursor + lengthInfo.length * refSize;
        for (let index = 0; index < lengthInfo.length; index += 1) {
          const keyRef = readAirPlay2BplistUintNumber(body, lengthInfo.cursor + index * refSize, refSize);
          const valueRef = readAirPlay2BplistUintNumber(body, valueRefsOffset + index * refSize, refSize);
          const key = keyRef === null ? undefined : parseRef(keyRef, depth + 1);
          const item = valueRef === null ? undefined : parseRef(valueRef, depth + 1);
          if (typeof key !== 'string' || item === undefined) {
            return undefined;
          }
          record[key] = item;
        }
        value = record;
      }
    }

    if (value === undefined) {
      markParseError(ref, 'unsupported binary plist object');
      return undefined;
    }
    cache.set(ref, value);
    return value;
  };

  const value = parseRef(topObject);
  if (value === undefined) {
    return { value: null, error: parseError ?? 'unsupported binary plist object' };
  }
  return { value, error: null };
};

const isAirPlay2BplistRecord = (value: AirPlay2BplistValue): value is { [key: string]: AirPlay2BplistValue } =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value));

const getAirPlay2BplistNumber = (value: AirPlay2BplistValue | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const getAirPlay2BplistString = (value: AirPlay2BplistValue | undefined): string | null =>
  typeof value === 'string' ? value : null;

const getAirPlay2BplistBuffer = (value: AirPlay2BplistValue | undefined): Buffer | null =>
  Buffer.isBuffer(value) ? value : null;

const parseAirPlay2SetupSessionInfo = (body: Buffer): { info: AirPlay2SessionSetupInfo | null; error: string | null } => {
  if (body.length === 0) {
    return { info: null, error: null };
  }
  const decoded = decodeAirPlay2Bplist(body);
  if (!decoded.value) {
    return { info: null, error: decoded.error };
  }
  const root = isAirPlay2BplistRecord(decoded.value) ? decoded.value : null;
  if (!root) {
    return { info: null, error: null };
  }
  return {
    info: {
      encryptionKey: getAirPlay2BplistBuffer(root.ekey),
      encryptionIv: getAirPlay2BplistBuffer(root.eiv),
      encryptionType: getAirPlay2BplistNumber(root.et),
      timingProtocol: getAirPlay2BplistString(root.timingProtocol),
      senderName: getAirPlay2BplistString(root.name),
      senderModel: getAirPlay2BplistString(root.model),
      sourceVersion: getAirPlay2BplistString(root.sourceVersion),
      sessionUuid: getAirPlay2BplistString(root.sessionUUID),
    },
    error: null,
  };
};

const parseAirPlay2SetupStreams = (body: Buffer): { streams: AirPlay2SetupStreamInfo[]; error: string | null } => {
  const decoded = decodeAirPlay2Bplist(body);
  if (!decoded.value) {
    return { streams: [], error: decoded.error };
  }
  const root = isAirPlay2BplistRecord(decoded.value) ? decoded.value : null;
  const streamsValue = root?.streams;
  if (!Array.isArray(streamsValue)) {
    return { streams: [], error: null };
  }
  const streams = streamsValue
    .map((stream): AirPlay2SetupStreamInfo | null => {
      if (!isAirPlay2BplistRecord(stream)) {
        return null;
      }
      return {
        type: getAirPlay2BplistNumber(stream.type),
        compressionType: getAirPlay2BplistNumber(stream.ct),
        audioFormat: getAirPlay2BplistNumber(stream.audioFormat),
        framesPerPacket: getAirPlay2BplistNumber(stream.spf),
        sharedKey: getAirPlay2BplistBuffer(stream.shk),
      };
    })
    .filter((stream): stream is AirPlay2SetupStreamInfo => Boolean(stream));
  return { streams, error: null };
};

const summarizeAirPlay2SetupStream = (stream: AirPlay2SetupStreamInfo | null): string => {
  if (!stream) {
    return 'stream metadata unavailable';
  }
  const pcmFormat = resolveAirPlay2PcmFormat(stream);
  const alacFormat = resolveAirPlay2AlacFormat(stream);
  return [
    `type=${stream.type ?? 'unknown'}`,
    `ct=${stream.compressionType ?? 'unknown'}`,
    `audioFormat=${stream.audioFormat ?? 'unknown'}`,
    `spf=${stream.framesPerPacket ?? 'unknown'}`,
    `shk=${stream.sharedKey ? `${stream.sharedKey.length}b` : 'missing'}`,
    `pcm=${pcmFormat ? `${pcmFormat.sampleRate}/${pcmFormat.bitDepth}/${pcmFormat.channels}` : 'unsupported'}`,
    `alac=${alacFormat ? `${alacFormat.sampleRate}/${alacFormat.bitDepth}/${alacFormat.channels}` : 'unsupported'}`,
  ].join(' ');
};

const summarizeAirPlay2SessionSetupInfo = (info: AirPlay2SessionSetupInfo | null): string => {
  if (!info) {
    return 'session metadata unavailable';
  }
  return [
    `ekey=${info.encryptionKey ? `${info.encryptionKey.length}b` : 'missing'}`,
    `eiv=${info.encryptionIv ? `${info.encryptionIv.length}b` : 'missing'}`,
    `et=${info.encryptionType ?? 'unknown'}`,
    `timing=${info.timingProtocol ?? 'unknown'}`,
    `sender=${info.senderName ?? 'unknown'}`,
    `model=${info.senderModel ?? 'unknown'}`,
    `source=${info.sourceVersion ?? 'unknown'}`,
    `session=${info.sessionUuid ?? 'unknown'}`,
  ].join(' ');
};

const normalizeVolume = (value: unknown): number => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return 100;
  }

  if (numberValue <= 0) {
    if (numberValue <= -144) {
      return 0;
    }

    const dbValue = Math.max(-30, numberValue);
    return Math.max(1, Math.min(100, Math.round(10 ** (dbValue / 20) * 100)));
  }

  if (numberValue <= 1 && numberValue >= 0) {
    return Math.round(numberValue * 100);
  }

  return Math.max(0, Math.min(100, Math.round(numberValue)));
};

const volumePercentToAirPlayDb = (volumePercent: number): number => {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(volumePercent) ? volumePercent : 100));
  if (clamped <= 0) {
    return -144;
  }
  return Math.max(-144, Math.min(0, Math.round(20 * Math.log10(clamped / 100))));
};

const parseAirPlayTextParameters = (body: Buffer): Record<string, string> => {
  const parameters: Record<string, string> = {};
  for (const line of body.toString('utf8').split(/\r?\n/u)) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key) {
      parameters[key] = value;
    }
  }
  return parameters;
};

const parseAirPlayRequestedParameters = (body: Buffer): string[] =>
  body
    .toString('utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);

const parseAirPlayProgressParameter = (
  value: string | undefined,
  sampleRate: number,
): { positionSeconds: number; durationSeconds: number } | null => {
  if (!value) {
    return null;
  }
  const [startText, currentText, endText] = value.split('/').map((part) => part.trim());
  const start = Number(startText);
  const current = Number(currentText);
  const end = Number(endText);
  if (!Number.isFinite(start) || !Number.isFinite(current) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  const safeSampleRate = sampleRate > 0 ? sampleRate : defaultSampleRate;
  return {
    positionSeconds: Math.max(0, (current - start) / safeSampleRate),
    durationSeconds: Math.max(0, (end - start) / safeSampleRate),
  };
};

const eventAddress = (event: RaopEvent): string | null =>
  trimText(event.remoteAddress) ?? trimText(event.address) ?? trimText(event.host);

const normalizeMac = (mac: string | null | undefined): string | null => {
  const cleaned = (mac ?? '').replace(/[^a-fA-F0-9]/gu, '').toUpperCase();
  if (cleaned.length !== 12 || cleaned === '000000000000') {
    return null;
  }
  return cleaned.match(/.{1,2}/gu)?.join(':') ?? null;
};

const isBenchmarkIpv4 = (address: string): boolean => /^198\.(?:18|19)\./u.test(address);

const isApipaIpv4 = (address: string): boolean => address.startsWith('169.254.');

const isPrivateLanIpv4 = (address: string): boolean =>
  address.startsWith('10.') ||
  address.startsWith('192.168.') ||
  /^172\.(?:1[6-9]|2\d|3[0-1])\./u.test(address);

const isLikelyVirtualAirPlayInterface = (name: string): boolean =>
  /(?:mihomo|clash|vpn|wireguard|tailscale|zerotier|vmware|virtualbox|hyper-v|docker|wsl|loopback|vethernet|tap|tun|npcap|bluetooth)/iu.test(name);

const scoreAdvertiseInterface = (item: AirPlayAdvertiseInterface): number => {
  let score = isPrivateLanIpv4(item.address) ? 0 : 20;
  if (/wi-?fi|wlan|ethernet|以太网/iu.test(item.name)) {
    score -= 5;
  }
  if (isLikelyVirtualAirPlayInterface(item.name)) {
    score += 50;
  }
  if (item.mac === '02:45:43:48:4F:00') {
    score += 10;
  }
  return score;
};

const getAdvertiseInterfaces = (): AirPlayAdvertiseInterface[] => {
  const candidates = Object.entries(networkInterfaces())
    .flatMap(([name, items]) => (items ?? []).map((item) => ({ name, item })))
    .filter(({ item }) => item.family === 'IPv4' && !item.internal)
    .map(({ name, item }) => ({
      name,
      address: item.address,
      mac: normalizeMac(item.mac) ?? '02:45:43:48:4F:00',
    }))
    .filter((item) => !isBenchmarkIpv4(item.address) && !isApipaIpv4(item.address));
  const realLanCandidates = candidates.filter((item) => !isLikelyVirtualAirPlayInterface(item.name));
  return (realLanCandidates.length > 0 ? realLanCandidates : candidates)
    .sort((left, right) => {
      const scoreDelta = scoreAdvertiseInterface(left) - scoreAdvertiseInterface(right);
      return scoreDelta || left.name.localeCompare(right.name) || left.address.localeCompare(right.address);
    });
};

const findAvailableTcpPort = async (host: string | null, basePort: number, portRange: number): Promise<number> => {
  for (let offset = 0; offset < portRange; offset += 1) {
    const port = basePort + offset;
    const available = await new Promise<boolean>((resolve) => {
      const server = createTcpServer();
      server.unref();
      server.once('error', () => resolve(false));
      server.listen(port, host ?? undefined, () => {
        server.close(() => resolve(true));
      });
    });
    if (available) {
      return port;
    }
  }
  throw new Error(`No available AirPlay port in ${basePort}-${basePort + portRange - 1}`);
};

type HelperRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class AirPlayRaopHelperModule implements RaopModule {
  private child: ChildProcessWithoutNullStreams | null = null;
  private handler: ((event: RaopEvent) => void) | null = null;
  private logHandler: ((event: unknown) => void) | null = null;
  private readyPromise: Promise<void> | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, HelperRequest>();

  setLogHandler(handler: ((event: unknown) => void) | null): void {
    this.logHandler = handler;
  }

  async startReceiver(options: RaopReceiverOptions, handler: (event: RaopEvent) => void): Promise<number> {
    this.handler = handler;
    await this.ensureHelper();
    const response = await this.sendRequest('start', { options });
    const handle = Number((response as { handle?: unknown }).handle);
    if (!Number.isInteger(handle)) {
      throw new Error('AirPlay helper did not return a receiver handle.');
    }
    return handle;
  }

  async stopReceiver(): Promise<void> {
    if (!this.child) {
      return;
    }
    await this.sendRequest('stop', {}).catch(() => undefined);
    await this.shutdownHelper();
  }

  async sendRemoteCommand(_handle: number, command: 'play' | 'pause' | 'stop' | 'next' | 'prev' | 'previous'): Promise<boolean> {
    if (!this.child) {
      return false;
    }
    const response = await this.sendRequest('remote', { command }).catch(() => ({ ok: false }));
    return Boolean((response as { ok?: unknown }).ok);
  }

  async setPcmForwarding(enabled: boolean): Promise<boolean> {
    if (!this.child) {
      return false;
    }
    const response = await this.sendRequest('pcm-forwarding', { enabled }).catch(() => ({ ok: false }));
    return Boolean((response as { ok?: unknown }).ok);
  }

  async checkAvailable(): Promise<void> {
    await this.ensureHelper();
    await this.shutdownHelper();
  }

  private async ensureHelper(): Promise<void> {
    if (this.readyPromise) {
      await this.readyPromise;
      return;
    }

    const nodePath = this.resolveNodePath();
    const helperPath = this.resolveHelperPath();
    if (!existsSync(helperPath)) {
      throw new Error(`AirPlay helper script is missing: ${helperPath}`);
    }
    const env = { ...process.env };
    if (this.shouldRunAsNode(nodePath)) {
      env.ELECTRON_RUN_AS_NODE = '1';
    } else {
      delete env.ELECTRON_RUN_AS_NODE;
    }
    if (app.isPackaged) {
      prependNodePaths(env, [
        join(process.resourcesPath, 'app.asar.unpacked', 'node_modules'),
        join(app.getAppPath(), 'node_modules'),
      ]);
    }

    this.child = spawn(nodePath, [helperPath], {
      cwd: dirname(helperPath),
      env,
      stdio: 'pipe',
      windowsHide: true,
    });

    const child = this.child;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const readyTimeout = setTimeout(() => reject(new Error('AirPlay helper did not become ready.')), 10_000);
      child.once('error', (error) => {
        clearTimeout(readyTimeout);
        reject(error);
      });
      child.stdin.on('error', (error: Error) => {
        this.handleHelperWriteFailure(child, error);
      });
      child.once('exit', (code, signal) => {
        clearTimeout(readyTimeout);
        this.rejectAll(new Error(`AirPlay helper exited (${code ?? signal ?? 'unknown'}).`));
        this.child = null;
        this.readyPromise = null;
        if (code !== 0) {
          this.logHandler?.({ source: 'helper', level: 'error', line: `helper exited (${code ?? signal ?? 'unknown'})` });
        }
      });

      const rl = readline.createInterface({ input: child.stdout });
      rl.on('line', (line) => {
        const message = this.parseMessage(line);
        if (!message) {
          return;
        }
        if (message.type === 'ready') {
          clearTimeout(readyTimeout);
          resolve();
          return;
        }
        this.handleHelperMessage(message);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        this.logHandler?.({ source: 'helper', level: 'warn', line: chunk.toString('utf8').trim() });
      });
    });

    await this.readyPromise;
  }

  private parseMessage(line: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(line) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      this.logHandler?.({ source: 'helper', level: 'warn', line });
      return null;
    }
  }

  private handleHelperMessage(message: Record<string, unknown>): void {
    if (message.type === 'event') {
      const event = message.event;
      if (event && typeof event === 'object' && !Array.isArray(event)) {
        const nextEvent = { ...(event as RaopEvent) };
        if (nextEvent.data && !(nextEvent.data instanceof Buffer)) {
          const data = nextEvent.data as { type?: unknown; data?: unknown };
          if (data.type === 'Buffer' && Array.isArray(data.data)) {
            nextEvent.data = Buffer.from(data.data as number[]);
          }
        }
        this.handler?.(nextEvent);
      }
      return;
    }

    if (message.type === 'log') {
      this.logHandler?.({ source: 'helper', level: message.level, line: message.message });
      return;
    }

    if (message.type === 'fatal') {
      const error = new Error(trimText(message.message) ?? 'AirPlay helper crashed.');
      this.rejectAll(error);
      this.logHandler?.({ source: 'helper', level: 'error', line: error.message });
      return;
    }

    const requestId = Number(message.requestId);
    if (!Number.isInteger(requestId)) {
      return;
    }

    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    if (message.type === 'error') {
      pending.reject(new Error(trimText(message.message) ?? 'AirPlay helper request failed.'));
    } else {
      pending.resolve(message);
    }
  }

  private sendRequest(type: string, payload: Record<string, unknown>): Promise<unknown> {
    const child = this.child;
    if (!child || child.killed) {
      return Promise.reject(new Error('AirPlay helper is not running.'));
    }
    if (child.stdin.destroyed || child.stdin.writableEnded || !child.stdin.writable) {
      return Promise.reject(new Error('AirPlay helper stdin is not writable.'));
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`AirPlay helper request timed out: ${type}`));
      }, 10_000);
      this.pending.set(requestId, { resolve, reject, timer });
      const message = `${JSON.stringify({ ...payload, type, requestId })}\n`;
      const fail = (error: unknown): void => {
        const request = this.pending.get(requestId);
        if (request) {
          clearTimeout(request.timer);
          this.pending.delete(requestId);
          request.reject(error instanceof Error ? error : new Error(String(error)));
        }
        this.handleHelperWriteFailure(child, error);
      };

      try {
        child.stdin.write(message, (error: Error | null | undefined) => {
          if (error) {
            fail(error);
          }
        });
      } catch (error) {
        fail(error);
      }
    });
  }

  private rejectAll(error: Error): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(requestId);
    }
  }

  private handleHelperWriteFailure(child: ChildProcessWithoutNullStreams, error: unknown): void {
    if (this.child !== child) {
      return;
    }

    const nextError = error instanceof Error ? error : new Error(String(error));
    this.logHandler?.({ source: 'helper', level: 'error', line: `helper stdin closed: ${nextError.message}` });
    this.child = null;
    this.readyPromise = null;
    this.rejectAll(nextError);
    try {
      if (!child.killed) {
        child.kill();
      }
    } catch {
      // Best-effort cleanup after helper pipe failure.
    }
  }

  private async shutdownHelper(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.readyPromise = null;
    if (!child || child.killed) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 1000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        if (!child.stdin.destroyed && !child.stdin.writableEnded) {
          child.stdin.end();
        }
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  private resolveNodePath(): string {
    return resolveAirPlayHelperNodePath({
      isPackaged: app.isPackaged,
      processExecPath: process.execPath,
      npmNodeExecPath: process.env.npm_node_execpath,
      nodeEnvPath: process.env.NODE,
    });
  }

  private shouldRunAsNode(nodePath: string): boolean {
    return nodePath === process.execPath;
  }

  private resolveHelperPath(): string {
    const appPath = app.getAppPath();
    const candidates = [
      join(appPath, 'src', 'main', 'connect', 'airplayRaopHelper.cjs'),
      join(appPath, 'out', 'main', 'airplayRaopHelper.cjs'),
      join(process.resourcesPath, 'airplayRaopHelper.cjs'),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
  }
}

export const convertS16leToF32le = (input: Buffer): Buffer => {
  const sampleCount = Math.floor(input.length / 2);
  const output = Buffer.allocUnsafe(sampleCount * 4);

  for (let index = 0; index < sampleCount; index += 1) {
    output.writeFloatLE(input.readInt16LE(index * 2) / 32768, index * 4);
  }

  return output;
};

const createAirPlayOutputSettings = (): NonNullable<Parameters<AirPlayAudioSession['playPcmStream']>[0]['output']> => ({
  outputMode: 'shared',
  sharedBackend: 'auto',
  requestedOutputSampleRate: airPlayOutputSampleRate,
  latencyProfile: 'stable',
  bufferSizeFrames: airPlayOutputBufferFrames,
  useJuceDecode: false,
  dsdOutputMode: 'pcm',
  asioNativeDsdExperimentalEnabled: false,
  releaseExclusiveOnPauseExperimentalEnabled: false,
});

const airPlayStateFromAudioStatus = (audioStatus: AudioStatus, currentState: AirPlayReceiverStatus['state']): AirPlayReceiverStatus['state'] => {
  if (currentState === 'playing' && audioStatus.state === 'paused') {
    return currentState;
  }
  if (currentState === 'paused' && audioStatus.state === 'playing') {
    return currentState;
  }
  return audioStatus.state === 'playing' || audioStatus.state === 'paused' || audioStatus.state === 'stopped' || audioStatus.state === 'error'
    ? audioStatus.state
    : currentState;
};

const metadataIdentityKey = (metadata: ConnectMetadata | null): string | null => {
  if (!metadata) {
    return null;
  }
  return [
    comparableAirPlayText(metadata.title),
    comparableAirPlayText(metadata.artist),
    comparableAirPlayText(metadata.album),
    metadata.durationSeconds > 0 ? Math.round(metadata.durationSeconds).toString() : '',
  ].join('|');
};

const metadataFromEvent = (event: RaopEvent, current: ConnectMetadata | null, artworkUrl: string | null): ConnectMetadata => {
  const durationSeconds = Number(event.durationMs);
  const eventDurationSeconds = Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds / 1000) : 0;
  const currentDurationSeconds = current?.durationSeconds ?? 0;
  const eventTitle = trimText(event.title);
  const keepCurrentMetadata =
    shouldKeepCurrentMetadataForLyricLine(eventTitle, current) &&
    (!eventDurationSeconds || !currentDurationSeconds || Math.abs(eventDurationSeconds - currentDurationSeconds) <= 2);
  const title = keepCurrentMetadata ? current?.title ?? null : eventTitle ?? current?.title ?? null;
  const artist = keepCurrentMetadata ? current?.artist ?? null : trimText(event.artist) ?? current?.artist ?? null;
  const album = keepCurrentMetadata ? current?.album ?? null : trimText(event.album) ?? current?.album ?? null;
  const normalized = normalizeAirPlayMetadataText(title, artist, album);
  return {
    title: normalized.title ?? defaultTitle,
    artist: normalized.artist ?? unknownArtist,
    album: normalized.album,
    albumArtist: current?.albumArtist ?? normalized.artist ?? unknownArtist,
    durationSeconds: eventDurationSeconds || (current?.durationSeconds ?? 0),
    coverHttpUrl: artworkUrl ?? current?.coverHttpUrl ?? '',
  };
};

export class AirPlayReceiverSpikeService extends EventEmitter<AirPlayReceiverEvents> {
  private readonly audioSession: AirPlayAudioSession;
  private readonly advertisedName: string;
  private readonly loadRaopModule: () => Promise<RaopModule>;
  private readonly createAirPlay2AlacDecoder: AirPlay2AlacDecoderFactory;
  private readonly getAdvertiseInterfaces: () => AirPlayAdvertiseInterface[];
  private readonly createMdnsAdvertiser: () => AirPlayMdnsAdvertiserLike;
  private readonly useHttpPcmBridge: boolean;
  private readonly airPlay2Experimental: boolean;
  private readonly startupTimeoutMs: number;
  private readonly now: () => number;
  private readonly airPlay2Identity: AirPlay2Identity;
  private raopModule: RaopModule | null = null;
  private receiverHandle: number | null = null;
  private advertisedInterface: AirPlayAdvertiseInterface | null = null;
  private mdnsAdvertisers: AirPlayMdnsAdvertiserLike[] = [];
  private airPlay2ProbeServer: TcpServer | null = null;
  private airPlay2ProbePort: number | null = null;
  private airPlay2EventServer: TcpServer | null = null;
  private airPlay2EventPort: number | null = null;
  private airPlay2UdpListeners: AirPlay2UdpListener[] = [];
  private airPlay2StreamState: AirPlay2StreamState | null = null;
  private airPlay2PairSetupState: AirPlay2PairSetupState | null = null;
  private airPlay2PairVerifyState: AirPlay2PairVerifyState | null = null;
  private airPlay2EncryptedControlState: AirPlay2EncryptedControlState | null = null;
  private airPlay2EncryptedControlCandidates: AirPlay2EncryptedControlState[] = [];
  private airPlay2FairPlayState: AirPlay2FairPlayState | null = null;
  private airPlay2SessionSetupInfo: AirPlay2SessionSetupInfo | null = null;
  private pcmStream: PassThrough | null = null;
  private httpPcmRequest: ClientRequest | null = null;
  private readonly intentionalHttpPcmRequestCloses = new WeakSet<ClientRequest>();
  private httpPcmTransform: Transform | null = null;
  private httpPcmFallbackTimer: NodeJS.Timeout | null = null;
  private httpPcmReconnectTimer: NodeJS.Timeout | null = null;
  private httpPcmBytesReceived = 0;
  private lastHttpPcmPort: number | null = null;
  private pcmPlaybackStarted = false;
  private currentSourceId: string | null = null;
  private ignorePcmUntilNextStream = false;
  private audioSessionClaimedCurrentSource = false;
  private currentMetadataIdentityKey: string | null = null;
  private positionAnchorSeconds = 0;
  private positionAnchorUpdatedAtMs = 0;
  private sessionCounter = 0;
  private status: AirPlayReceiverStatus;

  constructor(dependencies: AirPlayReceiverDependencies = {}) {
    super();
    this.audioSession = dependencies.audioSession ?? getAudioSession();
    this.advertisedName = dependencies.advertisedName ?? defaultAdvertisedName();
    this.loadRaopModule = dependencies.loadRaopModule ?? loadDefaultRaopModule;
    this.createAirPlay2AlacDecoder = dependencies.createAirPlay2AlacDecoder ?? createDefaultAirPlay2AlacDecoder;
    this.getAdvertiseInterfaces = dependencies.getAdvertiseInterfaces ?? getAdvertiseInterfaces;
    this.createMdnsAdvertiser = dependencies.createMdnsAdvertiser ?? (() => new AirPlayMdnsAdvertiser());
    this.useHttpPcmBridge = dependencies.useHttpPcmBridge ?? shouldUseAirPlayHttpPcmBridge();
    this.airPlay2Experimental = dependencies.airPlay2Experimental ?? shouldAdvertiseAirPlay2Experimental();
    this.startupTimeoutMs = dependencies.startupTimeoutMs ?? airPlayStartupStepTimeoutMs;
    this.now = dependencies.now ?? Date.now;
    this.airPlay2Identity = loadOrCreateAirPlay2Identity();
    this.status = this.createDisabledStatus();
    this.audioSession.on('status', this.handleAudioStatus);
    if (!dependencies.loadRaopModule) {
      void this.refreshNativeAvailability();
    }
  }

  getStatus(): AirPlayReceiverStatus {
    return this.withAudioPosition(this.status);
  }

  async setEnabled(enabled: boolean): Promise<AirPlayReceiverStatus> {
    if (enabled) {
      await this.start();
    } else {
      await this.stop();
    }

    return this.getStatus();
  }

  async stopPlayback(): Promise<AirPlayReceiverStatus> {
    this.sendRemoteCommand('stop');
    const currentSourceId = this.currentSourceId;
    if (currentSourceId && this.audioSession.getStatus().currentFilePath === currentSourceId) {
      await Promise.resolve(this.audioSession.stop()).catch(() => undefined);
    }
    this.ignorePcmUntilNextStream = true;
    this.clearCurrentSession('stopped by ECHO');
    this.setStatus({
      state: this.status.enabled ? 'idle' : 'disabled',
      currentSourceId: null,
      currentClient: null,
      metadata: null,
      currentLyricLine: null,
      artworkUrl: null,
      positionSeconds: 0,
      durationSeconds: 0,
    });
    return this.getStatus();
  }

  isCurrentSource(sourceId: string | null | undefined): boolean {
    return Boolean(sourceId && this.currentSourceId === sourceId);
  }

  async playPlayback(): Promise<AirPlayReceiverStatus> {
    this.sendRemoteCommand('play');
    this.setPositionAnchor(this.estimatePosition(this.status));
    this.setStatus({ state: 'playing' });
    return this.getStatus();
  }

  async pausePlayback(): Promise<AirPlayReceiverStatus> {
    this.sendRemoteCommand('pause');
    this.setPositionAnchor(this.estimatePosition(this.status));
    this.setStatus({ state: 'paused' });
    return this.getStatus();
  }

  async seekPlayback(_positionSeconds?: number): Promise<AirPlayReceiverStatus> {
    void _positionSeconds;
    this.addDebugEvent('seek', 'AirPlay receiver seek is not supported by the native backend');
    return this.getStatus();
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.audioSession.off?.('status', this.handleAudioStatus);
    this.removeAllListeners();
  }

  private createDisabledStatus(): AirPlayReceiverStatus {
    return {
      enabled: false,
      state: 'disabled',
      advertisedName: this.advertisedName,
      nativeAvailable: false,
      currentSourceId: null,
      currentClient: null,
      metadata: null,
      currentLyricLine: null,
      artworkUrl: null,
      positionSeconds: 0,
      durationSeconds: 0,
      volume: Math.round((this.audioSession.getStatus().volume ?? 1) * 100),
      error: null,
      debugEvents: [],
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  private async start(): Promise<void> {
    if (this.status.enabled && this.receiverHandle !== null) {
      return;
    }

    this.setStatus({ enabled: false, state: 'starting', error: null });
    try {
      this.raopModule ??= await this.loadRaopModule();
      this.raopModule.setLogHandler?.((event) => this.handleNativeLog(event), 'info', 'info', 'warn');
      const advertiseInterfaces = this.getAdvertiseInterfaces();
      const advertiseInterface = advertiseInterfaces[0] ?? null;
      const advertisedMac = advertiseInterface?.mac ?? '02:45:43:48:4F:00';
      this.advertisedInterface = advertiseInterface;
      const portBase = await findAvailableTcpPort(null, 6000, 100);
      const airPlay2ProbePort = this.airPlay2Experimental ? await this.startAirPlay2ProbeServer() : null;
      this.receiverHandle = await withTimeout(
        this.raopModule.startReceiver(
          {
            name: this.advertisedName,
            model: airPlayModel,
            mac: advertisedMac,
            latencies: airPlayRaopLatencies,
            metadata: true,
            portBase,
            portRange: 100,
          },
          (event) => this.handleRaopEvent(event),
        ),
        this.startupTimeoutMs,
        'AirPlay RAOP receiver startup timed out.',
      );
      const advertisedAddresses: string[] = [];
      for (const item of advertiseInterfaces) {
        const mdnsAdvertiser = this.createMdnsAdvertiser();
        try {
          await withTimeout(
            mdnsAdvertiser.start({
              name: this.advertisedName,
              model: airPlayModel,
              address: item.address,
              mac: advertisedMac,
              port: portBase,
              airPlayPort: airPlay2ProbePort,
              airPlayPublicKey: this.airPlay2Identity.publicKey.toString('hex'),
              airPlay2Experimental: this.airPlay2Experimental,
            }),
            this.startupTimeoutMs,
            `AirPlay mDNS advertiser startup timed out on ${item.address}.`,
          );
          this.mdnsAdvertisers.push(mdnsAdvertiser);
          advertisedAddresses.push(`${item.address} (${item.name})`);
        } catch (error) {
          await withTimeout(
            Promise.resolve().then(() => mdnsAdvertiser.stop(false)),
            Math.min(this.startupTimeoutMs, 1000),
            `AirPlay mDNS advertiser cleanup timed out on ${item.address}.`,
          ).catch((stopError) => {
            this.addDebugEvent('mdns', stopError instanceof Error ? stopError.message : String(stopError));
          });
          this.addDebugEvent('mdns', `${item.address}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      this.addDebugEvent(
        'mdns',
        advertisedAddresses.length > 0
          ? `fallback advertisers on ${advertisedAddresses.join(', ')}`
          : 'AirPlay mDNS advertiser did not start on any eligible LAN IPv4 interface',
      );
      this.addDebugEvent(
        'start',
        advertiseInterface
          ? `RAOP receiver started on 0.0.0.0:${portBase}; primary advertisement ${advertiseInterface.address} (${advertiseInterface.mac})`
          : `RAOP receiver started on 0.0.0.0:${portBase}; no LAN IPv4 interface found`,
      );
      if (this.airPlay2Experimental) {
        this.addDebugEvent(
          'airplay2',
          airPlay2ProbePort
            ? `experimental AirPlay 2 advertisement enabled on ${airPlay2ProbePort}; RAOP discovery is routed to the AirPlay 2 control server`
            : 'experimental _airplay._tcp advertisement skipped because probe server did not start',
        );
      }
      this.setStatus({
        enabled: true,
        state: 'idle',
        nativeAvailable: true,
        error: advertisedAddresses.length > 0 ? null : 'AirPlay discovery unavailable: mDNS advertiser did not start on any LAN interface.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.receiverHandle = null;
      this.raopModule = null;
      await this.stopAirPlay2ProbeServer().catch(() => undefined);
      this.clearCurrentSession('native module unavailable');
      this.setStatus({
        enabled: false,
        state: 'unavailable',
        nativeAvailable: false,
        error: `AirPlay native backend unavailable: ${message}`,
      });
      this.addDebugEvent('error', message);
    }
  }

  private async refreshNativeAvailability(): Promise<void> {
    if (this.status.enabled || this.status.state === 'starting') {
      return;
    }

    try {
      this.raopModule ??= await this.loadRaopModule();
      await this.raopModule.checkAvailable?.();
      if (!this.status.enabled) {
        this.setStatus({
          nativeAvailable: true,
          error: null,
        });
      }
    } catch (error) {
      if (!this.status.enabled) {
        const message = error instanceof Error ? error.message : String(error);
        this.setStatus({
          nativeAvailable: false,
          error: `AirPlay native backend unavailable: ${message}`,
        });
      }
    }
  }

  private async stop(): Promise<void> {
    const hadAirPlayPlayback = Boolean(this.currentSourceId);
    if (hadAirPlayPlayback) {
      await this.stopPlayback().catch(() => undefined);
    } else {
      this.clearCurrentSession('');
    }
    if (this.mdnsAdvertisers.length > 0) {
      const mdnsAdvertisers = this.mdnsAdvertisers;
      this.mdnsAdvertisers = [];
      await Promise.all(
        mdnsAdvertisers.map((mdnsAdvertiser) =>
          mdnsAdvertiser.stop().catch((error) => {
            this.addDebugEvent('mdns', error instanceof Error ? error.message : String(error));
          }),
        ),
      );
    }
    await this.stopAirPlay2ProbeServer();
    if (this.receiverHandle !== null && this.raopModule) {
      try {
        await this.raopModule.stopReceiver(this.receiverHandle);
      } catch (error) {
        this.addDebugEvent('error', error instanceof Error ? error.message : String(error));
      }
    }
    this.receiverHandle = null;
    this.raopModule = null;
    this.advertisedInterface = null;
    this.setStatus({
      enabled: false,
      state: 'disabled',
      currentClient: null,
      currentSourceId: null,
      metadata: null,
      currentLyricLine: null,
      artworkUrl: null,
      positionSeconds: 0,
      durationSeconds: 0,
      error: null,
    });
  }

  private async startAirPlay2ProbeServer(): Promise<number | null> {
    if (this.airPlay2ProbeServer && this.airPlay2ProbePort) {
      return this.airPlay2ProbePort;
    }

    try {
      const port = await findAvailableTcpPort(null, 7000, 100);
      const server = createTcpServer((socket) => this.handleAirPlay2TcpConnection(socket));
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(port, () => {
            server.off('error', reject);
            resolve();
          });
        }),
        this.startupTimeoutMs,
        'AirPlay 2 probe server startup timed out.',
      );
      this.airPlay2ProbeServer = server;
      this.airPlay2ProbePort = port;
      this.addDebugEvent('airplay2', `probe server listening on ${port}`);
      this.addDebugEvent(
        'crypto',
        `runtime cipher=${airPlay2CipherName} provider=${airPlay2CipherProvider()} available=${airPlay2CipherAvailable() ? 'yes' : 'no'} node=${process.versions.node ?? '-'} openssl=${process.versions.openssl ?? '-'} electron=${process.versions.electron ?? '-'}`,
        { method: 'BOOT', path: '/airplay2' },
      );
      return port;
    } catch (error) {
      this.addDebugEvent('airplay2', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  private async stopAirPlay2ProbeServer(): Promise<void> {
    const server = this.airPlay2ProbeServer;
    this.airPlay2ProbeServer = null;
    this.airPlay2ProbePort = null;
    this.airPlay2PairSetupState = null;
    this.airPlay2PairVerifyState = null;
    this.airPlay2EncryptedControlState = null;
    this.airPlay2EncryptedControlCandidates = [];
    this.airPlay2FairPlayState = null;
    this.airPlay2SessionSetupInfo = null;
    await this.stopAirPlay2SessionResources();
    if (!server) {
      return;
    }

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private async stopAirPlay2SessionResources(): Promise<void> {
    const eventServer = this.airPlay2EventServer;
    this.airPlay2EventServer = null;
    this.airPlay2EventPort = null;
    this.closeAirPlay2StreamState();
    const udpListeners = this.airPlay2UdpListeners.splice(0);
    await Promise.all([
      eventServer
        ? new Promise<void>((resolve) => eventServer.close(() => resolve()))
        : Promise.resolve(),
      ...udpListeners.map((listener) => new Promise<void>((resolve) => listener.socket.close(() => resolve()))),
    ]);
  }

  private closeAirPlay2StreamState(): void {
    const state = this.airPlay2StreamState;
    this.airPlay2StreamState = null;
    if (!state?.alacDecoder) {
      return;
    }
    try {
      state.alacDecoder.close();
    } catch (error) {
      this.addDebugEvent('setup', `AirPlay 2 ALAC decoder close failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private handleAirPlay2TcpConnection(socket: Socket): void {
    const connection: AirPlay2TcpConnection = {
      buffer: Buffer.alloc(0),
      plaintextBuffer: Buffer.alloc(0),
      encrypted: false,
      draining: false,
      cipher: { readCounter: 0, writeCounter: 0, readCounterOffset: 0, writeCounterOffset: 0 },
      lastFrameSummary: null,
    };

    socket.on('data', (chunk) => {
      connection.buffer = Buffer.concat([connection.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      if (!connection.draining) {
        void this.drainAirPlay2TcpConnection(socket, connection);
      }
    });
    socket.on('error', (error) => {
      this.addDebugEvent('probe-error', `socket=${airPlay2SocketPeer(socket)} ${error.message}`, {
        method: 'TCP',
        path: '/airplay2',
        statusCode: null,
        remoteAddress: airPlay2SocketPeer(socket),
      });
    });
  }

  private async drainAirPlay2TcpConnection(socket: Socket, connection: AirPlay2TcpConnection): Promise<void> {
    connection.draining = true;
    try {
      while (connection.buffer.length > 0) {
        if (connection.encrypted) {
          const state = this.airPlay2EncryptedControlState;
          if (!state) {
            throw new Error('Encrypted AirPlay 2 control frame arrived before control encryption was ready.');
          }
          if (connection.buffer.length < 2) {
            return;
          }
          const payloadLength = connection.buffer.readUInt16LE(0);
          if (payloadLength > airPlay2EncryptedFrameLimitBytes) {
            throw new Error(`AirPlay 2 encrypted control frame is too large: ${payloadLength}.`);
          }
          const frameLength = 2 + payloadLength + 16;
          if (connection.buffer.length < frameLength) {
            return;
          }
          const frame = connection.buffer.subarray(0, frameLength);
          connection.lastFrameSummary = summarizeAirPlay2EncryptedControlFrame(frame);
          connection.buffer = connection.buffer.subarray(frameLength);
          const decrypted = this.decryptAirPlay2ControlFrame(socket, connection, state, frame);
          const plaintext = decrypted.plaintext;
          connection.cipher.readCounter += 1;
          connection.lastFrameSummary = `${connection.lastFrameSummary} key=${decrypted.state.keyLabel} counter=${decrypted.counter} plaintext=${summarizeBuffer(plaintext)}`;
          connection.plaintextBuffer = Buffer.concat([connection.plaintextBuffer, plaintext]);
          let handledEncryptedRequest = false;
          while (connection.plaintextBuffer.length > 0) {
            const parsed = parseAirPlay2TextRequest(connection.plaintextBuffer);
            if (!parsed) {
              break;
            }
            connection.plaintextBuffer = connection.plaintextBuffer.subarray(parsed.consumed);
            connection.lastFrameSummary = `${connection.lastFrameSummary} request=${parsed.request.method} ${parsed.request.path} consumed=${parsed.consumed} remainingPlain=${connection.plaintextBuffer.length}`;
            const response = await this.handleAirPlay2ProbeRequest(parsed.request);
            const serialized = serializeAirPlay2ProbeResponse(parsed.request, response);
            const writeCounter = connection.cipher.writeCounter + connection.cipher.writeCounterOffset;
            socket.write(encryptAirPlay2ControlFrame(decrypted.state.controlReadKey, writeCounter, serialized));
            connection.cipher.writeCounter += 1;
            handledEncryptedRequest = true;
          }
          if (!handledEncryptedRequest) {
            connection.lastFrameSummary = `${connection.lastFrameSummary} waitingPlain=${summarizeBuffer(connection.plaintextBuffer)} prefix=${summarizeBufferPrefix(connection.plaintextBuffer, 48)}`;
          }
          continue;
        }

        const parsed = parseAirPlay2TextRequest(connection.buffer);
        if (!parsed) {
          return;
        }
        connection.buffer = connection.buffer.subarray(parsed.consumed);
        const response = await this.handleAirPlay2ProbeRequest(parsed.request);
        socket.write(serializeAirPlay2ProbeResponse(parsed.request, response));
        if (response.encryptedAfterWrite) {
          connection.encrypted = true;
          connection.cipher = { readCounter: 0, writeCounter: 0, readCounterOffset: 0, writeCounterOffset: 0 };
          connection.plaintextBuffer = Buffer.alloc(0);
          connection.lastFrameSummary = 'encrypted control enabled after response';
          this.addDebugEvent('crypto', `Encrypted AirPlay 2 control enabled socket=${airPlay2SocketPeer(socket)} key=${this.airPlay2EncryptedControlState?.keyLabel ?? 'unknown'} candidates=${this.airPlay2EncryptedControlCandidates.length}`, {
            method: 'ENC',
            path: parsed.request.path,
            statusCode: 200,
            remoteAddress: airPlay2SocketPeer(socket),
          });
        }
      }
    } catch (error) {
      const context = connection.encrypted
        ? [
          `socket=${airPlay2SocketPeer(socket)}`,
          `readCounter=${connection.cipher.readCounter}`,
          `readOffset=${connection.cipher.readCounterOffset}`,
          `writeCounter=${connection.cipher.writeCounter}`,
          `writeOffset=${connection.cipher.writeCounterOffset}`,
          `buffer=${summarizeBuffer(connection.buffer)}`,
          `plainBuffer=${summarizeBuffer(connection.plaintextBuffer)}`,
          `keyState=${this.airPlay2EncryptedControlState ? 'ready' : 'missing'}`,
          connection.lastFrameSummary ? `lastFrame=[${connection.lastFrameSummary}]` : 'lastFrame=none',
        ].join(' ')
        : `socket=${airPlay2SocketPeer(socket)} buffer=${summarizeBuffer(connection.buffer)} prefix=${summarizeBufferPrefix(connection.buffer, 48)}`;
      this.addDebugEvent('probe-error', `${error instanceof Error ? error.message : String(error)}; ${context}`, {
        method: connection.encrypted ? 'ENC' : 'TCP',
        path: '/airplay2',
        statusCode: 400,
        remoteAddress: airPlay2SocketPeer(socket),
      });
      socket.end();
    } finally {
      connection.draining = false;
      if (connection.buffer.length > 0 && !socket.destroyed) {
        void this.drainAirPlay2TcpConnection(socket, connection);
      }
    }
  }

  private decryptAirPlay2ControlFrame(
    socket: Socket,
    connection: AirPlay2TcpConnection,
    state: AirPlay2EncryptedControlState,
    frame: Buffer,
  ): { plaintext: Buffer; state: AirPlay2EncryptedControlState; counter: number } {
    const candidates = [state, ...this.airPlay2EncryptedControlCandidates];
    const errors: string[] = [];
    for (const candidate of candidates) {
      for (const offset of [...new Set([connection.cipher.readCounterOffset, 0, 1, 2])]) {
        const counter = connection.cipher.readCounter + offset;
        try {
          const plaintext = decryptAirPlay2ControlFrame(candidate.controlWriteKey, counter, frame);
          if (candidate !== state || offset !== connection.cipher.readCounterOffset) {
            this.airPlay2EncryptedControlState = candidate;
            this.airPlay2EncryptedControlCandidates = this.airPlay2EncryptedControlCandidates.filter((item) => item !== candidate);
            connection.cipher.readCounterOffset = offset;
            connection.cipher.writeCounterOffset = offset;
            this.addDebugEvent(
              'crypto',
              `Selected AirPlay 2 encrypted control key=${candidate.keyLabel}; counterOffset=${offset}; socket=${airPlay2SocketPeer(socket)}`,
              {
                method: 'ENC',
                path: '/airplay2',
                statusCode: 200,
                remoteAddress: airPlay2SocketPeer(socket),
              },
            );
          }
          return { plaintext, state: candidate, counter };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (offset === connection.cipher.readCounterOffset) {
            errors.push(`${candidate.keyLabel}@${counter}: ${message}`);
          }
        }
      }
    }

    throw new Error(
      `AirPlay 2 encrypted control frame did not verify with ${candidates.length} key candidate(s); ${errors.join(' | ')}`,
    );
  }

  private async handleAirPlay2ProbeRequest(request: AirPlay2ProbeRequest): Promise<AirPlay2ProbeResponse> {
    const { method, path, body } = request;
    const contentTypeText = request.headers['content-type'] ?? null;

    if (method === 'GET' && path === '/info') {
      if (request.protocol.startsWith('RTSP/') && body.length === 0 && !contentTypeText) {
        const responseBody = this.createAirPlay2InitialInfoPlist();
        this.addDebugEvent('info', 'AirPlay 2 initial info response sent', { method, path, statusCode: 200 });
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/x-apple-binary-plist' },
          body: responseBody,
        };
      }
      if (contentTypeText?.includes('application/x-apple-binary-plist') || body.subarray(0, 8).toString('ascii') === 'bplist00') {
        const responseBody = this.createAirPlay2InfoBplist();
        this.addDebugEvent('info', 'AirPlay 2 /info binary plist response sent', { method, path, statusCode: 200 });
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/x-apple-binary-plist' },
          body: responseBody,
        };
      }
      const responseBody = this.createAirPlay2InfoPlist();
      this.addDebugEvent('info', 'AirPlay 2 /info probe response sent', { method, path, statusCode: 200 });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/x-apple-plist+xml' },
        body: responseBody,
      };
    }

    if (method === 'OPTIONS') {
      this.addDebugEvent('options', 'AirPlay 2 OPTIONS probe response sent', { method, path, statusCode: 200 });
      return {
        statusCode: 200,
        headers: {
          Public: 'ANNOUNCE, SETUP, RECORD, PAUSE, FLUSH, TEARDOWN, OPTIONS, GET_PARAMETER, SET_PARAMETER, SETPEERS, GET, POST',
        },
      };
    }

    if (method === 'POST' && path === '/pair-setup') {
      return this.handleAirPlay2PairSetupRequest(method, path, contentTypeText, body);
    }

    if (method === 'POST' && path === '/pair-verify') {
      return this.handleAirPlay2PairVerifyRequest(method, path, contentTypeText, body);
    }

    if (method === 'POST' && path === '/fp-setup') {
      return this.handleAirPlay2FairPlaySetupRequest(method, path, body);
    }

    if (method === 'SETUP') {
      return this.handleAirPlay2SetupRequest(request);
    }

    if (method === 'RECORD') {
      this.addDebugEvent('record', 'AirPlay 2 RECORD acknowledged; RTP audio packets may follow', { method, path, statusCode: 200 });
      return { statusCode: 200, headers: { 'Audio-Latency': 0 } };
    }

    if (method === 'FLUSH' || method === 'FLUSHBUFFERED') {
      this.addDebugEvent('flush', request.headers['rtp-info'] ?? 'AirPlay 2 flush acknowledged', { method, path, statusCode: 200 });
      return { statusCode: 200 };
    }

    if (method === 'SET_PARAMETER') {
      return this.handleAirPlay2SetParameterRequest(request, contentTypeText);
    }

    if (method === 'GET_PARAMETER') {
      return this.handleAirPlay2GetParameterRequest(request, contentTypeText);
    }

    if (method === 'PAUSE') {
      await this.pauseAirPlay2ActivePlayback('AirPlay 2 PAUSE acknowledged');
      this.addDebugEvent('pause', 'AirPlay 2 PAUSE acknowledged', { method, path, statusCode: 200 });
      return { statusCode: 200 };
    }

    if (method === 'TEARDOWN') {
      return this.handleAirPlay2TeardownRequest(request, contentTypeText);
    }

    if (method === 'POST' && path === '/pair-setup-pin') {
      const summary = this.summarizeAirPlay2ProbeBody(path, contentTypeText, body);
      this.addDebugEvent('pairing', summary, { method, path, statusCode: 501 });
      return { statusCode: 501 };
    }

    if (
      (method === 'POST' && (path === '/feedback' || path === '/command' || path === '/audioMode')) ||
      method === 'SETPEERS'
    ) {
      const message = body.length > 0
        ? `AirPlay 2 probe request acknowledged; ${this.summarizeAirPlay2ProbeBody(path, contentTypeText, body)}`
        : 'AirPlay 2 probe request acknowledged';
      this.addDebugEvent('probe', message, { method, path, statusCode: 200 });
      return { statusCode: 200 };
    }

    this.addDebugEvent('probe', 'AirPlay 2 probe request is not implemented yet', { method, path, statusCode: 501 });
    return { statusCode: 501 };
  }

  private handleAirPlay2PairSetupRequest(
    method: string,
    path: string,
    contentType: string | null,
    body: Buffer,
  ): AirPlay2ProbeResponse {
    const parsed = parseAirPlay2Tlv(body);
    if (!parsed.fields) {
      this.addDebugEvent('pair-setup', `${contentType ? `content-type=${contentType}; ` : ''}${parsed.error}`, { method, path, statusCode: 400 });
      return { statusCode: 400 };
    }

    const state = getAirPlay2TlvByte(parsed.fields, 6);
    if (state === 1) {
      return this.handleAirPlay2PairSetupM1(method, path, parsed.fields);
    }
    if (state === 3) {
      return this.handleAirPlay2PairSetupM3(method, path, parsed.fields);
    }
    if (state === 5) {
      return this.handleAirPlay2PairSetupM5(method, path, parsed.fields);
    }

    const summary = this.summarizeAirPlay2ProbeBody(path, contentType, body);
    this.addDebugEvent('pair-setup', `unsupported state=${state ?? 'missing'}; ${summary}`, { method, path, statusCode: 501 });
    return { statusCode: 501 };
  }

  private handleAirPlay2PairVerifyRequest(
    method: string,
    path: string,
    contentType: string | null,
    body: Buffer,
  ): AirPlay2ProbeResponse {
    const parsed = parseAirPlay2Tlv(body);
    if (!parsed.fields) {
      this.addDebugEvent('pair-verify', `${contentType ? `content-type=${contentType}; ` : ''}${parsed.error}`, { method, path, statusCode: 400 });
      return { statusCode: 400 };
    }

    const state = getAirPlay2TlvByte(parsed.fields, 6);
    if (state === 1) {
      return this.handleAirPlay2PairVerifyM1(method, path, parsed.fields);
    }
    if (state === 3) {
      return this.handleAirPlay2PairVerifyM3(method, path, parsed.fields);
    }

    this.addDebugEvent('pair-verify', `unsupported state=${state ?? 'missing'}`, { method, path, statusCode: 400 });
    return { statusCode: 400 };
  }

  private async handleAirPlay2SetupRequest(request: AirPlay2ProbeRequest): Promise<AirPlay2ProbeResponse> {
    const setupStreams = parseAirPlay2SetupStreams(request.body);
    const isStreamSetup = setupStreams.streams.length > 0 || request.body.includes(Buffer.from('streams', 'ascii'));
    if (setupStreams.error && request.body.subarray(0, 8).toString('ascii') === 'bplist00') {
      this.addDebugEvent('setup', `AirPlay 2 setup plist parse failed: ${setupStreams.error}`, {
        method: request.method,
        path: request.path,
        statusCode: null,
      });
    }
    if (isStreamSetup) {
      return this.handleAirPlay2StreamSetup(request, setupStreams.streams[0] ?? null);
    }
    return this.handleAirPlay2SessionSetup(request);
  }

  private handleAirPlay2SetParameterRequest(
    request: AirPlay2ProbeRequest,
    contentType: string | null,
  ): AirPlay2ProbeResponse {
    const contentTypeLower = contentType?.toLowerCase() ?? '';
    const details: string[] = [];
    if (contentTypeLower.includes('text/parameters')) {
      const parameters = parseAirPlayTextParameters(request.body);
      if (parameters.volume !== undefined) {
        const volume = normalizeVolume(parameters.volume);
        void Promise.resolve(this.audioSession.setOutput({ volume: volume / 100 })).catch(() => undefined);
        this.setStatus({ volume });
        details.push(`volume=${volume}`);
      }
      const progress = parseAirPlayProgressParameter(
        parameters.progress,
        this.airPlay2StreamState?.pcmFormat?.sampleRate ?? this.airPlay2StreamState?.alacFormat?.sampleRate ?? defaultSampleRate,
      );
      if (progress) {
        this.setPositionAnchor(progress.positionSeconds, progress.durationSeconds);
        this.setStatus({
          positionSeconds: progress.positionSeconds,
          durationSeconds: progress.durationSeconds,
        });
        details.push(`progress=${progress.positionSeconds.toFixed(3)}/${progress.durationSeconds.toFixed(3)}`);
      }
    } else if (contentTypeLower.startsWith('image/')) {
      this.applyArtworkEvent({
        type: 'artwork',
        data: request.body,
        mimeType: contentTypeLower,
      });
      details.push(`artwork=${request.body.length}b`);
    }

    const message = details.length > 0
      ? `AirPlay 2 SET_PARAMETER applied; ${details.join(' ')}`
      : request.body.length > 0
        ? `AirPlay 2 SET_PARAMETER acknowledged; ${this.summarizeAirPlay2ProbeBody(request.path, contentType, request.body)}`
        : 'AirPlay 2 SET_PARAMETER acknowledged';
    this.addDebugEvent('set-parameter', message, {
      method: request.method,
      path: request.path,
      statusCode: 200,
    });
    return { statusCode: 200 };
  }

  private handleAirPlay2GetParameterRequest(
    request: AirPlay2ProbeRequest,
    contentType: string | null,
  ): AirPlay2ProbeResponse {
    const contentTypeLower = contentType?.toLowerCase() ?? '';
    if (!contentTypeLower.includes('text/parameters')) {
      this.addDebugEvent('get-parameter', 'AirPlay 2 GET_PARAMETER acknowledged', {
        method: request.method,
        path: request.path,
        statusCode: 200,
      });
      return { statusCode: 200 };
    }

    const requested = new Set(parseAirPlayRequestedParameters(request.body));
    const responseLines: string[] = [];
    if (requested.has('volume')) {
      responseLines.push(`volume: ${volumePercentToAirPlayDb(this.status.volume)}`);
    }
    if (requested.has('progress')) {
      const sampleRate = this.airPlay2StreamState?.pcmFormat?.sampleRate ?? this.airPlay2StreamState?.alacFormat?.sampleRate ?? defaultSampleRate;
      const currentFrame = Math.max(0, Math.round(this.estimatePosition(this.status) * sampleRate));
      const endFrame = this.status.durationSeconds > 0
        ? Math.max(currentFrame, Math.round(this.status.durationSeconds * sampleRate))
        : currentFrame;
      responseLines.push(`progress: 0/${currentFrame}/${endFrame}`);
    }
    const body = responseLines.length > 0 ? `${responseLines.join('\r\n')}\r\n` : '';
    this.addDebugEvent(
      'get-parameter',
      responseLines.length > 0
        ? `AirPlay 2 GET_PARAMETER response; ${responseLines.join(' ')}`
        : 'AirPlay 2 GET_PARAMETER response empty',
      { method: request.method, path: request.path, statusCode: 200 },
    );
    return {
      statusCode: 200,
      headers: body ? { 'Content-Type': 'text/parameters' } : undefined,
      body,
    };
  }

  private async handleAirPlay2SessionSetup(request: AirPlay2ProbeRequest): Promise<AirPlay2ProbeResponse> {
    const setupInfo = parseAirPlay2SetupSessionInfo(request.body);
    if (setupInfo.error && request.body.subarray(0, 8).toString('ascii') === 'bplist00') {
      this.addDebugEvent('setup', `AirPlay 2 session setup plist parse failed: ${setupInfo.error}`, {
        method: request.method,
        path: request.path,
        statusCode: 400,
      });
      return { statusCode: 400 };
    }
    this.airPlay2SessionSetupInfo = setupInfo.info;
    const eventPort = await this.ensureAirPlay2EventServer();
    const body = encodeAirPlay2Bplist({
      eventPort,
      timingPort: 0,
      timingPeerInfo: {
        Addresses: [this.advertisedInterface?.address ?? '127.0.0.1'],
        ID: this.airPlay2DeviceIdentifier(),
      },
    });
    this.addDebugEvent('setup', `AirPlay 2 session setup acknowledged; eventPort=${eventPort} timingPort=0; ${summarizeAirPlay2SessionSetupInfo(setupInfo.info)}`, {
      method: request.method,
      path: request.path,
      statusCode: 200,
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/x-apple-binary-plist' },
      body,
    };
  }

  private async handleAirPlay2TeardownRequest(
    request: AirPlay2ProbeRequest,
    contentType: string | null,
  ): Promise<AirPlay2ProbeResponse> {
    const { method, path, body } = request;
    const setupStreams = body.length > 0 ? parseAirPlay2SetupStreams(body) : { streams: [], error: null };
    if (setupStreams.error && body.subarray(0, 8).toString('ascii') === 'bplist00') {
      this.addDebugEvent('teardown', `AirPlay 2 teardown plist parse failed: ${setupStreams.error}`, {
        method,
        path,
        statusCode: null,
      });
    }

    if (setupStreams.streams.length > 0) {
      await this.pauseAirPlay2ActivePlayback(
        `AirPlay 2 TEARDOWN paused active stream; ${setupStreams.streams.map(summarizeAirPlay2SetupStream).join('; ')}`,
      );
      this.addDebugEvent('teardown', 'AirPlay 2 TEARDOWN acknowledged as pause; stream ports retained', {
        method,
        path,
        statusCode: 200,
      });
      return { statusCode: 200 };
    }

    await this.stopAirPlay2SessionResources();
    await this.stopAirPlay2ActivePlayback('AirPlay 2 TEARDOWN disconnected');
    this.addDebugEvent('teardown', body.length > 0 ? this.summarizeAirPlay2ProbeBody(path, contentType, body) : 'AirPlay 2 teardown disconnected', {
      method,
      path,
      statusCode: 200,
    });
    return { statusCode: 200 };
  }

  private async handleAirPlay2StreamSetup(
    request: AirPlay2ProbeRequest,
    streamInfo: AirPlay2SetupStreamInfo | null,
  ): Promise<AirPlay2ProbeResponse> {
    if (streamInfo?.type !== null && streamInfo?.type !== 96) {
      this.addDebugEvent(
        'setup',
        `AirPlay 2 stream setup rejected; ${summarizeAirPlay2SetupStream(streamInfo)}; supported path requires realtime stream type 96`,
        { method: request.method, path: request.path, statusCode: 501 },
      );
      return { statusCode: 501 };
    }

    const compressionType = streamInfo?.compressionType ?? null;
    let pcmFormat = resolveAirPlay2PcmFormat(streamInfo);
    let alacFormat = resolveAirPlay2AlacFormat(streamInfo);
    if (compressionType === 1) {
      alacFormat = null;
    } else if (compressionType === 2) {
      pcmFormat = null;
    } else if (compressionType !== null) {
      this.addDebugEvent(
        'setup',
        `AirPlay 2 stream setup rejected; ${summarizeAirPlay2SetupStream(streamInfo)}; supported path requires LPCM ct=1 or ALAC ct=2`,
        { method: request.method, path: request.path, statusCode: 501 },
      );
      return { statusCode: 501 };
    }

    if (!pcmFormat && !alacFormat) {
      this.addDebugEvent(
        'setup',
        `AirPlay 2 stream setup rejected; ${summarizeAirPlay2SetupStream(streamInfo)}; supported path requires realtime LPCM or ALAC`,
        { method: request.method, path: request.path, statusCode: 501 },
      );
      return { statusCode: 501 };
    }
    if (!streamInfo?.sharedKey || streamInfo.sharedKey.length !== 32) {
      this.addDebugEvent(
        'setup',
        `AirPlay 2 stream setup rejected; ${summarizeAirPlay2SetupStream(streamInfo)}; supported RTP path requires a 32-byte shared key`,
        { method: request.method, path: request.path, statusCode: 501 },
      );
      return { statusCode: 501 };
    }

    let alacDecoder: AirPlay2AlacDecoder | null = null;
    if (alacFormat) {
      try {
        alacDecoder = await this.createAirPlay2AlacDecoder(alacFormat);
      } catch (error) {
        this.addDebugEvent(
          'setup',
          `AirPlay 2 stream setup rejected; ${summarizeAirPlay2SetupStream(streamInfo)}; ALAC decoder unavailable: ${error instanceof Error ? error.message : String(error)}`,
          { method: request.method, path: request.path, statusCode: 501 },
        );
        return { statusCode: 501 };
      }
    }

    const controlPort = await this.ensureAirPlay2UdpListener('control');
    const dataPort = await this.ensureAirPlay2UdpListener('data');
    this.closeAirPlay2StreamState();
    this.airPlay2StreamState = {
      dataPort,
      controlPort,
      streamType: streamInfo?.type ?? null,
      compressionType: streamInfo?.compressionType ?? null,
      audioFormat: streamInfo?.audioFormat ?? null,
      framesPerPacket: streamInfo?.framesPerPacket ?? null,
      sharedKey: streamInfo?.sharedKey ?? null,
      pcmFormat,
      alacFormat,
      alacDecoder,
      packetCount: 0,
      byteCount: 0,
      decryptedPacketCount: 0,
      decodedPacketCount: 0,
      decryptFailureCount: 0,
      firstPacketAt: null,
      lastSequenceNumber: null,
      lastTimestamp: null,
    };
    const body = encodeAirPlay2Bplist({
      streams: [
        {
          type: 96,
          controlPort,
          dataPort,
        },
      ],
    });
    const codec = alacFormat ? 'ALAC' : 'LPCM';
    this.addDebugEvent('setup', `AirPlay 2 stream setup acknowledged; dataPort=${dataPort} controlPort=${controlPort}; ${summarizeAirPlay2SetupStream(streamInfo)}; encrypted ${codec} RTP ready`, {
      method: request.method,
      path: request.path,
      statusCode: 200,
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/x-apple-binary-plist' },
      body,
    };
  }

  private async ensureAirPlay2EventServer(): Promise<number> {
    if (this.airPlay2EventServer && this.airPlay2EventPort) {
      return this.airPlay2EventPort;
    }
    const server = createTcpServer((socket) => {
      socket.on('data', (chunk) => {
        this.addDebugEvent('event', `AirPlay 2 event channel data ${summarizeBuffer(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))}`);
      });
      socket.on('error', (error) => {
        this.addDebugEvent('event', error.message);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('AirPlay 2 event server did not bind to a TCP port.');
    }
    this.airPlay2EventServer = server;
    this.airPlay2EventPort = address.port;
    return address.port;
  }

  private async ensureAirPlay2UdpListener(kind: 'data' | 'control'): Promise<number> {
    const existing = this.airPlay2UdpListeners.find((listener) => listener.kind === kind);
    if (existing) {
      return existing.port;
    }
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', (message, remote) => {
      this.handleAirPlay2UdpPacket(kind, message, remote);
    });
    socket.on('error', (error) => {
      this.addDebugEvent(kind === 'data' ? 'rtp' : 'rtcp', error.message, {
        method: 'UDP',
        path: `/airplay2/${kind}`,
        statusCode: null,
      });
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, () => {
        socket.off('error', reject);
        resolve();
      });
    });
    const address = socket.address();
    if (!address || typeof address === 'string') {
      socket.close();
      throw new Error(`AirPlay 2 ${kind} UDP listener did not bind to a port.`);
    }
    this.airPlay2UdpListeners.push({ kind, socket, port: address.port });
    return address.port;
  }

  private handleAirPlay2UdpPacket(kind: 'data' | 'control', message: Buffer, remote: RemoteInfo): void {
    if (kind === 'control') {
      this.addDebugEvent('rtcp', `${remote.address}:${remote.port} ${summarizeBuffer(message)}`, {
        method: 'UDP',
        path: '/airplay2/control',
        statusCode: null,
      });
      return;
    }

    const packet = parseAirPlay2RtpPacket(message);
    if (!packet) {
      this.addDebugEvent('rtp', `${remote.address}:${remote.port} invalid RTP ${summarizeBuffer(message)}`, {
        method: 'UDP',
        path: '/airplay2/data',
        statusCode: null,
      });
      return;
    }

    const state = this.airPlay2StreamState;
    if (state) {
      const previousSequence = state.lastSequenceNumber;
      state.packetCount += 1;
      state.byteCount += message.length;
      state.firstPacketAt ??= this.now();
      state.lastSequenceNumber = packet.sequenceNumber;
      state.lastTimestamp = packet.timestamp;
      const expectedSequence = previousSequence === null ? null : (previousSequence + 1) & 0xffff;
      const hasGap = expectedSequence !== null && packet.sequenceNumber !== expectedSequence;
      const gap = hasGap ? ` gap=${previousSequence}->${packet.sequenceNumber}` : '';
      let decryptSummary = state.sharedKey ? 'decrypted=pending' : 'shk=missing';
      let decryptFailedNow = false;
      if (state.sharedKey) {
        try {
          const decrypted = decryptAirPlay2RtpPayload(packet, state.sharedKey);
          state.decryptedPacketCount += 1;
          decryptSummary = `decrypted=${decrypted.length}b`;
          if (state.pcmFormat) {
            this.writeAirPlay2LpcmPayload(decrypted, state, remote);
            decryptSummary += '; pcm=f32le';
          } else if (state.alacDecoder && state.alacFormat) {
            const pcm = state.alacDecoder.decodeFrame(decrypted);
            if (pcm.length > 0) {
              state.decodedPacketCount += 1;
              this.writeAirPlay2S16lePayload(pcm, state, remote, 'ALAC');
              decryptSummary += `; alacPcm=${pcm.length}b; pcm=f32le`;
            } else {
              decryptSummary += '; alacPcm=0b';
            }
          }
        } catch (error) {
          state.decryptFailureCount += 1;
          decryptFailedNow = true;
          decryptSummary = `decryptFailed=${state.decryptFailureCount}:${error instanceof Error ? error.message : String(error)}`;
        }
      }
      if (state.packetCount === 1 || state.packetCount % 64 === 0 || hasGap || (decryptFailedNow && state.decryptFailureCount <= 3)) {
        this.addDebugEvent(
          'rtp',
          `${remote.address}:${remote.port} packets=${state.packetCount} bytes=${state.byteCount} decryptedPackets=${state.decryptedPacketCount} decodedPackets=${state.decodedPacketCount}${gap}; ${summarizeAirPlay2RtpPacket(packet)}; ${decryptSummary}`,
          { method: 'UDP', path: '/airplay2/data', statusCode: null },
        );
      }
      return;
    }

    this.addDebugEvent('rtp', `${remote.address}:${remote.port} no stream state; ${summarizeAirPlay2RtpPacket(packet)}`, {
      method: 'UDP',
      path: '/airplay2/data',
      statusCode: null,
    });
  }

  private writeAirPlay2LpcmPayload(decrypted: Buffer, state: AirPlay2StreamState, remote: RemoteInfo): void {
    if (!state.pcmFormat || decrypted.length === 0) {
      return;
    }

    if (!this.currentSourceId || !this.pcmStream) {
      this.prepareIncomingStream({ type: 'stream', remoteAddress: remote.address });
      this.addDebugEvent(
        'pcm',
        `AirPlay 2 LPCM started ${state.pcmFormat.sampleRate}/${state.pcmFormat.bitDepth}/${state.pcmFormat.channels}`,
      );
    }

    if (!this.currentSourceId || !this.pcmStream) {
      return;
    }

    if (!this.pcmPlaybackStarted) {
      this.pcmPlaybackStarted = true;
      const stream = this.pcmStream;
      const sourceId = this.currentSourceId;
      const { sampleRate, channels } = state.pcmFormat;
      void this.audioSession
        .playPcmStream({
          stream,
          sourceId,
          trackId: sourceId,
          sampleRate,
          channels,
          durationSeconds: this.status.durationSeconds,
          output: createAirPlayOutputSettings(),
        })
        .then(() => {
          if (this.currentSourceId === sourceId) {
            this.setStatus({ state: 'playing', error: null });
          }
        })
        .catch((error) => {
          if (this.currentSourceId === sourceId) {
            this.setStatus({
              state: 'error',
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
    }

    const converted = convertAirPlay2LpcmToF32le(decrypted, state.pcmFormat);
    if (converted.length > 0 && !this.pcmStream.write(converted)) {
      this.addDebugEvent('pcm', 'backpressure');
    }
  }

  private writeAirPlay2S16lePayload(
    pcm: Buffer,
    state: AirPlay2StreamState,
    remote: RemoteInfo,
    codec: string,
  ): void {
    const format = state.alacFormat;
    if (!format || pcm.length === 0) {
      return;
    }

    if (!this.currentSourceId || !this.pcmStream) {
      this.prepareIncomingStream({ type: 'stream', remoteAddress: remote.address });
      this.addDebugEvent(
        'pcm',
        `AirPlay 2 ${codec} started ${format.sampleRate}/${format.bitDepth}/${format.channels}`,
      );
    }

    if (!this.currentSourceId || !this.pcmStream) {
      return;
    }

    if (!this.pcmPlaybackStarted) {
      this.pcmPlaybackStarted = true;
      const stream = this.pcmStream;
      const sourceId = this.currentSourceId;
      const { sampleRate, channels } = format;
      void this.audioSession
        .playPcmStream({
          stream,
          sourceId,
          trackId: sourceId,
          sampleRate,
          channels,
          durationSeconds: this.status.durationSeconds,
          output: createAirPlayOutputSettings(),
        })
        .then(() => {
          if (this.currentSourceId === sourceId) {
            this.setStatus({ state: 'playing', error: null });
          }
        })
        .catch((error) => {
          if (this.currentSourceId === sourceId) {
            this.setStatus({
              state: 'error',
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
    }

    const evenLength = pcm.length - (pcm.length % 2);
    const converted = convertS16leToF32le(evenLength === pcm.length ? pcm : pcm.subarray(0, evenLength));
    if (converted.length > 0 && !this.pcmStream.write(converted)) {
      this.addDebugEvent('pcm', 'backpressure');
    }
  }

  private handleAirPlay2PairSetupM1(
    method: string,
    path: string,
    fields: Map<number, Buffer[]>,
  ): AirPlay2ProbeResponse {
    try {
      const requestMethod = getAirPlay2TlvByte(fields, 0);
      const flags = getAirPlay2TlvValue(fields, 19);
      const flagsValue = airPlay2TlvNumber(flags);
      const transient = (flagsValue & airPlay2PairingFlagTransient) !== 0;
      const salt = randomBytes(16);
      const verifier = createAirPlay2SrpVerifier(salt);
      const privateKey = createAirPlay2SrpPrivateKey();
      const publicKey = createAirPlay2SrpServerPublicKey(verifier, privateKey);
      this.airPlay2PairSetupState = {
        salt,
        privateKey,
        publicKey,
        verifier,
        sessionKey: null,
        transient,
      };

      const responseFields: AirPlay2TlvField[] = [
        { type: 6, value: Buffer.from([2]) },
        { type: 2, value: salt },
        { type: 3, value: publicKey },
      ];
      if (flags) {
        responseFields.push({ type: 19, value: flags });
      }
      const flagSummary = flags ? ` flags=0x${flagsValue.toString(16)}` : '';
      const responseBody = encodeAirPlay2Tlv(responseFields);
      this.addDebugEvent(
        'pair-setup',
        `M1 accepted; M2 SRP salt/public key sent; pairMethod=${requestMethod ?? 'missing'}${flagSummary}`,
        { method, path, statusCode: 200 },
      );
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
        body: responseBody,
      };
    } catch (error) {
      this.addDebugEvent('pair-setup', error instanceof Error ? error.message : String(error), { method, path, statusCode: 400 });
      return { statusCode: 400 };
    }
  }

  private handleAirPlay2PairSetupM3(
    method: string,
    path: string,
    fields: Map<number, Buffer[]>,
  ): AirPlay2ProbeResponse {
    try {
      const state = this.airPlay2PairSetupState;
      if (!state) {
        throw new Error('Pair-Setup M3 arrived before a valid M1/M2 exchange.');
      }
      const clientPublicKey = getAirPlay2TlvValue(fields, 3);
      if (!clientPublicKey || clientPublicKey.length !== airPlay2SrpModulusBytes) {
        throw new Error(`Pair-Setup M3 missing ${airPlay2SrpModulusBytes}-byte SRP public key; got ${clientPublicKey?.length ?? 0}.`);
      }
      const clientProof = getAirPlay2TlvValue(fields, 4);
      if (!clientProof || clientProof.length !== 64) {
        throw new Error(`Pair-Setup M3 missing 64-byte SRP proof; got ${clientProof?.length ?? 0}.`);
      }

      const session = calculateAirPlay2SrpSession(
        state.salt,
        clientPublicKey,
        state.publicKey,
        state.privateKey,
        state.verifier,
      );
      if (!timingSafeEqual(clientProof, session.clientProof)) {
        throw new Error('Pair-Setup M3 SRP proof did not verify.');
      }

      state.sessionKey = session.sessionKey;
      if (state.transient) {
        const controlStates = uniqueAirPlay2EncryptedControlStates([
          ...createAirPlay2PairVerifyControlStates(this.airPlay2PairVerifyState),
          ...createAirPlay2TransientControlStates(session),
        ]);
        this.airPlay2EncryptedControlState = controlStates[0] ?? null;
        this.airPlay2EncryptedControlCandidates = controlStates.slice(1);
      }
      const responseBody = encodeAirPlay2Tlv([
        { type: 6, value: Buffer.from([4]) },
        { type: 4, value: session.serverProof },
      ]);
      this.addDebugEvent(
        'pair-setup',
        state.transient
          ? `M3 SRP proof verified; M4 accessory proof sent; transient control channel ready key=${this.airPlay2EncryptedControlState?.keyLabel ?? 'missing'} candidates=${this.airPlay2EncryptedControlCandidates.length}`
          : 'M3 SRP proof verified; M4 accessory proof sent',
        { method, path, statusCode: 200 },
      );
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
        body: responseBody,
        encryptedAfterWrite: state.transient,
      };
    } catch (error) {
      this.addDebugEvent('pair-setup', error instanceof Error ? error.message : String(error), { method, path, statusCode: 400 });
      return { statusCode: 400 };
    }
  }

  private handleAirPlay2PairSetupM5(
    method: string,
    path: string,
    fields: Map<number, Buffer[]>,
  ): AirPlay2ProbeResponse {
    try {
      const state = this.airPlay2PairSetupState;
      if (!state?.sessionKey) {
        throw new Error('Pair-Setup M5 arrived before a verified SRP session.');
      }
      const encryptedData = getAirPlay2TlvValue(fields, 5);
      if (!encryptedData) {
        throw new Error('Pair-Setup M5 missing encrypted data.');
      }

      const encryptionKey = deriveAirPlay2Key(state.sessionKey, airPlay2PairSetupEncryptSalt, airPlay2PairSetupEncryptInfo);
      const decrypted = decryptAirPlay2Payload(encryptionKey, 'PS-Msg05', encryptedData);
      const clientFields = parseAirPlay2Tlv(decrypted);
      if (!clientFields.fields) {
        throw new Error(clientFields.error);
      }
      const clientIdentifier = getAirPlay2TlvValue(clientFields.fields, 1);
      const clientPublicKey = getAirPlay2TlvValue(clientFields.fields, 3);
      const clientSignature = getAirPlay2TlvValue(clientFields.fields, 10);
      if (!clientIdentifier) {
        throw new Error('Pair-Setup M5 missing client identifier.');
      }
      if (!clientPublicKey || clientPublicKey.length !== 32) {
        throw new Error(`Pair-Setup M5 missing 32-byte client public key; got ${clientPublicKey?.length ?? 0}.`);
      }
      if (!clientSignature || clientSignature.length !== 64) {
        throw new Error(`Pair-Setup M5 missing 64-byte client signature; got ${clientSignature?.length ?? 0}.`);
      }

      const controllerSigningKey = deriveAirPlay2Key(
        state.sessionKey,
        airPlay2PairSetupControllerSignSalt,
        airPlay2PairSetupControllerSignInfo,
      );
      const signedClientInfo = Buffer.concat([controllerSigningKey, clientIdentifier, clientPublicKey]);
      if (!verify(null, signedClientInfo, createEd25519PublicKey(clientPublicKey), clientSignature)) {
        throw new Error('Pair-Setup M5 client signature did not verify.');
      }

      const accessoryIdentifier = Buffer.from(this.airPlay2DeviceIdentifier(), 'utf8');
      const accessorySigningKey = deriveAirPlay2Key(
        state.sessionKey,
        airPlay2PairSetupAccessorySignSalt,
        airPlay2PairSetupAccessorySignInfo,
      );
      const accessorySignature = sign(
        null,
        Buffer.concat([accessorySigningKey, accessoryIdentifier, this.airPlay2Identity.publicKey]),
        this.airPlay2Identity.privateKey,
      );
      const accessoryData = encodeAirPlay2Tlv([
        { type: 1, value: accessoryIdentifier },
        { type: 3, value: this.airPlay2Identity.publicKey },
        { type: 10, value: accessorySignature },
      ]);
      const responseBody = encodeAirPlay2Tlv([
        { type: 6, value: Buffer.from([6]) },
        { type: 5, value: encryptAirPlay2Payload(encryptionKey, 'PS-Msg06', accessoryData) },
      ]);
      this.addDebugEvent(
        'pair-setup',
        `M5 controller signature verified for ${clientIdentifier.toString('utf8')}; M6 accessory identity sent`,
        { method, path, statusCode: 200 },
      );
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
        body: responseBody,
      };
    } catch (error) {
      this.addDebugEvent('pair-setup', error instanceof Error ? error.message : String(error), { method, path, statusCode: 400 });
      return { statusCode: 400 };
    }
  }

  private handleAirPlay2FairPlaySetupRequest(
    method: string,
    path: string,
    body: Buffer,
  ): AirPlay2ProbeResponse {
    try {
      if (body.length < 16 || body.subarray(0, 4).toString('ascii') !== 'FPLY') {
        throw new Error(`FairPlay setup body is not an FPLY message: ${summarizeBuffer(body)}.`);
      }
      const majorVersion = body[4];
      const messageType = body[5];
      const sequence = body[6];
      if (majorVersion !== 3 || messageType !== 1) {
        throw new Error(`Unsupported FairPlay setup message version=${majorVersion} type=${messageType}.`);
      }

      if (sequence === 1) {
        const mode = body[14];
        const responseBody = airPlay2FairPlaySetup1Responses[mode];
        if (!responseBody) {
          throw new Error(`Unsupported FairPlay setup mode=${mode}; expected 0-3.`);
        }
        this.airPlay2FairPlayState = { keyMessage: null };
        this.addDebugEvent('fp-setup', `FairPlay setup seq=1 mode=${mode} response sent`, { method, path, statusCode: 200 });
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
          body: responseBody,
        };
      }

      if (sequence === 3) {
        if (body.length < airPlay2FairPlaySetup2SuffixBytes) {
          throw new Error(`FairPlay setup seq=3 body too short: ${body.length}.`);
        }
        this.airPlay2FairPlayState = { keyMessage: Buffer.from(body) };
        const suffix = body.subarray(body.length - airPlay2FairPlaySetup2SuffixBytes);
        const responseBody = Buffer.concat([airPlay2FairPlaySetup2ResponsePrefix, suffix]);
        this.addDebugEvent('fp-setup', `FairPlay setup seq=3 key message captured (${body.length}b); response sent`, {
          method,
          path,
          statusCode: 200,
        });
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
          body: responseBody,
        };
      }

      throw new Error(`Unsupported FairPlay setup sequence=${sequence}.`);
    } catch (error) {
      this.addDebugEvent('fp-setup', error instanceof Error ? error.message : String(error), { method, path, statusCode: 501 });
      return { statusCode: 501 };
    }
  }

  private handleAirPlay2PairVerifyM1(
    method: string,
    path: string,
    fields: Map<number, Buffer[]>,
  ): AirPlay2ProbeResponse {
    try {
      const clientPublicKey = getAirPlay2TlvValue(fields, 3);
      if (!clientPublicKey || clientPublicKey.length !== 32) {
        throw new Error(`Pair-Verify M1 missing 32-byte client public key; got ${clientPublicKey?.length ?? 0}.`);
      }

      const serverKeys = generateKeyPairSync('x25519');
      const serverPublicKey = exportX25519PublicKey(serverKeys.publicKey);
      const sharedSecret = diffieHellman({
        privateKey: serverKeys.privateKey,
        publicKey: createX25519PublicKey(clientPublicKey),
      });
      const sessionKey = deriveAirPlay2Key(sharedSecret, airPlay2PairVerifySalt, airPlay2PairVerifyInfo);
      const deviceIdentifier = this.airPlay2DeviceIdentifier();
      const signature = sign(
        null,
        Buffer.concat([serverPublicKey, Buffer.from(deviceIdentifier, 'utf8'), clientPublicKey]),
        this.airPlay2Identity.privateKey,
      );
      const encryptedData = encryptAirPlay2Payload(
        sessionKey,
        'PV-Msg02',
        encodeAirPlay2Tlv([
          { type: 1, value: Buffer.from(deviceIdentifier, 'utf8') },
          { type: 10, value: signature },
        ]),
      );

      this.airPlay2PairVerifyState = {
        clientPublicKey,
        serverPublicKey,
        sessionKey,
        controlReadKey: deriveAirPlay2Key(sharedSecret, airPlay2ControlSalt, 'Control-Read-Encryption-Key'),
        controlWriteKey: deriveAirPlay2Key(sharedSecret, airPlay2ControlSalt, 'Control-Write-Encryption-Key'),
      };

      const responseBody = encodeAirPlay2Tlv([
        { type: 6, value: Buffer.from([2]) },
        { type: 3, value: serverPublicKey },
        { type: 5, value: encryptedData },
      ]);
      this.addDebugEvent('pair-verify', 'M1 accepted; M2 response sent with signed accessory identity', { method, path, statusCode: 200 });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
        body: responseBody,
      };
    } catch (error) {
      this.addDebugEvent('pair-verify', error instanceof Error ? error.message : String(error), { method, path, statusCode: 400 });
      return { statusCode: 400 };
    }
  }

  private handleAirPlay2PairVerifyM3(
    method: string,
    path: string,
    fields: Map<number, Buffer[]>,
  ): AirPlay2ProbeResponse {
    try {
      const state = this.airPlay2PairVerifyState;
      if (!state) {
        throw new Error('Pair-Verify M3 arrived before a valid M1/M2 exchange.');
      }
      const encryptedData = getAirPlay2TlvValue(fields, 5);
      if (!encryptedData) {
        throw new Error('Pair-Verify M3 missing encrypted data.');
      }

      const decrypted = decryptAirPlay2Payload(state.sessionKey, 'PV-Msg03', encryptedData);
      const clientFields = parseAirPlay2Tlv(decrypted);
      if (!clientFields.fields) {
        throw new Error(clientFields.error);
      }
      const clientIdentifier = getAirPlay2TlvValue(clientFields.fields, 1)?.toString('utf8') ?? 'unknown client';
      const clientSignature = getAirPlay2TlvValue(clientFields.fields, 10);
      if (!clientSignature) {
        throw new Error('Pair-Verify M3 missing client signature.');
      }

      const responseBody = encodeAirPlay2Tlv([{ type: 6, value: Buffer.from([4]) }]);
      this.addDebugEvent(
        'pair-verify',
        `M3 decrypted for ${clientIdentifier}; M4 response sent; encrypted control channel ready`,
        { method, path, statusCode: 200 },
      );
      this.airPlay2EncryptedControlState = {
        controlReadKey: state.controlReadKey,
        controlWriteKey: state.controlWriteKey,
        keyLabel: 'pair-verify-shared-secret',
      };
      this.airPlay2EncryptedControlCandidates = [];
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
        body: responseBody,
        encryptedAfterWrite: true,
      };
    } catch (error) {
      this.addDebugEvent('pair-verify', error instanceof Error ? error.message : String(error), { method, path, statusCode: 400 });
      return { statusCode: 400 };
    }
  }

  private summarizeAirPlay2ProbeBody(path: string, contentType: string | null, body: Buffer): string {
    const type = contentType ? `content-type=${contentType}; ` : '';
    if (contentType?.includes('application/octet-stream') || path === '/pair-setup' || path === '/pair-verify') {
      return `${type}${summarizeAirPlay2Tlv(body) ?? `body=${summarizeBuffer(body)}`}`;
    }
    return `${type}body=${summarizeBuffer(body)}`;
  }

  private createAirPlay2InfoPlist(): string {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '<key>deviceID</key>',
      `<string>${this.airPlay2DeviceIdentifier()}</string>`,
      '<key>features</key>',
      `<integer>${airPlay2FeatureMask}</integer>`,
      '<key>manufacturer</key>',
      '<string>Moekotori</string>',
      '<key>model</key>',
      '<string>ECHO-Next-AirPlay-Spike</string>',
      '<key>name</key>',
      `<string>${this.escapePlistString(this.advertisedName)}</string>`,
      '<key>protovers</key>',
      '<string>1.1</string>',
      '<key>sourceVersion</key>',
      `<string>${airPlay2ProbeSourceVersion}</string>`,
      '<key>statusFlags</key>',
      '<integer>4</integer>',
      '<key>vv</key>',
      '<integer>2</integer>',
      '<key>audioFormats</key>',
      '<array>',
      `<dict><key>type</key><integer>100</integer><key>audioInputFormats</key><integer>${airPlay2SupportedAudioFormats}</integer><key>audioOutputFormats</key><integer>${airPlay2SupportedAudioFormats}</integer></dict>`,
      '</array>',
      '<key>audioLatencies</key>',
      '<array>',
      '<dict><key>type</key><integer>100</integer><key>audioType</key><string>default</string><key>inputLatencyMicros</key><integer>0</integer><key>outputLatencyMicros</key><integer>0</integer></dict>',
      '</array>',
      '</dict>',
      '</plist>',
      '',
    ].join('\n');
  }

  private createAirPlay2InfoBplist(): Buffer {
    return encodeAirPlay2Bplist({
      audioFormats: [
        {
          type: 100,
          audioInputFormats: airPlay2SupportedAudioFormats,
          audioOutputFormats: airPlay2SupportedAudioFormats,
        },
      ],
      audioLatencies: [
        {
          type: 100,
          audioType: 'default',
          inputLatencyMicros: 0,
          outputLatencyMicros: 0,
        },
      ],
      deviceID: this.airPlay2DeviceIdentifier(),
      features: airPlay2FeatureMask,
      keepAliveLowPower: true,
      keepAliveSendStatsAsBody: true,
      manufacturer: 'Moekotori',
      model: airPlayModel,
      name: this.advertisedName,
      nameIsFactoryDefault: false,
      pi: this.airPlay2PairingUuid('airplay'),
      protocolVersion: '1.1',
      psi: this.airPlay2PairingUuid('system'),
      pk: this.airPlay2Identity.publicKey,
      sourceVersion: airPlay2ProbeSourceVersion,
      statusFlags: 4,
      vv: 2,
    });
  }

  private createAirPlay2InitialInfoPlist(): Buffer {
    return encodeAirPlay2Bplist({
      initialVolume: volumePercentToAirPlayDb(this.status.volume),
    });
  }

  private escapePlistString(value: string): string {
    return value
      .replace(/&/gu, '&amp;')
      .replace(/</gu, '&lt;')
      .replace(/>/gu, '&gt;')
      .replace(/"/gu, '&quot;')
      .replace(/'/gu, '&apos;');
  }

  private airPlay2DeviceIdentifier(): string {
    return normalizeAirPlayDeviceId(this.advertisedInterface?.mac);
  }

  private airPlay2PairingUuid(suffix: string): string {
    return createAirPlay2PairingUuid(
      this.airPlay2DeviceIdentifier(),
      this.airPlay2Identity.publicKey.toString('hex'),
      suffix,
    );
  }

  private handleRaopEvent(event: RaopEvent): void {
    const type = trimText(event.type) ?? 'unknown';
    this.addDebugEvent(type, eventAddress(event) ?? '');

    switch (type) {
      case 'stream':
        this.clearHttpPcmReconnectTimer();
        this.prepareIncomingStream(event);
        if (this.useHttpPcmBridge) {
          this.startHttpPcmPlayback(event);
        } else {
          this.addDebugEvent('stream', 'using direct PCM events');
        }
        break;
      case 'metadata':
        this.applyMetadataEvent(event);
        break;
      case 'artwork':
        this.applyArtworkEvent(event);
        break;
      case 'pcm':
        this.handlePcmEvent(event);
        break;
      case 'play':
        this.setPositionAnchor(this.estimatePosition(this.status));
        this.setStatus({ state: 'playing' });
        break;
      case 'pause':
      case 'flush':
        this.setPositionAnchor(this.estimatePosition(this.status));
        this.setStatus({ state: 'paused' });
        if (type === 'flush') {
          this.handleFlushEvent();
        }
        break;
      case 'stop':
        void this.stopPlayback();
        break;
      case 'volume':
        void Promise.resolve(this.audioSession.setOutput({ volume: normalizeVolume(event.value) / 100 })).catch(() => undefined);
        this.setStatus({ volume: normalizeVolume(event.value) });
        break;
      default:
        break;
    }
  }

  private prepareIncomingStream(event: RaopEvent): void {
    this.clearCurrentSession('new AirPlay stream');
    this.ignorePcmUntilNextStream = false;
    this.sessionCounter += 1;
    this.currentSourceId = `airplay-receiver:${this.now().toString(36)}-${this.sessionCounter.toString(36)}`;
    this.pcmStream = new PassThrough({ highWaterMark: airPlayPcmHighWaterMark });
    this.pcmPlaybackStarted = false;
    this.audioSessionClaimedCurrentSource = false;
    this.setPositionAnchor(0);
    const address = eventAddress(event);
    const client: ConnectReceiverClient | null = address
      ? {
          address,
          userAgent: 'AirPlay',
          lastSeenAt: new Date(this.now()).toISOString(),
        }
      : null;
    const metadata = metadataFromEvent(event, this.status.metadata, this.status.artworkUrl);
    this.currentMetadataIdentityKey = metadataIdentityKey(metadata);
    this.setStatus({
      state: 'ready',
      currentClient: client,
      currentSourceId: this.currentSourceId,
      metadata,
      currentLyricLine: null,
      positionSeconds: 0,
      durationSeconds: 0,
      error: null,
    });
  }

  private applyMetadataEvent(event: RaopEvent): void {
    const eventTitle = trimText(event.title);
    const metadata = metadataFromEvent(event, this.status.metadata, this.status.artworkUrl);
    const elapsedMs = Number(event.elapsedMs);
    const nextMetadataIdentityKey = metadataIdentityKey(metadata);
    const metadataChanged = Boolean(nextMetadataIdentityKey && nextMetadataIdentityKey !== this.currentMetadataIdentityKey);
    const nextLyricLine =
      !metadataChanged && shouldKeepCurrentMetadataForLyricLine(eventTitle, this.status.metadata) ? eventTitle : null;
    const nextPositionSeconds =
      Number.isFinite(elapsedMs) && elapsedMs >= 0
        ? elapsedMs / 1000
        : metadataChanged
          ? 0
          : this.estimatePosition(this.status);
    this.currentMetadataIdentityKey = nextMetadataIdentityKey;
    this.setPositionAnchor(nextPositionSeconds, metadata.durationSeconds);
    this.setStatus({
      metadata,
      currentLyricLine: nextLyricLine ?? (metadataChanged ? null : this.status.currentLyricLine),
      durationSeconds: metadata.durationSeconds,
      positionSeconds: nextPositionSeconds,
    });
  }

  private applyArtworkEvent(event: RaopEvent): void {
    const data = Buffer.isBuffer(event.data) ? event.data : null;
    if (!data || data.length === 0) {
      return;
    }

    const mimeType = trimText(event.mimeType) ?? trimText(event.contentType) ?? 'image/jpeg';
    const artworkUrl = `data:${mimeType};base64,${data.toString('base64')}`;
    const metadata = metadataFromEvent(event, this.status.metadata, artworkUrl);
    this.setStatus({
      artworkUrl,
      metadata,
      durationSeconds: metadata.durationSeconds,
    });
  }

  private handlePcmEvent(event: RaopEvent): void {
    if (this.httpPcmRequest || this.httpPcmTransform) {
      if (this.httpPcmBytesReceived > 0) {
        return;
      }
      this.addDebugEvent('pcm', 'fallback to direct PCM events before HTTP audio arrived');
      this.destroyHttpPcmPlayback();
      this.pcmStream = null;
      this.pcmPlaybackStarted = false;
    }

    const data = Buffer.isBuffer(event.data) ? event.data : null;
    if (!data || data.length < 2) {
      return;
    }

    if (this.ignorePcmUntilNextStream && !this.currentSourceId) {
      return;
    }

    if (!this.currentSourceId || !this.pcmStream) {
      this.prepareIncomingStream(event);
    }

    if (!this.currentSourceId || !this.pcmStream) {
      return;
    }

    if (!this.pcmPlaybackStarted) {
      this.pcmPlaybackStarted = true;
      const stream = this.pcmStream;
      const sampleRate = Number(event.sampleRate) || defaultSampleRate;
      const channels = Number(event.channels) || defaultChannels;
      void this.audioSession
        .playPcmStream({
          stream,
          sourceId: this.currentSourceId,
          trackId: this.currentSourceId,
          sampleRate,
          channels,
          durationSeconds: this.status.durationSeconds,
          output: createAirPlayOutputSettings(),
        })
        .then(() => this.setStatus({ state: 'playing', error: null }))
        .catch((error) => {
          this.setStatus({
            state: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }

    const converted = convertS16leToF32le(data);
    if (!this.pcmStream.write(converted)) {
      this.addDebugEvent('pcm', 'backpressure');
    }
  }

  private startHttpPcmPlayback(event: RaopEvent): void {
    const port = Number(event.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      this.addDebugEvent('stream', `invalid PCM HTTP port: ${String(event.port)}`);
      return;
    }

    if (!this.currentSourceId) {
      this.prepareIncomingStream(event);
    }

    if (!this.currentSourceId) {
      return;
    }

    this.destroyHttpPcmPlayback();
    const sourceId = this.currentSourceId;
    const stream = this.createHttpPcmTransform();
    this.pcmStream = stream;
    this.pcmPlaybackStarted = true;
    this.httpPcmBytesReceived = 0;
    this.lastHttpPcmPort = port;
    // The RAOP helper exposes PCM HTTP as a local bridge for this process; using
    // loopback avoids Windows adapter/firewall hairpin failures on LAN addresses.
    const host = '127.0.0.1';

    this.setStatus({ state: 'ready', error: null });
    this.addDebugEvent('stream', `pull PCM from http://${host}:${port}/`);
    this.httpPcmFallbackTimer = setTimeout(() => {
      if (this.currentSourceId !== sourceId || this.httpPcmBytesReceived > 0) {
        return;
      }
      this.enableDirectPcmFallback(sourceId, 'HTTP PCM produced no audio');
    }, airPlayHttpPcmFallbackMs);

    const request = httpRequest(
      {
        host,
        port,
        path: '/',
        method: 'GET',
        headers: {
          Connection: 'close',
        },
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 400) {
          this.setStatus({ state: 'error', error: `AirPlay PCM HTTP ${response.statusCode}` });
          response.resume();
          return;
        }
        response.on('error', (error) => {
          if (this.intentionalHttpPcmRequestCloses.has(request)) {
            stream.destroy();
            return;
          }
          this.addDebugEvent('stream', error.message);
          stream.destroy(error);
        });
        response.pipe(stream);
      },
    );

    request.on('socket', (socket) => {
      socket.setNoDelay(true);
    });
    request.once('error', (error) => {
      if (this.intentionalHttpPcmRequestCloses.has(request)) {
        stream.destroy();
        return;
      }
      if (this.currentSourceId === sourceId) {
        this.enableDirectPcmFallback(sourceId, `AirPlay PCM HTTP failed: ${error.message}`);
      }
      stream.destroy(error);
    });
    request.once('close', () => {
      this.intentionalHttpPcmRequestCloses.delete(request);
      if (this.httpPcmRequest === request) {
        this.httpPcmRequest = null;
      }
    });
    this.httpPcmRequest = request;
    request.end();

    void this.audioSession
      .playPcmStream({
        stream,
        sourceId,
        trackId: sourceId,
        sampleRate: defaultSampleRate,
        channels: defaultChannels,
        durationSeconds: this.status.durationSeconds,
        output: createAirPlayOutputSettings(),
      })
      .then(() => {
        if (this.currentSourceId === sourceId) {
          this.setStatus({ state: 'playing', error: null });
        }
      })
      .catch((error) => {
        if (this.currentSourceId === sourceId) {
          this.setStatus({
            state: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
  }

  private createHttpPcmTransform(): Transform {
    let carry: Buffer | null = null;
    const transform = new Transform({
      highWaterMark: airPlayPcmHighWaterMark,
      transform: (chunk: Buffer, _encoding, callback) => {
        const input = carry ? Buffer.concat([carry, chunk]) : chunk;
        const evenLength = input.length - (input.length % 2);
        carry = evenLength === input.length ? null : input.subarray(evenLength);
        if (evenLength > 0) {
          const hadAudio = this.httpPcmBytesReceived > 0;
          this.httpPcmBytesReceived += evenLength;
          if (!hadAudio) {
            this.clearHttpPcmFallbackTimer();
            this.addDebugEvent('pcm', 'HTTP PCM started');
          }
          transform.push(convertS16leToF32le(input.subarray(0, evenLength)));
        }
        callback();
      },
      flush: (callback) => {
        carry = null;
        callback();
      },
    });
    this.httpPcmTransform = transform;
    return transform;
  }

  private clearHttpPcmFallbackTimer(): void {
    if (this.httpPcmFallbackTimer) {
      clearTimeout(this.httpPcmFallbackTimer);
      this.httpPcmFallbackTimer = null;
    }
  }

  private clearHttpPcmReconnectTimer(): void {
    if (this.httpPcmReconnectTimer) {
      clearTimeout(this.httpPcmReconnectTimer);
      this.httpPcmReconnectTimer = null;
    }
  }

  private scheduleHttpPcmReconnect(reason: string): void {
    if (!this.useHttpPcmBridge) {
      return;
    }

    const sourceId = this.currentSourceId;
    const port = this.lastHttpPcmPort;
    if (!sourceId || !port) {
      return;
    }

    this.clearHttpPcmReconnectTimer();
    this.destroyHttpPcmPlayback();
    this.pcmStream = null;
    this.pcmPlaybackStarted = false;
    this.addDebugEvent('stream', `restart PCM HTTP after ${reason}`);
    this.httpPcmReconnectTimer = setTimeout(() => {
      this.httpPcmReconnectTimer = null;
      if (this.currentSourceId !== sourceId || this.lastHttpPcmPort !== port) {
        return;
      }
      this.startHttpPcmPlayback({ type: 'stream', port });
    }, airPlayHttpPcmReconnectMs);
  }

  private handleFlushEvent(): void {
    if (this.httpPcmRequest && this.httpPcmTransform && this.httpPcmBytesReceived > 0) {
      this.addDebugEvent('stream', 'keep PCM HTTP alive after flush');
      return;
    }

    this.scheduleHttpPcmReconnect('flush');
  }

  private enableDirectPcmFallback(sourceId: string, reason: string): void {
    if (this.currentSourceId !== sourceId) {
      return;
    }
    this.addDebugEvent('pcm', `${reason}; switching to direct PCM events`);
    this.destroyHttpPcmPlayback();
    this.pcmStream = null;
    this.pcmPlaybackStarted = false;
    void Promise.resolve(this.raopModule?.setPcmForwarding?.(true)).catch((error) => {
      this.addDebugEvent('pcm', error instanceof Error ? error.message : String(error));
    });
  }

  private destroyHttpPcmPlayback(): void {
    this.clearHttpPcmFallbackTimer();
    if (this.httpPcmRequest) {
      this.intentionalHttpPcmRequestCloses.add(this.httpPcmRequest);
      this.httpPcmRequest.destroy();
    }
    this.httpPcmRequest = null;
    if (this.httpPcmTransform) {
      this.httpPcmTransform.destroy();
    }
    this.httpPcmTransform = null;
    this.httpPcmBytesReceived = 0;
  }

  private clearCurrentSession(reason: string): void {
    this.clearHttpPcmReconnectTimer();
    this.destroyHttpPcmPlayback();
    if (this.pcmStream) {
      this.pcmStream.destroy();
    }
    this.pcmStream = null;
    this.lastHttpPcmPort = null;
    this.pcmPlaybackStarted = false;
    this.currentSourceId = null;
    this.audioSessionClaimedCurrentSource = false;
    this.currentMetadataIdentityKey = null;
    this.setPositionAnchor(0);
    if (reason) {
      this.addDebugEvent('clear', reason);
    }
  }

  private async pauseAirPlay2ActivePlayback(reason: string): Promise<void> {
    this.clearHttpPcmReconnectTimer();
    this.destroyHttpPcmPlayback();
    if (this.pcmStream) {
      this.pcmStream.destroy();
    }
    this.pcmStream = null;
    this.pcmPlaybackStarted = false;
    this.setPositionAnchor(this.estimatePosition(this.status));

    const currentSourceId = this.currentSourceId;
    if (currentSourceId && this.audioSession.getStatus().currentFilePath === currentSourceId) {
      await Promise.resolve(this.audioSession.pause()).catch((error) => {
        this.addDebugEvent('pause', error instanceof Error ? error.message : String(error));
      });
    }

    this.setStatus({
      state: this.status.enabled ? 'paused' : 'disabled',
      positionSeconds: this.estimatePosition({ ...this.status, state: 'paused' }),
      error: null,
    });
    if (reason) {
      this.addDebugEvent('pause', reason);
    }
  }

  private async stopAirPlay2ActivePlayback(reason: string): Promise<void> {
    const currentSourceId = this.currentSourceId;
    if (currentSourceId && this.audioSession.getStatus().currentFilePath === currentSourceId) {
      await Promise.resolve(this.audioSession.stop()).catch((error) => {
        this.addDebugEvent('stop', error instanceof Error ? error.message : String(error));
      });
    }

    this.ignorePcmUntilNextStream = true;
    this.clearCurrentSession(reason);
    this.setStatus({
      state: this.status.enabled ? 'idle' : 'disabled',
      currentClient: null,
      currentSourceId: null,
      metadata: null,
      currentLyricLine: null,
      artworkUrl: null,
      positionSeconds: 0,
      durationSeconds: 0,
      error: null,
    });
  }

  private sendRemoteCommand(command: 'play' | 'pause' | 'stop'): void {
    if (this.receiverHandle === null || !this.raopModule?.sendRemoteCommand) {
      return;
    }

    try {
      this.raopModule.sendRemoteCommand(this.receiverHandle, command);
    } catch (error) {
      this.addDebugEvent('remote', error instanceof Error ? error.message : String(error));
    }
  }

  private withAudioPosition(status: AirPlayReceiverStatus): AirPlayReceiverStatus {
    const audioStatus = this.audioSession.getStatus();
    if (!this.currentSourceId || audioStatus.currentFilePath !== this.currentSourceId) {
      return {
        ...status,
        positionSeconds: this.estimatePosition(status),
        updatedAt: new Date(this.now()).toISOString(),
      };
    }

    const nextState = airPlayStateFromAudioStatus(audioStatus, status.state);
    return {
      ...status,
      state: nextState,
      positionSeconds: this.estimatePosition({ ...status, state: nextState }),
      durationSeconds: audioStatus.durationSeconds || status.durationSeconds,
      volume: Math.round(audioStatus.volume * 100),
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  private readonly handleAudioStatus = (audioStatus: AudioStatus): void => {
    if (!this.currentSourceId) {
      return;
    }

    if (audioStatus.currentFilePath === this.currentSourceId) {
      this.audioSessionClaimedCurrentSource = true;
    }

    if (
      this.audioSessionClaimedCurrentSource &&
      audioStatus.currentFilePath &&
      audioStatus.currentFilePath !== this.currentSourceId &&
      (audioStatus.state === 'loading' || audioStatus.state === 'playing')
    ) {
      this.sendRemoteCommand('stop');
      this.ignorePcmUntilNextStream = true;
      this.clearCurrentSession('local playback took over');
      this.setStatus({
        state: this.status.enabled ? 'idle' : 'disabled',
        currentClient: null,
        currentSourceId: null,
        metadata: null,
        currentLyricLine: null,
        artworkUrl: null,
        positionSeconds: 0,
        durationSeconds: 0,
      });
      return;
    }

    if (audioStatus.currentFilePath !== this.currentSourceId) {
      return;
    }

    const nextState = airPlayStateFromAudioStatus(audioStatus, this.status.state);
    this.setStatus({
      state: nextState,
      positionSeconds: this.estimatePosition({ ...this.status, state: nextState }),
      durationSeconds: audioStatus.durationSeconds || this.status.durationSeconds,
      volume: Math.round(audioStatus.volume * 100),
      error: audioStatus.error ?? this.status.error,
    });
  };

  private setPositionAnchor(positionSeconds: number, durationSeconds = this.status.durationSeconds): void {
    const safePositionSeconds = Math.max(0, Number.isFinite(positionSeconds) ? positionSeconds : 0);
    this.positionAnchorSeconds = durationSeconds > 0 ? Math.min(durationSeconds, safePositionSeconds) : safePositionSeconds;
    this.positionAnchorUpdatedAtMs = this.now();
  }

  private estimatePosition(status: Pick<AirPlayReceiverStatus, 'durationSeconds' | 'state'>): number {
    const durationSeconds = status.durationSeconds > 0 ? status.durationSeconds : Number.POSITIVE_INFINITY;
    const elapsedSeconds = status.state === 'playing' ? Math.max(0, (this.now() - this.positionAnchorUpdatedAtMs) / 1000) : 0;
    return Math.min(durationSeconds, Math.max(0, this.positionAnchorSeconds + elapsedSeconds));
  }

  private setStatus(next: Partial<AirPlayReceiverStatus>): void {
    this.status = {
      ...this.status,
      ...next,
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.emit('status', this.getStatus());
  }

  private addDebugEvent(
    action: string,
    message: string | null,
    details: Partial<Pick<ConnectReceiverDebugEvent, 'method' | 'path' | 'statusCode' | 'remoteAddress'>> = {},
  ): void {
    const event: ConnectReceiverDebugEvent = {
      id: `${this.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      at: new Date(this.now()).toISOString(),
      remoteAddress: details.remoteAddress ?? this.status.currentClient?.address ?? null,
      method: details.method ?? 'RAOP',
      path: details.path ?? '/airplay/receiver',
      action,
      statusCode: details.statusCode ?? null,
      message,
    };
    this.status = {
      ...this.status,
      debugEvents: [event, ...this.status.debugEvents].slice(0, debugEventLimit),
      updatedAt: new Date(this.now()).toISOString(),
    };
    if (!highVolumeDebugActions.has(action)) {
      this.emit('status', this.getStatus());
    }
    if ((event.statusCode !== null && event.statusCode >= 400) || action.endsWith('error')) {
      console.warn('[AirPlayReceiver]', `${event.method} ${event.path} ${event.statusCode ?? '-'} #${action}`, message ?? '');
    }
  }

  private formatNativeLog(event: unknown): string {
    if (event && typeof event === 'object') {
      const entry = event as { line?: unknown; source?: unknown; level?: unknown };
      return [entry.source, entry.level, entry.line].map((value) => trimText(value)).filter(Boolean).join(' ');
    }
    return String(event ?? '');
  }

  private handleNativeLog(event: unknown): void {
    const message = this.formatNativeLog(event);
    this.addDebugEvent('log', message);
    if (/unknown\/unhandled method POST/iu.test(message)) {
      this.setStatus({
        state: this.status.enabled ? 'error' : this.status.state,
        error: 'AirPlay connection failed: iPhone requested an unsupported AirPlay RTSP POST flow.',
      });
    }
  }
}

let airPlayReceiverService: AirPlayReceiverSpikeService | null = null;

export const getAirPlayReceiverSpikeService = (): AirPlayReceiverSpikeService => {
  airPlayReceiverService ??= new AirPlayReceiverSpikeService();
  return airPlayReceiverService;
};

export const disposeAirPlayReceiverSpikeService = async (): Promise<void> => {
  if (airPlayReceiverService) {
    await airPlayReceiverService.dispose();
    airPlayReceiverService = null;
  }
};
