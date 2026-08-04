import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const executableName = process.platform === 'win32' ? 'echo-native-scanner.exe' : 'echo-native-scanner';
const scannerPath = resolve(process.env.ECHO_NATIVE_SCANNER_PATH || join(projectRoot, 'electron-app', 'build', executableName));

const fail = (message) => {
  console.error(`[smoke:native-scanner] ${message}`);
  process.exit(1);
};

if (!existsSync(scannerPath)) {
  fail(`Missing native scanner binary: ${scannerPath}. Run "npm run build:native-scanner" first.`);
}

const pathKey = (filePath) => (process.platform === 'win32' ? resolve(filePath).toLocaleLowerCase() : resolve(filePath));

const uint32Le = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
};

const uint16Le = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
};

const uint64Le = (value) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value), 0);
  return buffer;
};

const uint16Be = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value, 0);
  return buffer;
};

const uint32Be = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
};

const synchsafe32 = (value) => Buffer.from([
  (value >> 21) & 0x7f,
  (value >> 14) & 0x7f,
  (value >> 7) & 0x7f,
  value & 0x7f,
]);

const flacBlockHeader = (type, length, isLast) => Buffer.from([
  (isLast ? 0x80 : 0x00) | type,
  (length >> 16) & 0xff,
  (length >> 8) & 0xff,
  length & 0xff,
]);

const createVorbisCommentBlock = (vendorText, comments) => {
  const vendor = Buffer.from(vendorText, 'utf8');
  const commentBuffers = comments.map((comment) => Buffer.from(comment, 'utf8'));
  return Buffer.concat([
    uint32Le(vendor.length),
    vendor,
    uint32Le(commentBuffers.length),
    ...commentBuffers.flatMap((comment) => [uint32Le(comment.length), comment]),
  ]);
};

const createMinimalFlacWithVorbisComments = (comments) => {
  const sampleRate = 44100;
  const bitsPerSample = 16;
  const channels = 2;
  const totalSamples = sampleRate * 123;
  const streamInfo = Buffer.alloc(34);
  const packed =
    (BigInt(sampleRate) << 44n) |
    (BigInt(channels - 1) << 41n) |
    (BigInt(bitsPerSample - 1) << 36n) |
    BigInt(totalSamples);
  for (let index = 7; index >= 0; index -= 1) {
    streamInfo[10 + (7 - index)] = Number((packed >> BigInt(index * 8)) & 0xffn);
  }

  const vorbisComment = createVorbisCommentBlock('ECHO native smoke', comments);

  return Buffer.concat([
    Buffer.from('fLaC', 'ascii'),
    flacBlockHeader(0, streamInfo.length, false),
    streamInfo,
    flacBlockHeader(4, vorbisComment.length, true),
    vorbisComment,
  ]);
};

const riffChunk = (id, payload) => Buffer.concat([
  Buffer.from(id, 'ascii'),
  uint32Le(payload.length),
  payload,
  payload.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0),
]);

const createMinimalWaveWithInfo = () => {
  const sampleRate = 44100;
  const channels = 2;
  const bitsPerSample = 16;
  const data = Buffer.alloc(sampleRate * channels * (bitsPerSample / 8));
  const fmt = Buffer.concat([
    uint16Le(1),
    uint16Le(channels),
    uint32Le(sampleRate),
    uint32Le(sampleRate * channels * (bitsPerSample / 8)),
    uint16Le(channels * (bitsPerSample / 8)),
    uint16Le(bitsPerSample),
  ]);
  const infoPayload = Buffer.concat([
    Buffer.from('INFO', 'ascii'),
    riffChunk('INAM', Buffer.from('Native WAV Title\0', 'utf8')),
    riffChunk('IART', Buffer.from('Native WAV Artist\0', 'utf8')),
    riffChunk('IPRD', Buffer.from('Native WAV Album\0', 'utf8')),
    riffChunk('ICRD', Buffer.from('2026\0', 'utf8')),
    riffChunk('IGNR', Buffer.from('WAV Smoke\0', 'utf8')),
  ]);
  const body = Buffer.concat([
    riffChunk('fmt ', fmt),
    riffChunk('LIST', infoPayload),
    riffChunk('data', data),
  ]);
  return Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    uint32Le(body.length + 4),
    Buffer.from('WAVE', 'ascii'),
    body,
  ]);
};

const aiffChunk = (id, payload) => Buffer.concat([
  Buffer.from(id, 'ascii'),
  uint32Be(payload.length),
  payload,
  payload.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0),
]);

const createMinimalAiffWithMetadata = () => {
  const comm = Buffer.concat([
    uint16Be(2),
    uint32Be(44100),
    uint16Be(16),
    Buffer.from([0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]),
  ]);
  const body = Buffer.concat([
    Buffer.from('AIFF', 'ascii'),
    aiffChunk('COMM', comm),
    aiffChunk('NAME', Buffer.from('Native AIFF Title', 'utf8')),
    aiffChunk('AUTH', Buffer.from('Native AIFF Artist', 'utf8')),
    aiffChunk('ANNO', Buffer.from('Native AIFF Album', 'utf8')),
  ]);
  return Buffer.concat([
    Buffer.from('FORM', 'ascii'),
    uint32Be(body.length),
    body,
  ]);
};

const oggPage = (packet, { granule = 0, serial = 1, sequence = 0, headerType = 0 } = {}) => {
  const lacing = [];
  let remaining = packet.length;
  while (remaining >= 255) {
    lacing.push(255);
    remaining -= 255;
  }
  lacing.push(remaining);
  return Buffer.concat([
    Buffer.from('OggS', 'ascii'),
    Buffer.from([0, headerType]),
    uint64Le(granule),
    uint32Le(serial),
    uint32Le(sequence),
    uint32Le(0),
    Buffer.from([lacing.length]),
    Buffer.from(lacing),
    packet,
  ]);
};

const createMinimalOggVorbisWithComments = () => {
  const sampleRate = 44100;
  const id = Buffer.concat([
    Buffer.from([1]),
    Buffer.from('vorbis', 'ascii'),
    uint32Le(0),
    Buffer.from([2]),
    uint32Le(sampleRate),
    uint32Le(0),
    uint32Le(128000),
    uint32Le(0),
    Buffer.from([0xb0, 1]),
  ]);
  const comments = Buffer.concat([
    Buffer.from([3]),
    Buffer.from('vorbis', 'ascii'),
    createVorbisCommentBlock('ECHO native smoke', [
      'TITLE=Native OGG Title',
      'ARTIST=Native OGG Artist',
      'ALBUM=Native OGG Album',
      'DATE=2026',
      'GENRE=OGG Smoke',
    ]),
  ]);
  return Buffer.concat([
    oggPage(id, { granule: 0, serial: 2, sequence: 0, headerType: 2 }),
    oggPage(comments, { granule: sampleRate * 2, serial: 2, sequence: 1 }),
  ]);
};

const createMinimalOpusWithComments = () => {
  const id = Buffer.concat([
    Buffer.from('OpusHead', 'ascii'),
    Buffer.from([1, 2]),
    uint16Le(312),
    uint32Le(48000),
    uint16Le(0),
    Buffer.from([0]),
  ]);
  const comments = Buffer.concat([
    Buffer.from('OpusTags', 'ascii'),
    createVorbisCommentBlock('ECHO native smoke', [
      'TITLE=Native Opus Title',
      'ARTIST=Native Opus Artist',
      'ALBUM=Native Opus Album',
      'DATE=2026',
      'GENRE=Opus Smoke',
    ]),
  ]);
  return Buffer.concat([
    oggPage(id, { granule: 0, serial: 3, sequence: 0, headerType: 2 }),
    oggPage(comments, { granule: 48000 * 2 + 312, serial: 3, sequence: 1 }),
  ]);
};

const mp4Atom = (type, payload) => Buffer.concat([
  uint32Be(payload.length + 8),
  typeof type === 'string' ? Buffer.from(type, 'binary') : Buffer.from(type),
  payload,
]);

const mp4CopyrightAtomType = (a, b, c) => Buffer.from([0xa9, a.charCodeAt(0), b.charCodeAt(0), c.charCodeAt(0)]);

const mp4TextDataAtom = (text) => mp4Atom('data', Buffer.concat([
  uint32Be(1),
  uint32Be(0),
  Buffer.from(text, 'utf8'),
]));

const mp4PairDataAtom = (value, total) => mp4Atom('data', Buffer.concat([
  uint32Be(0),
  uint32Be(0),
  uint16Be(0),
  uint16Be(value),
  uint16Be(total),
  uint16Be(0),
]));

const createMinimalM4aWithMetadata = () => {
  const timescale = 44100;
  const duration = timescale * 98;
  const mvhd = mp4Atom('mvhd', Buffer.concat([
    Buffer.from([0, 0, 0, 0]),
    uint32Be(0),
    uint32Be(0),
    uint32Be(timescale),
    uint32Be(duration),
  ]));
  const ilst = mp4Atom('ilst', Buffer.concat([
    mp4Atom(mp4CopyrightAtomType('n', 'a', 'm'), mp4TextDataAtom('Native M4A Title')),
    mp4Atom(mp4CopyrightAtomType('A', 'R', 'T'), mp4TextDataAtom('Native M4A Artist')),
    mp4Atom(mp4CopyrightAtomType('a', 'l', 'b'), mp4TextDataAtom('Native M4A Album')),
    mp4Atom('aART', mp4TextDataAtom('Native M4A Album Artist')),
    mp4Atom(mp4CopyrightAtomType('d', 'a', 'y'), mp4TextDataAtom('2024-01-02')),
    mp4Atom(mp4CopyrightAtomType('g', 'e', 'n'), mp4TextDataAtom('M4A Smoke')),
    mp4Atom('trkn', mp4PairDataAtom(5, 11)),
    mp4Atom('disk', mp4PairDataAtom(2, 3)),
  ]));
  const meta = mp4Atom('meta', Buffer.concat([Buffer.from([0, 0, 0, 0]), ilst]));
  const udta = mp4Atom('udta', meta);
  const moov = mp4Atom('moov', Buffer.concat([mvhd, udta]));
  const ftyp = mp4Atom('ftyp', Buffer.concat([Buffer.from('M4A ', 'ascii'), uint32Be(0), Buffer.from('M4A mp42', 'ascii')]));
  return Buffer.concat([ftyp, moov]);
};

const createId3TextFrame = (id, text) => {
  const payload = Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]);
  return Buffer.concat([
    Buffer.from(id, 'ascii'),
    synchsafe32(payload.length),
    Buffer.from([0, 0]),
    payload,
  ]);
};

const createMpeg1Layer3CbrFrames = (count = 100) => {
  const frameLength = Math.floor((144 * 128000) / 44100);
  const frame = Buffer.alloc(frameLength);
  Buffer.from([0xff, 0xfb, 0x90, 0x64]).copy(frame, 0);
  return Buffer.concat(Array.from({ length: count }, () => frame));
};

const createMinimalMp3WithId3v24 = (frames) => {
  const frameData = Buffer.concat(frames.map(([id, text]) => createId3TextFrame(id, text)));
  return Buffer.concat([
    Buffer.from('ID3', 'ascii'),
    Buffer.from([4, 0, 0]),
    synchsafe32(frameData.length),
    frameData,
    createMpeg1Layer3CbrFrames(),
  ]);
};

const parseJsonLines = (stdout) =>
  stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        fail(`Invalid NDJSON line: ${line}; ${error instanceof Error ? error.message : String(error)}`);
      }
      return null;
    });

const runNativeRequests = async (requests) => {
  const child = spawn(scannerPath, [], {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(`${requests.map((request) => JSON.stringify(request)).join('\n')}\n`);

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('native scanner smoke test timed out'));
    }, 5000);

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.on('error', reject);
  });

  if (result.code !== 0) {
    fail(`Native scanner exited with code ${result.code ?? 'null'} signal ${result.signal ?? 'null'}; stderr=${stderr.trim()}`);
  }

  return parseJsonLines(stdout);
};

const runNativeRequest = (request) => runNativeRequests([request]);

const root = mkdtempSync(join(tmpdir(), 'echo-native-scanner-smoke-'));
const musicDir = join(root, '音乐');
const nestedDir = join(musicDir, '专辑');

try {
  mkdirSync(nestedDir, { recursive: true });
  const flacPath = join(musicDir, '歌.flac');
  const mp3Path = join(nestedDir, 'song.mp3');
  const m4aPath = join(nestedDir, 'song.m4a');
  const wavPath = join(nestedDir, 'song.wav');
  const aiffPath = join(nestedDir, 'song.aiff');
  const oggPath = join(nestedDir, 'song.ogg');
  const opusPath = join(nestedDir, 'song.opus');
  const ignoredPath = join(nestedDir, 'cover.jpg');
  writeFileSync(flacPath, createMinimalFlacWithVorbisComments([
    'TITLE=Native Smoke Title',
    'ARTIST=Native Smoke Artist',
    'ALBUM=Native Smoke Album',
    'ALBUMARTIST=Native Smoke Album Artist',
    'TRACKNUMBER=7/12',
    'DATE=2026-06-06',
    'GENRE=Smoke',
  ]));
  writeFileSync(mp3Path, createMinimalMp3WithId3v24([
    ['TIT2', 'Native MP3 Title'],
    ['TPE1', 'Native MP3 Artist'],
    ['TALB', 'Native MP3 Album'],
    ['TPE2', 'Native MP3 Album Artist'],
    ['TRCK', '3/9'],
    ['TDRC', '2025'],
    ['TCON', 'MP3 Smoke'],
  ]));
  writeFileSync(m4aPath, createMinimalM4aWithMetadata());
  writeFileSync(wavPath, createMinimalWaveWithInfo());
  writeFileSync(aiffPath, createMinimalAiffWithMetadata());
  writeFileSync(oggPath, createMinimalOggVorbisWithComments());
  writeFileSync(opusPath, createMinimalOpusWithComments());
  writeFileSync(ignoredPath, 'jpg');

  const messages = await runNativeRequest({
    type: 'scan',
    root,
    extensions: ['.flac', '.mp3', '.m4a', '.wav', '.aiff', '.ogg', '.opus'],
    batchSize: 1,
  });

  const files = messages
    .filter((message) => message?.type === 'batch' && Array.isArray(message.items))
    .flatMap((message) => message.items);
  const snapshots = messages.filter((message) => message?.type === 'directorySnapshot');
  const done = messages.find((message) => message?.type === 'done');
  const fileKeys = new Set(files.map((file) => pathKey(String(file.path))));

  if (!messages.some((message) => message?.type === 'ready')) {
    fail('Missing ready message.');
  }
  if (!messages.some((message) => message?.type === 'started')) {
    fail('Missing started message.');
  }
  if (!done || done.files !== 7) {
    fail(`Expected done.files=7, got ${JSON.stringify(done)}`);
  }
  if (
    !fileKeys.has(pathKey(flacPath)) ||
    !fileKeys.has(pathKey(mp3Path)) ||
    !fileKeys.has(pathKey(m4aPath)) ||
    !fileKeys.has(pathKey(wavPath)) ||
    !fileKeys.has(pathKey(aiffPath)) ||
    !fileKeys.has(pathKey(oggPath)) ||
    !fileKeys.has(pathKey(opusPath))
  ) {
    fail(`Expected flac/mp3/m4a/wav/aiff/ogg/opus files in output, got ${JSON.stringify(files)}`);
  }
  if (fileKeys.has(pathKey(ignoredPath))) {
    fail('Ignored jpg file was included in scanner output.');
  }
  if (snapshots.length < 3) {
    fail(`Expected snapshots for root and nested directories, got ${snapshots.length}`);
  }
  if (!snapshots.some((snapshot) => Array.isArray(snapshot.entries) && snapshot.entries.some((entry) => entry.name === '音乐' && entry.kind === 'directory'))) {
    fail(`Missing root directory snapshot entry for Chinese directory; snapshots=${JSON.stringify(snapshots)}`);
  }
  if (!snapshots.some((snapshot) => Array.isArray(snapshot.entries) && snapshot.entries.some((entry) => entry.name === '歌.flac' && entry.kind === 'file'))) {
    fail(`Missing file snapshot entry for Chinese file; snapshots=${JSON.stringify(snapshots)}`);
  }
  if (messages.some((message) => message?.type === 'error')) {
    fail(`Native scanner reported errors: ${JSON.stringify(messages.filter((message) => message?.type === 'error'))}`);
  }

  const metadataMessages = await runNativeRequests([
    {
      type: 'metadata',
      path: flacPath,
      readCover: false,
    },
    {
      type: 'metadata',
      path: mp3Path,
      readCover: false,
    },
    {
      type: 'metadata',
      path: m4aPath,
      readCover: false,
    },
    {
      type: 'metadata',
      path: wavPath,
      readCover: false,
    },
    {
      type: 'metadata',
      path: aiffPath,
      readCover: false,
    },
    {
      type: 'metadata',
      path: oggPath,
      readCover: false,
    },
    {
      type: 'metadata',
      path: opusPath,
      readCover: false,
    },
  ]);
  if (!metadataMessages.some((message) => message?.type === 'ready')) {
    fail('Missing ready message for metadata request.');
  }
  if (!metadataMessages.some((message) => message?.type === 'started' && message.mode === 'metadata')) {
    fail(`Missing metadata started message; got ${JSON.stringify(metadataMessages)}`);
  }
  const metadataResults = metadataMessages.filter((message) => message?.type === 'metadata');
  const metadata = metadataResults[0];
  if (!metadata) {
    fail(`Expected metadata response, got ${JSON.stringify(metadataMessages)}`);
  }
  if (metadata.result?.fields?.title !== 'Native Smoke Title') {
    fail(`Expected native title metadata, got ${JSON.stringify(metadata)}`);
  }
  if (metadata.result?.fields?.artist !== 'Native Smoke Artist') {
    fail(`Expected native artist metadata, got ${JSON.stringify(metadata)}`);
  }
  if (metadata.result?.fields?.album !== 'Native Smoke Album') {
    fail(`Expected native album metadata, got ${JSON.stringify(metadata)}`);
  }
  if (metadata.result?.fields?.albumArtist !== 'Native Smoke Album Artist') {
    fail(`Expected native album artist metadata, got ${JSON.stringify(metadata)}`);
  }
  if (metadata.result?.fields?.trackNo !== 7 || metadata.result?.fields?.year !== 2026) {
    fail(`Expected native numeric metadata, got ${JSON.stringify(metadata)}`);
  }
  if (metadata.result?.embeddedCoverStatus !== 'missing') {
    fail(`Native metadata reader must not extract covers yet, got ${JSON.stringify(metadata)}`);
  }

  const mp3Metadata = metadataResults[1];
  if (!mp3Metadata) {
    fail(`Expected MP3 metadata response, got ${JSON.stringify(metadataMessages)}`);
  }
  if (mp3Metadata.result?.fields?.title !== 'Native MP3 Title') {
    fail(`Expected native MP3 title metadata, got ${JSON.stringify(mp3Metadata)}`);
  }
  if (mp3Metadata.result?.fields?.artist !== 'Native MP3 Artist') {
    fail(`Expected native MP3 artist metadata, got ${JSON.stringify(mp3Metadata)}`);
  }
  if (mp3Metadata.result?.fields?.album !== 'Native MP3 Album') {
    fail(`Expected native MP3 album metadata, got ${JSON.stringify(mp3Metadata)}`);
  }
  if (mp3Metadata.result?.fields?.albumArtist !== 'Native MP3 Album Artist') {
    fail(`Expected native MP3 album artist metadata, got ${JSON.stringify(mp3Metadata)}`);
  }
  if (mp3Metadata.result?.fields?.trackNo !== 3 || mp3Metadata.result?.fields?.year !== 2025) {
    fail(`Expected native MP3 numeric metadata, got ${JSON.stringify(mp3Metadata)}`);
  }
  if (
    mp3Metadata.result?.fields?.codec !== 'MP3' ||
    !(mp3Metadata.result?.fields?.duration > 2) ||
    mp3Metadata.result?.fields?.bitrate !== 128000 ||
    mp3Metadata.result?.embeddedCoverStatus !== 'missing'
  ) {
    fail(`Expected native MP3 codec/duration/bitrate and no cover extraction, got ${JSON.stringify(mp3Metadata)}`);
  }

  const m4aMetadata = metadataResults[2];
  if (!m4aMetadata) {
    fail(`Expected M4A metadata response, got ${JSON.stringify(metadataMessages)}`);
  }
  if (m4aMetadata.result?.fields?.title !== 'Native M4A Title') {
    fail(`Expected native M4A title metadata, got ${JSON.stringify(m4aMetadata)}`);
  }
  if (m4aMetadata.result?.fields?.artist !== 'Native M4A Artist') {
    fail(`Expected native M4A artist metadata, got ${JSON.stringify(m4aMetadata)}`);
  }
  if (m4aMetadata.result?.fields?.album !== 'Native M4A Album') {
    fail(`Expected native M4A album metadata, got ${JSON.stringify(m4aMetadata)}`);
  }
  if (m4aMetadata.result?.fields?.albumArtist !== 'Native M4A Album Artist') {
    fail(`Expected native M4A album artist metadata, got ${JSON.stringify(m4aMetadata)}`);
  }
  if (m4aMetadata.result?.fields?.trackNo !== 5 || m4aMetadata.result?.fields?.discNo !== 2 || m4aMetadata.result?.fields?.year !== 2024) {
    fail(`Expected native M4A numeric metadata, got ${JSON.stringify(m4aMetadata)}`);
  }
  if (m4aMetadata.result?.fields?.codec !== 'AAC' || m4aMetadata.result?.fields?.duration !== 98) {
    fail(`Expected native M4A codec/duration metadata, got ${JSON.stringify(m4aMetadata)}`);
  }
  if (m4aMetadata.result?.embeddedCoverStatus !== 'missing') {
    fail(`Native M4A metadata reader must not extract covers yet, got ${JSON.stringify(m4aMetadata)}`);
  }

  const wavMetadata = metadataResults[3];
  if (wavMetadata?.result?.fields?.title !== 'Native WAV Title' || wavMetadata.result?.fields?.artist !== 'Native WAV Artist') {
    fail(`Expected native WAV title/artist metadata, got ${JSON.stringify(wavMetadata)}`);
  }
  if (wavMetadata.result?.fields?.codec !== 'PCM' || wavMetadata.result?.fields?.sampleRate !== 44100 || wavMetadata.result?.fields?.bitDepth !== 16 || wavMetadata.result?.fields?.duration !== 1) {
    fail(`Expected native WAV codec/sample-rate/bit-depth/duration metadata, got ${JSON.stringify(wavMetadata)}`);
  }

  const aiffMetadata = metadataResults[4];
  if (aiffMetadata?.result?.fields?.title !== 'Native AIFF Title' || aiffMetadata.result?.fields?.artist !== 'Native AIFF Artist') {
    fail(`Expected native AIFF title/artist metadata, got ${JSON.stringify(aiffMetadata)}`);
  }
  if (aiffMetadata.result?.fields?.codec !== 'PCM' || aiffMetadata.result?.fields?.sampleRate !== 44100 || aiffMetadata.result?.fields?.bitDepth !== 16 || aiffMetadata.result?.fields?.duration !== 1) {
    fail(`Expected native AIFF codec/sample-rate/bit-depth/duration metadata, got ${JSON.stringify(aiffMetadata)}`);
  }

  const oggMetadata = metadataResults[5];
  if (oggMetadata?.result?.fields?.title !== 'Native OGG Title' || oggMetadata.result?.fields?.artist !== 'Native OGG Artist') {
    fail(`Expected native Ogg title/artist metadata, got ${JSON.stringify(oggMetadata)}`);
  }
  if (oggMetadata.result?.fields?.codec !== 'Vorbis' || oggMetadata.result?.fields?.sampleRate !== 44100 || oggMetadata.result?.fields?.duration !== 2) {
    fail(`Expected native Ogg codec/sample-rate/duration metadata, got ${JSON.stringify(oggMetadata)}`);
  }

  const opusMetadata = metadataResults[6];
  if (opusMetadata?.result?.fields?.title !== 'Native Opus Title' || opusMetadata.result?.fields?.artist !== 'Native Opus Artist') {
    fail(`Expected native Opus title/artist metadata, got ${JSON.stringify(opusMetadata)}`);
  }
  if (opusMetadata.result?.fields?.codec !== 'Opus' || opusMetadata.result?.fields?.sampleRate !== 48000 || opusMetadata.result?.fields?.duration !== 2) {
    fail(`Expected native Opus codec/sample-rate/duration metadata, got ${JSON.stringify(opusMetadata)}`);
  }

  console.log(`[smoke:native-scanner] PASS ${scannerPath}`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}
