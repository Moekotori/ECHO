import { afterEach, describe, expect, it, vi } from 'vitest';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import type { execFile } from 'node:child_process';
import { clearFfmpegToolchainCache, resolveFfmpegToolchainAsync } from './FfmpegToolchain';
import { DecoderPipeline } from './DecoderPipeline';

const versionOutput = 'ffmpeg version 8.1\nconfiguration: --enable-libsoxr\n';
const filtersOutput = ' .. aresample A->A Resample audio data.\n';
type Callback = (error: Error | null, stdout: string) => void;

describe('asynchronous FFmpeg startup inspection', () => {
  afterEach(clearFfmpegToolchainCache);

  it('keeps decoder construction and the event loop responsive while inspection is pending', async () => {
    const callbacks: Callback[] = [];
    const execAsync = vi.fn((_file, _args, _options, callback: Callback) => callbacks.push(callback));
    const execSync = vi.fn(() => { throw new Error('synchronous inspection must not run'); });
    const decoder = new DecoderPipeline({
      ffmpegPath: 'startup-ffmpeg', execFile: execAsync as unknown as typeof execFile,
      execFileSync: execSync as never, inspectToolchainAsync: true, requireHealthyFfmpeg: true,
    });
    expect(decoder.getToolchainInfo()).toBeNull();
    let ready = false;
    const pending = decoder.ensureToolchainReady().then(() => { ready = true; });
    await yieldToEventLoop();
    expect(ready).toBe(false);
    expect(execSync).not.toHaveBeenCalled();
    expect(() => decoder.decodeLocalFile({
      filePath: 'song.flac', startSeconds: 0, channels: 2, decoderOutputSampleRate: 48000,
    })).toThrow('ffmpeg_toolchain_not_ready');
    callbacks.shift()!(null, versionOutput);
    await yieldToEventLoop();
    callbacks.shift()!(null, filtersOutput);
    await pending;
    expect(decoder.getToolchainInfo()).toMatchObject({ healthy: true, soxrAvailable: true, version: '8.1' });
    expect(execAsync).toHaveBeenCalledTimes(2);
  });

  it('shares concurrent inspections and retains candidate fallback and capability checks', async () => {
    const execAsync = vi.fn((file, args, _options, callback: Callback) => {
      queueMicrotask(() => file === 'broken-ffmpeg'
        ? callback(new Error('invalid binary'), '')
        : callback(null, args.includes('-version') ? versionOutput : filtersOutput));
    });
    const dependencies = {
      ffmpegPath: 'broken-ffmpeg', systemFfmpegPath: 'working-ffmpeg',
      env: {}, resourcesPath: null, userDataPath: null, existsSync: () => false,
      execFile: execAsync as unknown as typeof execFile,
    };
    const results = await Promise.all([
      resolveFfmpegToolchainAsync(dependencies), resolveFfmpegToolchainAsync(dependencies),
    ]);
    expect(results[0]).toMatchObject({ path: 'working-ffmpeg', healthy: true, soxrAvailable: true });
    expect(results[1]).toEqual(results[0]);
    expect(execAsync).toHaveBeenCalledTimes(3);
    await resolveFfmpegToolchainAsync(dependencies);
    expect(execAsync).toHaveBeenCalledTimes(3);
  });

  it('reports unhealthy tools instead of inventing resampler support', async () => {
    const execAsync = vi.fn((_file, _args, _options, callback: Callback) => {
      queueMicrotask(() => callback(new Error('probe failed'), ''));
    });
    const info = await resolveFfmpegToolchainAsync({
      ffmpegPath: 'failed-ffmpeg', env: {}, resourcesPath: null, userDataPath: null,
      existsSync: () => false, execFile: execAsync as unknown as typeof execFile,
    });
    expect(info).toMatchObject({ healthy: false, soxrAvailable: false, error: 'probe failed' });
  });
});
