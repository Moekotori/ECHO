import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetadataResult } from '../libraryTypes';
import type { MetadataReader } from './MetadataReader';
import {
  getNativeMetadataReaderDiagnostics,
  NativeMetadataReader,
  NativeMetadataReaderPool,
  NativeThenTsMetadataReader,
} from './NativeMetadataReader';
import { logLibraryScanPerf } from '../../diagnostics/LibraryScanPerfDiagnostics';

vi.mock('../../diagnostics/LibraryScanPerfDiagnostics', () => ({
  logLibraryScanPerf: vi.fn(),
}));

const metadataResult = (title = 'Native Title'): MetadataResult => ({
  fields: {
    title,
    artist: 'Artist',
    album: 'Album',
    albumArtist: 'Artist',
    trackNo: null,
    discNo: null,
    year: null,
    genre: null,
    duration: 123,
    codec: 'FLAC',
    sampleRate: 44100,
    bitDepth: 16,
    bitrate: null,
    bpm: null,
    replayGainTrackGainDb: null,
    replayGainAlbumGainDb: null,
    replayGainTrackPeak: null,
    replayGainAlbumPeak: null,
    replayGainIntegratedLufs: null,
  },
  fieldSources: {
    title: 'embedded',
    artist: 'embedded',
    album: 'embedded',
    albumArtist: 'embedded',
    trackNo: 'unknown',
    discNo: 'unknown',
    year: 'unknown',
    genre: 'unknown',
    duration: 'technical',
    codec: 'technical',
    sampleRate: 'technical',
    bitDepth: 'technical',
    bitrate: 'unknown',
    bpm: 'unknown',
    replayGainTrackGainDb: 'unknown',
    replayGainAlbumGainDb: 'unknown',
    replayGainTrackPeak: 'unknown',
    replayGainAlbumPeak: 'unknown',
    replayGainIntegratedLufs: 'unknown',
  },
  embeddedMetadataStatus: 'present',
  embeddedCoverStatus: 'missing',
  warnings: [],
  errors: [],
  status: 'ok',
});

class StaticMetadataReader implements MetadataReader {
  calls: string[] = [];

  constructor(private readonly result: MetadataResult = metadataResult('TS Title')) {}

  async read(filePath: string): Promise<MetadataResult> {
    this.calls.push(filePath);
    return this.result;
  }
}

class SuspendableMetadataReader extends StaticMetadataReader {
  suspendCalls = 0;

  suspend(): void {
    this.suspendCalls += 1;
  }
}

class FailingMetadataReader implements MetadataReader {
  calls: string[] = [];

  async read(filePath: string): Promise<MetadataResult> {
    this.calls.push(filePath);
    throw new Error('native metadata unsupported');
  }
}

class FakeNativeProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  stdinText = '';

  constructor() {
    super();
    this.stdin.setEncoding('utf8');
    this.stdin.on('data', (chunk: string | Buffer) => {
      this.stdinText += String(chunk);
    });
  }

  kill(): boolean {
    this.killed = true;
    this.emit('exit', null, 'SIGTERM');
    return true;
  }

  finish(code = 0): void {
    this.stdout.end();
    this.emit('exit', code, null);
  }
}

const writeV2Handshake = (child: FakeNativeProcess): void => {
  child.stdout.write('{"type":"capabilities","protocolVersion":2,"supportedRequests":["metadata"],"features":["requestIds","singleMetadataResponse"]}\n');
  child.stdout.write('{"type":"ready"}\n');
};

const previousNativeMetadataReaderEnv = process.env.ECHO_NATIVE_METADATA_READER;
const previousDisableNativeMetadataReaderEnv = process.env.ECHO_DISABLE_NATIVE_METADATA_READER;
const previousNativeMetadataVerboseEnv = process.env.ECHO_NATIVE_METADATA_VERBOSE;
const previousNativeMetadataSummaryIntervalEnv = process.env.ECHO_NATIVE_METADATA_SUMMARY_INTERVAL;

const restoreEnv = (
  name:
    | 'ECHO_NATIVE_METADATA_READER'
    | 'ECHO_DISABLE_NATIVE_METADATA_READER'
    | 'ECHO_NATIVE_METADATA_VERBOSE'
    | 'ECHO_NATIVE_METADATA_SUMMARY_INTERVAL',
  value: string | undefined,
): void => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
};

describe('NativeThenTsMetadataReader', () => {
  afterEach(() => {
    restoreEnv('ECHO_NATIVE_METADATA_READER', previousNativeMetadataReaderEnv);
    restoreEnv('ECHO_DISABLE_NATIVE_METADATA_READER', previousDisableNativeMetadataReaderEnv);
    restoreEnv('ECHO_NATIVE_METADATA_VERBOSE', previousNativeMetadataVerboseEnv);
    restoreEnv('ECHO_NATIVE_METADATA_SUMMARY_INTERVAL', previousNativeMetadataSummaryIntervalEnv);
    vi.mocked(logLibraryScanPerf).mockClear();
  });

  it('uses the TS metadata reader by default', async () => {
    delete process.env.ECHO_NATIVE_METADATA_READER;
    delete process.env.ECHO_DISABLE_NATIVE_METADATA_READER;
    const nativeReader = new StaticMetadataReader(metadataResult('Native Title'));
    const tsReader = new StaticMetadataReader(metadataResult('TS Title'));
    const reader = new NativeThenTsMetadataReader(nativeReader, tsReader);

    await expect(reader.read('D:\\Music\\song.flac')).resolves.toMatchObject({
      fields: { title: 'TS Title' },
    });
    expect(nativeReader.calls).toEqual([]);
    expect(tsReader.calls).toEqual(['D:\\Music\\song.flac']);
  });

  it('uses the native metadata reader when the lab setting enables it', async () => {
    delete process.env.ECHO_NATIVE_METADATA_READER;
    delete process.env.ECHO_DISABLE_NATIVE_METADATA_READER;
    const nativeReader = new StaticMetadataReader(metadataResult('Native Title'));
    const tsReader = new StaticMetadataReader(metadataResult('TS Title'));
    const reader = new NativeThenTsMetadataReader(nativeReader, tsReader, console.warn, () => true);

    await expect(reader.read('D:\\Music\\song.flac')).resolves.toMatchObject({ fields: { title: 'Native Title' } });
    expect(nativeReader.calls).toEqual(['D:\\Music\\song.flac']);
    expect(tsReader.calls).toEqual([]);
  });

  it('keeps WAV metadata on the broader TS compatibility path when native metadata is enabled', async () => {
    process.env.ECHO_NATIVE_METADATA_READER = '1';
    delete process.env.ECHO_DISABLE_NATIVE_METADATA_READER;
    const nativeReader = new StaticMetadataReader(metadataResult('Native Title'));
    const tsReader = new StaticMetadataReader(metadataResult('TS WAV Title'));
    const reader = new NativeThenTsMetadataReader(nativeReader, tsReader);

    await expect(reader.read('D:\\Music\\song.wav')).resolves.toMatchObject({
      fields: { title: 'TS WAV Title' },
    });
    expect(nativeReader.calls).toEqual([]);
    expect(tsReader.calls).toEqual(['D:\\Music\\song.wav']);
  });

  it('falls back to TS quietly when native metadata is enabled but unsupported', async () => {
    process.env.ECHO_NATIVE_METADATA_READER = '1';
    delete process.env.ECHO_DISABLE_NATIVE_METADATA_READER;
    const nativeReader = new FailingMetadataReader();
    const tsReader = new StaticMetadataReader(metadataResult('Fallback Title'));
    const logger = vi.fn();
    const reader = new NativeThenTsMetadataReader(nativeReader, tsReader, logger);

    await expect(reader.read('D:\\Music\\song.flac')).resolves.toMatchObject({
      fields: { title: 'Fallback Title' },
    });
    expect(nativeReader.calls).toEqual(['D:\\Music\\song.flac']);
    expect(tsReader.calls).toEqual(['D:\\Music\\song.flac']);
    expect(logger).not.toHaveBeenCalled();
  });

  it('logs native metadata fallback details in verbose mode', async () => {
    process.env.ECHO_NATIVE_METADATA_READER = '1';
    process.env.ECHO_NATIVE_METADATA_VERBOSE = '1';
    delete process.env.ECHO_DISABLE_NATIVE_METADATA_READER;
    const nativeReader = new FailingMetadataReader();
    const tsReader = new StaticMetadataReader(metadataResult('Fallback Title'));
    const logger = vi.fn();
    const reader = new NativeThenTsMetadataReader(nativeReader, tsReader, logger);

    await expect(reader.read('D:\\Music\\song.flac')).resolves.toMatchObject({
      fields: { title: 'Fallback Title' },
    });
    expect(nativeReader.calls).toEqual(['D:\\Music\\song.flac']);
    expect(tsReader.calls).toEqual(['D:\\Music\\song.flac']);
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('falling back to TS reader'));
  });

  it('lets the disable env override the enable env and setting', async () => {
    process.env.ECHO_NATIVE_METADATA_READER = '1';
    process.env.ECHO_DISABLE_NATIVE_METADATA_READER = '1';
    const nativeReader = new StaticMetadataReader(metadataResult('Native Title'));
    const tsReader = new StaticMetadataReader(metadataResult('TS Title'));
    const reader = new NativeThenTsMetadataReader(nativeReader, tsReader, console.warn, () => true);

    await expect(reader.read('D:\\Music\\song.flac')).resolves.toMatchObject({
      fields: { title: 'TS Title' },
    });
    expect(nativeReader.calls).toEqual([]);
    expect(tsReader.calls).toEqual(['D:\\Music\\song.flac']);
  });

  it('accepts a complete native result without rerunning the TS reader', async () => {
    process.env.ECHO_NATIVE_METADATA_READER = '1';
    delete process.env.ECHO_DISABLE_NATIVE_METADATA_READER;
    const nativeReader = new StaticMetadataReader(metadataResult('Native Title'));
    const tsReader = new StaticMetadataReader({
      ...metadataResult('TS Title'),
      embeddedCover: {
        data: new Uint8Array([1, 2, 3]),
        mimeType: 'image/jpeg',
      },
      embeddedCoverStatus: 'present',
    });
    const reader = new NativeThenTsMetadataReader(nativeReader, tsReader);

    await expect(reader.read('D:\\Music\\song.flac')).resolves.toMatchObject({
      fields: { title: 'Native Title' },
      embeddedCoverStatus: 'missing',
    });
    expect(nativeReader.calls).toEqual(['D:\\Music\\song.flac']);
    expect(tsReader.calls).toEqual([]);
  });

  it('does not silently mix TS fields into a native result', async () => {
    process.env.ECHO_NATIVE_METADATA_READER = '1';
    delete process.env.ECHO_DISABLE_NATIVE_METADATA_READER;
    const nativeReader = new StaticMetadataReader({
      ...metadataResult('Native Title'),
      fields: {
        ...metadataResult('Native Title').fields,
        duration: 0,
        sampleRate: null,
        bitrate: null,
      },
      fieldSources: {
        duration: 'unknown',
        sampleRate: 'unknown',
        bitrate: 'unknown',
      },
    });
    const tsReader = new StaticMetadataReader({
      ...metadataResult('TS Title'),
      fields: {
        ...metadataResult('TS Title').fields,
        duration: 220,
        sampleRate: 44100,
        bitrate: 320000,
      },
    });
    const reader = new NativeThenTsMetadataReader(nativeReader, tsReader);

    await expect(reader.read('D:\\Music\\song.mp3')).resolves.toMatchObject({
      fields: {
        title: 'Native Title',
        duration: 0,
        sampleRate: null,
        bitrate: null,
      },
    });
    expect(nativeReader.calls).toEqual(['D:\\Music\\song.mp3']);
    expect(tsReader.calls).toEqual([]);
  });

  it('skips native metadata for unsupported extensions and uses TS directly', async () => {
    process.env.ECHO_NATIVE_METADATA_READER = '1';
    delete process.env.ECHO_DISABLE_NATIVE_METADATA_READER;
    const nativeReader = new StaticMetadataReader(metadataResult('Native Title'));
    const tsReader = new StaticMetadataReader(metadataResult('TS Title'));
    const logger = vi.fn();
    const reader = new NativeThenTsMetadataReader(nativeReader, tsReader, logger);

    await expect(reader.read('D:\\Music\\song.wma')).resolves.toMatchObject({
      fields: { title: 'TS Title' },
    });

    expect(nativeReader.calls).toEqual([]);
    expect(tsReader.calls).toEqual(['D:\\Music\\song.wma']);
    expect(logger).not.toHaveBeenCalled();
    expect(vi.mocked(logLibraryScanPerf)).not.toHaveBeenCalled();
  });

  it('stops native processes when switching back to TS and can be enabled again', async () => {
    process.env.ECHO_NATIVE_METADATA_READER = '1';
    delete process.env.ECHO_DISABLE_NATIVE_METADATA_READER;
    const nativeReader = new SuspendableMetadataReader(metadataResult('Native Title'));
    const tsReader = new StaticMetadataReader(metadataResult('TS Title'));
    const reader = new NativeThenTsMetadataReader(nativeReader, tsReader);

    await expect(reader.read('D:\\Music\\one.flac')).resolves.toMatchObject({ fields: { title: 'Native Title' } });
    delete process.env.ECHO_NATIVE_METADATA_READER;
    await expect(reader.read('D:\\Music\\two.flac')).resolves.toMatchObject({ fields: { title: 'TS Title' } });
    expect(nativeReader.suspendCalls).toBe(1);

    process.env.ECHO_NATIVE_METADATA_READER = '1';
    await expect(reader.read('D:\\Music\\three.flac')).resolves.toMatchObject({ fields: { title: 'Native Title' } });
    expect(nativeReader.calls).toEqual(['D:\\Music\\one.flac', 'D:\\Music\\three.flac']);
  });

  it('does not log native metadata summaries for small successful scans by default', async () => {
    process.env.ECHO_NATIVE_METADATA_READER = '1';
    delete process.env.ECHO_DISABLE_NATIVE_METADATA_READER;
    const nativeReader = new StaticMetadataReader(metadataResult('Native Title'));
    const tsReader = new StaticMetadataReader(metadataResult('TS Title'));
    const reader = new NativeThenTsMetadataReader(nativeReader, tsReader);

    for (let index = 0; index < 50; index += 1) {
      await reader.read(`D:\\Music\\song-${index}.flac`);
    }

    expect(nativeReader.calls).toHaveLength(50);
    expect(tsReader.calls).toHaveLength(0);
    expect(vi.mocked(logLibraryScanPerf)).not.toHaveBeenCalled();
  });

  it('logs native metadata summaries at the configured interval', async () => {
    process.env.ECHO_NATIVE_METADATA_READER = '1';
    process.env.ECHO_NATIVE_METADATA_SUMMARY_INTERVAL = '50';
    delete process.env.ECHO_DISABLE_NATIVE_METADATA_READER;
    const nativeReader = new StaticMetadataReader(metadataResult('Native Title'));
    const tsReader = new StaticMetadataReader(metadataResult('TS Title'));
    const reader = new NativeThenTsMetadataReader(nativeReader, tsReader);

    for (let index = 0; index < 100; index += 1) {
      await reader.read(`D:\\Music\\song-${index}.flac`);
    }

    expect(nativeReader.calls).toHaveLength(100);
    expect(tsReader.calls).toHaveLength(0);
    expect(vi.mocked(logLibraryScanPerf)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(logLibraryScanPerf)).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'nativeMetadataReader',
      fileCount: 50,
      detail: expect.stringContaining('nativeOk=50'),
    }));
  });
});

describe('NativeMetadataReader', () => {
  it('sends a metadata NDJSON request and parses a metadata result', async () => {
    const child = new FakeNativeProcess();
    const nativeResult = metadataResult('06 \u00b9\u00c2\u00b6\u00c0\u00a4\u00ca\u00d1\u00b2\u00c0\u00f1');
    nativeResult.fields.genre = '\u00a5\u00a2\u00a5\u00cb\u00a5\u00e1';
    const reader = new NativeMetadataReader({
      executablePath: 'echo-native-scanner.exe',
      spawnProcess: vi.fn(() => child as unknown as ChildProcessWithoutNullStreams),
    });

    child.stdin.once('data', () => queueMicrotask(() => {
      const request = JSON.parse(child.stdinText.trim());
      child.stdout.write(
        '{"type":"capabilities","protocolVersion":2,"supportedRequests":["scan","metadata"],"features":["persistentMetadata","testFeature"],"metadataFormats":["FLAC","OPUS"],"metadataExtensions":[".flac",".opus"]}\n',
      );
      child.stdout.write('{"type":"ready"}\n');
      child.stdout.write(`${JSON.stringify({
        type: 'metadata',
        requestId: request.requestId,
        path: request.path,
        result: {
          ...nativeResult,
          embeddedCoverStatus: 'present',
          embeddedCoverBase64: 'AQID',
          embeddedCoverMimeType: 'image/jpeg',
        },
      })}\n`);
      child.finish();
    }));

    await expect(reader.read('D:/Music/song.flac')).resolves.toMatchObject({
      fields: { title: '06 \u5b64\u72ec\u306a\u5de1\u793c', genre: '\u30a2\u30cb\u30e1' },
      embeddedCover: { mimeType: 'image/jpeg' },
    });
    expect(getNativeMetadataReaderDiagnostics(() => false)).toMatchObject({
      protocolVersion: 2,
      workerFeatures: ['persistentMetadata', 'testFeature'],
      supportedRequests: ['scan', 'metadata'],
      supportedFormats: ['FLAC', 'OPUS'],
      supportedExtensions: ['.flac', '.opus'],
    });
    expect(JSON.parse(child.stdinText)).toMatchObject({
      type: 'metadata',
      requestId: expect.any(String),
      readCover: true,
    });
  });

  it('omits embedded cover payloads when the caller only needs metadata', async () => {
    const child = new FakeNativeProcess();
    const reader = new NativeMetadataReader({
      executablePath: 'echo-native-scanner.exe',
      spawnProcess: vi.fn(() => child as unknown as ChildProcessWithoutNullStreams),
    });

    child.stdin.once('data', () => queueMicrotask(() => {
      const request = JSON.parse(child.stdinText.trim());
      writeV2Handshake(child);
      child.stdout.write(`${JSON.stringify({
        type: 'metadata',
        requestId: request.requestId,
        path: request.path,
        result: {
          ...metadataResult('Metadata Only'),
          embeddedCoverStatus: 'present',
        },
      })}\n`);
      child.finish();
    }));

    const result = await reader.read('D:/Music/song.flac', { readCover: false });
    expect(result).toMatchObject({
      fields: { title: 'Metadata Only' },
      embeddedCoverStatus: 'present',
    });
    expect(result.embeddedCover).toBeUndefined();
    expect(JSON.parse(child.stdinText)).toMatchObject({
      type: 'metadata',
      readCover: false,
    });
  });

  it('reuses one native process for serial metadata requests', async () => {
    const child = new FakeNativeProcess();
    const spawnProcess = vi.fn(() => child as unknown as ChildProcessWithoutNullStreams);
    const reader = new NativeMetadataReader({
      executablePath: 'echo-native-scanner.exe',
      spawnProcess,
    });

    let responseCount = 0;
    child.stdin.on('data', () => {
      if (responseCount === 0) {
        writeV2Handshake(child);
      }
      const requestCount = child.stdinText.trim().split(/\r?\n/).filter(Boolean).length;
      while (responseCount < requestCount) {
        responseCount += 1;
        const request = JSON.parse(child.stdinText.trim().split(/\r?\n/)[responseCount - 1]);
        const title = responseCount === 1 ? 'One' : 'Two';
        child.stdout.write(`${JSON.stringify({
          type: 'metadata',
          requestId: request.requestId,
          path: request.path,
          result: metadataResult(title),
        })}\n`);
        if (responseCount === 2) {
          queueMicrotask(() => child.finish());
        }
      }
    });

    await expect(reader.read('D:/Music/one.flac')).resolves.toMatchObject({
      fields: { title: 'One' },
    });

    await expect(reader.read('D:/Music/two.flac')).resolves.toMatchObject({
      fields: { title: 'Two' },
    });

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    const requests = child.stdinText
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ type: 'metadata', requestId: expect.any(String), readCover: true });
    expect(requests[1]).toMatchObject({ type: 'metadata', requestId: expect.any(String), readCover: true });
    expect(requests[0].requestId).not.toBe(requests[1].requestId);
  });

  it('throws on explicit native metadata unsupported response', async () => {
    const child = new FakeNativeProcess();
    const reader = new NativeMetadataReader({
      executablePath: 'echo-native-scanner.exe',
      spawnProcess: vi.fn(() => child as unknown as ChildProcessWithoutNullStreams),
    });

    child.stdin.once('data', () => queueMicrotask(() => {
      const request = JSON.parse(child.stdinText.trim());
      writeV2Handshake(child);
      child.stdout.write(`${JSON.stringify({
        type: 'unsupported',
        requestId: request.requestId,
        path: request.path,
        message: 'native metadata reader is not implemented yet',
      })}\n`);
      child.finish();
    }));

    await expect(reader.read('D:/Music/song.flac')).rejects.toThrow('not implemented yet');
  });

  it('rejects an incomplete native field contract so the caller can fall back to TS', async () => {
    const child = new FakeNativeProcess();
    const reader = new NativeMetadataReader({
      executablePath: 'echo-native-scanner.exe',
      spawnProcess: vi.fn(() => child as unknown as ChildProcessWithoutNullStreams),
    });

    child.stdin.once('data', () => queueMicrotask(() => {
      const request = JSON.parse(child.stdinText.trim());
      writeV2Handshake(child);
      child.stdout.write(`${JSON.stringify({
        type: 'metadata',
        requestId: request.requestId,
        path: request.path,
        result: { ...metadataResult('Incomplete'), fieldSources: { title: 'embedded' } },
      })}\n`);
    }));

    await expect(reader.read('D:/Music/song.flac')).rejects.toThrow('invalid metadata result');
    expect(child.killed).toBe(true);
  });

  it('isolates an exited generation from the replacement process', async () => {
    const first = new FakeNativeProcess();
    const second = new FakeNativeProcess();
    const spawnProcess = vi.fn()
      .mockReturnValueOnce(first as unknown as ChildProcessWithoutNullStreams)
      .mockReturnValueOnce(second as unknown as ChildProcessWithoutNullStreams);
    const reader = new NativeMetadataReader({ executablePath: 'echo-native-scanner.exe', spawnProcess });

    const failedRead = reader.read('D:/Music/old.flac');
    await vi.waitFor(() => expect(first.stdinText).not.toBe(''));
    const oldRequest = JSON.parse(first.stdinText.trim());
    writeV2Handshake(first);
    first.emit('exit', 9, null);
    await expect(failedRead).rejects.toThrow('exited before response');

    const replacementRead = reader.read('D:/Music/new.flac');
    await vi.waitFor(() => expect(second.stdinText).not.toBe(''));
    const newRequest = JSON.parse(second.stdinText.trim());
    writeV2Handshake(second);
    first.stdout.write(`${JSON.stringify({
      type: 'metadata',
      requestId: oldRequest.requestId,
      path: oldRequest.path,
      result: metadataResult('Stale'),
    })}\n`);
    first.stdout.end();
    second.stdout.write(`${JSON.stringify({
      type: 'metadata',
      requestId: newRequest.requestId,
      path: newRequest.path,
      result: metadataResult('Replacement'),
    })}\n`);

    await expect(replacementRead).resolves.toMatchObject({ fields: { title: 'Replacement' } });
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    reader.dispose();
  });

  it('ignores a timed-out process response after a replacement generation takes over', async () => {
    const first = new FakeNativeProcess();
    const second = new FakeNativeProcess();
    const spawnProcess = vi.fn()
      .mockReturnValueOnce(first as unknown as ChildProcessWithoutNullStreams)
      .mockReturnValueOnce(second as unknown as ChildProcessWithoutNullStreams);
    const reader = new NativeMetadataReader({
      executablePath: 'echo-native-scanner.exe',
      spawnProcess,
      requestTimeoutMs: 200,
    });

    const timedOutRead = reader.read('D:/Music/timeout.flac');
    const timedOutExpectation = expect(timedOutRead).rejects.toThrow('timed out after 200ms');
    await vi.waitFor(() => expect(first.stdinText).not.toBe(''));
    const oldRequest = JSON.parse(first.stdinText.trim());
    writeV2Handshake(first);
    await timedOutExpectation;

    const replacementRead = reader.read('D:/Music/replacement.flac');
    await vi.waitFor(() => expect(second.stdinText).not.toBe(''));
    const newRequest = JSON.parse(second.stdinText.trim());
    writeV2Handshake(second);
    first.stdout.write(`${JSON.stringify({
      type: 'metadata',
      requestId: oldRequest.requestId,
      path: oldRequest.path,
      result: metadataResult('Too Late'),
    })}\n`);
    second.stdout.write(`${JSON.stringify({
      type: 'metadata',
      requestId: newRequest.requestId,
      path: newRequest.path,
      result: metadataResult('Replacement'),
    })}\n`);

    await expect(replacementRead).resolves.toMatchObject({ fields: { title: 'Replacement' } });
    expect(first.killed).toBe(true);
    reader.dispose();
  });

  it('uses separate processes for concurrent pool work and disposes all of them', async () => {
    const children = [new FakeNativeProcess(), new FakeNativeProcess()];
    const spawnProcess = vi.fn()
      .mockReturnValueOnce(children[0] as unknown as ChildProcessWithoutNullStreams)
      .mockReturnValueOnce(children[1] as unknown as ChildProcessWithoutNullStreams);
    const pool = new NativeMetadataReaderPool({
      executablePath: 'echo-native-scanner.exe',
      spawnProcess,
      poolSize: 2,
    });

    const reads = [pool.read('D:/Music/one.flac'), pool.read('D:/Music/two.flac')];
    await vi.waitFor(() => expect(children.every((child) => child.stdinText !== '')).toBe(true));
    children.forEach((child, index) => {
      const request = JSON.parse(child.stdinText.trim());
      writeV2Handshake(child);
      child.stdout.write(`${JSON.stringify({
        type: 'metadata',
        requestId: request.requestId,
        path: request.path,
        result: metadataResult(index === 0 ? 'One' : 'Two'),
      })}\n`);
    });

    await expect(Promise.all(reads)).resolves.toMatchObject([
      { fields: { title: 'One' } },
      { fields: { title: 'Two' } },
    ]);
    pool.dispose();
    expect(children.every((child) => child.killed)).toBe(true);
  });
});
