import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile } from 'music-metadata';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
const executableName = process.platform === 'win32' ? 'echo-native-scanner.exe' : 'echo-native-scanner';
const scannerPath = resolve(process.env.ECHO_NATIVE_SCANNER_PATH || join(projectRoot, 'electron-app', 'build', executableName));
const fixtureCount = Math.max(3, Number(process.env.ECHO_BENCH_METADATA_FILES ?? 900));
const sourceRoot = process.env.ECHO_BENCH_METADATA_ROOT ? resolve(process.env.ECHO_BENCH_METADATA_ROOT) : null;
const supportedExtensions = new Set(['.wav', '.aiff', '.aif', '.ogg', '.opus', '.flac', '.fla', '.mp3', '.m4a', '.mp4', '.m4b', '.m4p']);

const nowMs = () => performance.now();

const uint16Be = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value, 0);
  return buffer;
};

const uint16Le = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
};

const uint32Le = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
};

const uint64Le = (value) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value), 0);
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

const createMinimalFlacWithVorbisComments = (index) => {
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
  for (let byteIndex = 7; byteIndex >= 0; byteIndex -= 1) {
    streamInfo[10 + (7 - byteIndex)] = Number((packed >> BigInt(byteIndex * 8)) & 0xffn);
  }

  const comments = [
    `TITLE=Native Bench FLAC ${index}`,
    `ARTIST=Native Bench Artist ${index % 37}`,
    `ALBUM=Native Bench Album ${index % 19}`,
    `ALBUMARTIST=Native Bench Album Artist ${index % 11}`,
    `TRACKNUMBER=${(index % 12) + 1}/12`,
    `DATE=${2020 + (index % 6)}`,
    'GENRE=Bench',
  ];
  const vorbisComment = createVorbisCommentBlock('ECHO native metadata benchmark', comments);

  return Buffer.concat([
    Buffer.from('fLaC', 'ascii'),
    flacBlockHeader(0, streamInfo.length, false),
    streamInfo,
    flacBlockHeader(4, vorbisComment.length, true),
    vorbisComment,
  ]);
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

const createMinimalMp3WithId3v24 = (index) => {
  const frameData = Buffer.concat([
    createId3TextFrame('TIT2', `Native Bench MP3 ${index}`),
    createId3TextFrame('TPE1', `Native Bench Artist ${index % 37}`),
    createId3TextFrame('TALB', `Native Bench Album ${index % 19}`),
    createId3TextFrame('TPE2', `Native Bench Album Artist ${index % 11}`),
    createId3TextFrame('TRCK', `${(index % 12) + 1}/12`),
    createId3TextFrame('TDRC', `${2020 + (index % 6)}`),
    createId3TextFrame('TCON', 'Bench'),
  ]);
  return Buffer.concat([
    Buffer.from('ID3', 'ascii'),
    Buffer.from([4, 0, 0]),
    synchsafe32(frameData.length),
    frameData,
    createMpeg1Layer3CbrFrames(),
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

const createMinimalM4aWithMetadata = (index) => {
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
    mp4Atom(mp4CopyrightAtomType('n', 'a', 'm'), mp4TextDataAtom(`Native Bench M4A ${index}`)),
    mp4Atom(mp4CopyrightAtomType('A', 'R', 'T'), mp4TextDataAtom(`Native Bench Artist ${index % 37}`)),
    mp4Atom(mp4CopyrightAtomType('a', 'l', 'b'), mp4TextDataAtom(`Native Bench Album ${index % 19}`)),
    mp4Atom('aART', mp4TextDataAtom(`Native Bench Album Artist ${index % 11}`)),
    mp4Atom(mp4CopyrightAtomType('d', 'a', 'y'), mp4TextDataAtom(`${2020 + (index % 6)}`)),
    mp4Atom(mp4CopyrightAtomType('g', 'e', 'n'), mp4TextDataAtom('Bench')),
    mp4Atom('trkn', mp4PairDataAtom((index % 12) + 1, 12)),
    mp4Atom('disk', mp4PairDataAtom(1, 1)),
  ]));
  const meta = mp4Atom('meta', Buffer.concat([Buffer.from([0, 0, 0, 0]), ilst]));
  const udta = mp4Atom('udta', meta);
  const moov = mp4Atom('moov', Buffer.concat([mvhd, udta]));
  const ftyp = mp4Atom('ftyp', Buffer.concat([Buffer.from('M4A ', 'ascii'), uint32Be(0), Buffer.from('M4A mp42', 'ascii')]));
  return Buffer.concat([ftyp, moov]);
};

const riffChunk = (id, payload) => Buffer.concat([
  Buffer.from(id, 'ascii'),
  uint32Le(payload.length),
  payload,
  payload.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0),
]);

const createMinimalWaveWithInfo = (index) => {
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
    riffChunk('INAM', Buffer.from(`Native Bench WAV ${index}\0`, 'utf8')),
    riffChunk('IART', Buffer.from(`Native Bench Artist ${index % 37}\0`, 'utf8')),
    riffChunk('IPRD', Buffer.from(`Native Bench Album ${index % 19}\0`, 'utf8')),
    riffChunk('ICRD', Buffer.from(`${2020 + (index % 6)}\0`, 'utf8')),
    riffChunk('IGNR', Buffer.from('Bench\0', 'utf8')),
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

const createMinimalAiffWithMetadata = (index) => {
  const comm = Buffer.concat([
    uint16Be(2),
    uint32Be(44100),
    uint16Be(16),
    Buffer.from([0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]),
  ]);
  const body = Buffer.concat([
    Buffer.from('AIFF', 'ascii'),
    aiffChunk('COMM', comm),
    aiffChunk('NAME', Buffer.from(`Native Bench AIFF ${index}`, 'utf8')),
    aiffChunk('AUTH', Buffer.from(`Native Bench Artist ${index % 37}`, 'utf8')),
    aiffChunk('ANNO', Buffer.from(`Native Bench Album ${index % 19}`, 'utf8')),
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

const createMinimalOggVorbisWithComments = (index) => {
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
    createVorbisCommentBlock('ECHO native metadata benchmark', [
      `TITLE=Native Bench OGG ${index}`,
      `ARTIST=Native Bench Artist ${index % 37}`,
      `ALBUM=Native Bench Album ${index % 19}`,
      `DATE=${2020 + (index % 6)}`,
      'GENRE=Bench',
    ]),
  ]);
  return Buffer.concat([
    oggPage(id, { granule: 0, serial: 2, sequence: 0, headerType: 2 }),
    oggPage(comments, { granule: sampleRate * 2, serial: 2, sequence: 1 }),
  ]);
};

const createMinimalOpusWithComments = (index) => {
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
    createVorbisCommentBlock('ECHO native metadata benchmark', [
      `TITLE=Native Bench Opus ${index}`,
      `ARTIST=Native Bench Artist ${index % 37}`,
      `ALBUM=Native Bench Album ${index % 19}`,
      `DATE=${2020 + (index % 6)}`,
      'GENRE=Bench',
    ]),
  ]);
  return Buffer.concat([
    oggPage(id, { granule: 0, serial: 3, sequence: 0, headerType: 2 }),
    oggPage(comments, { granule: 48000 * 2 + 312, serial: 3, sequence: 1 }),
  ]);
};

const createSyntheticMetadataSet = () => {
  const root = join(tmpdir(), `echo-next-metadata-bench-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  const files = [];

  for (let index = 0; index < fixtureCount; index += 1) {
    const group = index % 7;
    const extension =
      group === 0 ? '.flac' :
      group === 1 ? '.mp3' :
      group === 2 ? '.m4a' :
      group === 3 ? '.wav' :
      group === 4 ? '.aiff' :
      group === 5 ? '.ogg' :
      '.opus';
    const filePath = join(root, `track-${String(index + 1).padStart(5, '0')}${extension}`);
    const contents =
      group === 0 ? createMinimalFlacWithVorbisComments(index + 1) :
      group === 1 ? createMinimalMp3WithId3v24(index + 1) :
      group === 2 ? createMinimalM4aWithMetadata(index + 1) :
      group === 3 ? createMinimalWaveWithInfo(index + 1) :
      group === 4 ? createMinimalAiffWithMetadata(index + 1) :
      group === 5 ? createMinimalOggVorbisWithComments(index + 1) :
      createMinimalOpusWithComments(index + 1);
    writeFileSync(filePath, contents);
    files.push(filePath);
  }

  return { root, files, synthetic: true };
};

const collectMetadataFiles = (root) => {
  const files = [];
  const stack = [root];
  while (stack.length > 0 && files.length < fixtureCount) {
    const directory = stack.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (supportedExtensions.has(extname(entry.name).toLocaleLowerCase())) {
        files.push(entryPath);
        if (files.length >= fixtureCount) {
          break;
        }
      }
    }
  }
  return { root, files, synthetic: false };
};

const parseNativeMessages = (stdout) => stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const runNativePersistent = async (files) => {
  if (!existsSync(scannerPath)) {
    throw new Error(`Native scanner binary not found: ${scannerPath}`);
  }

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

  const startedAt = nowMs();
  child.stdin.end(`${files.map((filePath) => JSON.stringify({ type: 'metadata', path: resolve(filePath), readCover: false })).join('\n')}\n`);
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code) => resolveExit(code));
  });
  const durationMs = nowMs() - startedAt;
  if (exitCode !== 0) {
    throw new Error(`Native metadata reader exited with ${exitCode}; stderr=${stderr.trim()}`);
  }

  const messages = parseNativeMessages(stdout);
  const metadata = messages.filter((message) => message.type === 'metadata');
  const unsupported = messages.filter((message) => message.type === 'unsupported');
  const errors = messages.filter((message) => message.type === 'error');
  return {
    durationMs,
    metadata,
    unsupported,
    errors,
    stdoutBytes: Buffer.byteLength(stdout, 'utf8'),
  };
};

const runNativeCold = async (files) => {
  const startedAt = nowMs();
  let ok = 0;
  let unsupported = 0;
  for (const filePath of files) {
    const result = await runNativePersistent([filePath]);
    ok += result.metadata.length;
    unsupported += result.unsupported.length + result.errors.length;
  }
  return {
    durationMs: nowMs() - startedAt,
    ok,
    unsupported,
  };
};

const runMusicMetadata = async (files) => {
  const startedAt = nowMs();
  let ok = 0;
  let failed = 0;
  for (const filePath of files) {
    try {
      await parseFile(filePath, { duration: false, skipCovers: true });
      ok += 1;
    } catch {
      failed += 1;
    }
  }
  return {
    durationMs: nowMs() - startedAt,
    ok,
    failed,
  };
};

const main = async () => {
  const source = sourceRoot ? collectMetadataFiles(sourceRoot) : createSyntheticMetadataSet();
  if (source.files.length === 0) {
    throw new Error(`No supported metadata files found in ${source.root}`);
  }

  const nativePersistent = await runNativePersistent(source.files);
  const nativeColdSampleFiles = source.files.slice(0, Math.min(60, source.files.length));
  const nativeCold = await runNativeCold(nativeColdSampleFiles);
  const jsMetadata = await runMusicMetadata(source.files);

  console.log(`[benchmark:metadata-reader] root: ${source.root}`);
  console.log(`[benchmark:metadata-reader] source: ${source.synthetic ? 'synthetic' : 'provided'}`);
  console.log(`[benchmark:metadata-reader] files: ${source.files.length}`);
  console.log(`[benchmark:metadata-reader] native binary: ${scannerPath}`);
  console.log(`[benchmark:metadata-reader] native persistent duration: ${nativePersistent.durationMs.toFixed(2)} ms`);
  console.log(`[benchmark:metadata-reader] native persistent ok/unsupported/errors: ${nativePersistent.metadata.length}/${nativePersistent.unsupported.length}/${nativePersistent.errors.length}`);
  console.log(`[benchmark:metadata-reader] native stdout bytes: ${nativePersistent.stdoutBytes}`);
  console.log(`[benchmark:metadata-reader] native cold sample files: ${nativeColdSampleFiles.length}`);
  console.log(`[benchmark:metadata-reader] native cold sample duration: ${nativeCold.durationMs.toFixed(2)} ms`);
  console.log(`[benchmark:metadata-reader] native cold sample ok/unsupported: ${nativeCold.ok}/${nativeCold.unsupported}`);
  console.log(`[benchmark:metadata-reader] music-metadata duration: ${jsMetadata.durationMs.toFixed(2)} ms`);
  console.log(`[benchmark:metadata-reader] music-metadata ok/failed: ${jsMetadata.ok}/${jsMetadata.failed}`);
  console.log(`[benchmark:metadata-reader] persistent vs music-metadata: ${(jsMetadata.durationMs / Math.max(1, nativePersistent.durationMs)).toFixed(2)}x`);
  console.log(`[benchmark:metadata-reader] persistent vs cold native sample (normalized): ${((nativeCold.durationMs / Math.max(1, nativeColdSampleFiles.length)) / (nativePersistent.durationMs / source.files.length)).toFixed(2)}x`);

  if (nativePersistent.metadata.length === 0) {
    throw new Error('Native metadata benchmark returned no metadata results.');
  }

  if (source.synthetic && nativePersistent.metadata.length !== source.files.length) {
    throw new Error(`Expected all synthetic files to parse natively, got ${nativePersistent.metadata.length}/${source.files.length}.`);
  }

  if (source.synthetic) {
    rmSync(source.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } else {
    for (const filePath of source.files.slice(0, 3)) {
      const stats = statSync(filePath);
      console.log(`[benchmark:metadata-reader] sample: ${filePath} (${stats.size} bytes)`);
    }
  }
};

main().catch((error) => {
  console.error(`[benchmark:metadata-reader] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
