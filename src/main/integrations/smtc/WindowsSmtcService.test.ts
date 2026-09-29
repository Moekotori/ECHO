import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { WindowsSmtcService, resolveDefaultSmtcHostPath } from './WindowsSmtcService';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => 'D:\\Project\\ECHONext',
    getPath: () => 'D:\\Echo',
    isPackaged: false,
  },
}));

const createFakeHost = () => {
  const events = new EventEmitter();
  const host = {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: false,
    exitCode: null as number | null,
    kill: vi.fn(() => {
      host.killed = true;
      return true;
    }),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      events.on(event, listener);
      return host;
    }),
    once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      events.once(event, listener);
      return host;
    }),
    emit: (event: string, ...args: unknown[]) => {
      if (event === 'exit') {
        host.exitCode = typeof args[0] === 'number' ? args[0] : null;
      }
      return events.emit(event, ...args);
    },
  };

  return host;
};

const initializeReadyHost = async (
  service: WindowsSmtcService,
  host: ReturnType<typeof createFakeHost>,
): Promise<void> => {
  const initialized = service.initialize();
  host.stdout.write('{"type":"ready","protocolVersion":1,"capabilities":{"metadata":true,"timeline":true,"enabledActions":true,"seekCommands":true,"localArtwork":true}}\n');
  await initialized;
};

describe('WindowsSmtcService', () => {
  it('resolves the development helper path from the Electron app path', () => {
    expect(resolveDefaultSmtcHostPath()).toBe('D:\\Project\\ECHONext\\electron-app\\build\\echo-smtc-host.exe');
  });

  it('spawns the helper and writes JSONL updates', async () => {
    const host = createFakeHost();
    const writes: string[] = [];
    host.stdin.on('data', (chunk) => writes.push(chunk.toString()));
    const spawnHost = vi.fn(() => host as never);
    const service = new WindowsSmtcService({
      spawnHost,
      hostExists: () => true,
      resolveHostPath: () => 'D:\\Echo\\echo-smtc-host.exe',
      coverCache: { resolve: vi.fn(async () => 'D:\\Echo\\cover.png') },
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    await initializeReadyHost(service, host);
    await service.setEnabledActions({ play: true, pause: true, previous: true, next: true, seek: true });
    await service.setMetadata({
      trackId: 'track-1',
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      albumArtist: 'Album Artist',
      durationSeconds: 120,
      positionSeconds: 5,
      coverPath: 'D:\\Echo\\cover.webp',
      coverUrl: null,
    });
    await service.setPlaybackState('playing');

    expect(spawnHost).toHaveBeenCalledWith('D:\\Echo\\echo-smtc-host.exe', [], expect.objectContaining({ windowsHide: true }));
    expect(writes.join('')).toContain('"type":"setEnabledActions"');
    expect(writes.join('')).toContain('"seek":true');
    expect(writes.join('')).toContain('"type":"setMetadata"');
    expect(writes.join('')).toContain('"coverPath":"D:\\\\Echo\\\\cover.png"');
    expect(writes.join('')).toContain('"type":"setPlaybackState"');
    expect(service.getDiagnostics()).toMatchObject({
      hostState: 'running',
      initialized: true,
      hostPath: 'D:\\Echo\\echo-smtc-host.exe',
      lastMetadataTitle: 'Song',
      lastMetadataArtist: 'Artist',
      lastPlaybackState: 'playing',
      enabledActions: expect.objectContaining({ seek: true }),
    });
  });

  it('maps helper stdout commands back to SMTC handlers', async () => {
    const host = createFakeHost();
    const service = new WindowsSmtcService({
      spawnHost: vi.fn(() => host as never),
      hostExists: () => true,
      resolveHostPath: () => 'D:\\Echo\\echo-smtc-host.exe',
      coverCache: { resolve: vi.fn(async () => null) },
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    const handler = vi.fn();
    service.onCommand(handler);

    await initializeReadyHost(service, host);
    host.stdout.write('{"type":"command","command":"next"}\n');
    host.stdout.write('{"type":"command","command":"seek","positionSeconds":42.5}\n');

    expect(handler).toHaveBeenCalledWith('next');
    expect(handler).toHaveBeenCalledWith({ type: 'seek', positionSeconds: 42.5 });
    expect(service.getDiagnostics()).toMatchObject({
      lastCommand: { type: 'seek', positionSeconds: 42.5 },
    });
  });

  it('falls back quietly when the helper binary is missing', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const spawnHost = vi.fn();
    const service = new WindowsSmtcService({
      spawnHost,
      hostExists: () => false,
      resolveHostPath: () => 'D:\\Echo\\missing.exe',
      coverCache: { resolve: vi.fn(async () => null) },
      logger,
    });

    await service.setPlaybackState('playing');

    expect(spawnHost).not.toHaveBeenCalled();
    expect(service.getDiagnostics()).toMatchObject({ hostState: 'missing', lastError: expect.objectContaining({ source: 'service' }) });
    expect(logger.warn).toHaveBeenCalledWith(
      '[SMTC] Windows SMTC host binary is missing; using no-op bridge mode',
      expect.objectContaining({ hostPath: 'D:\\Echo\\missing.exe' }),
    );
  });

  it('falls back quietly when the helper stdin pipe breaks', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const host = createFakeHost();
    const writes: string[] = [];
    host.stdin.on('data', (chunk) => writes.push(chunk.toString()));
    const service = new WindowsSmtcService({
      spawnHost: vi.fn(() => host as never),
      hostExists: () => true,
      resolveHostPath: () => 'D:\\Echo\\echo-smtc-host.exe',
      coverCache: { resolve: vi.fn(async () => null) },
      logger,
    });

    await initializeReadyHost(service, host);
    host.stdin.emit('error', new Error('write EPIPE'));
    await service.setPlaybackState('playing');

    expect(logger.warn).toHaveBeenCalledWith(
      '[SMTC] Windows SMTC host stdin closed; using no-op bridge mode',
      expect.objectContaining({
        hostPath: 'D:\\Echo\\echo-smtc-host.exe',
        error: 'write EPIPE',
      }),
    );
    expect(writes.join('')).not.toContain('"type":"setPlaybackState"');
  });

  it('disposes the helper gracefully without force killing when it exits', async () => {
    const host = createFakeHost();
    const writes: string[] = [];
    host.stdin.on('data', (chunk) => writes.push(chunk.toString()));
    const service = new WindowsSmtcService({
      spawnHost: vi.fn(() => host as never),
      hostExists: () => true,
      resolveHostPath: () => 'D:\\Echo\\echo-smtc-host.exe',
      coverCache: { resolve: vi.fn(async () => null) },
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    await initializeReadyHost(service, host);
    const disposed = service.dispose();
    host.emit('exit', 0, null);
    await disposed;

    expect(writes.join('')).toContain('"type":"dispose"');
    expect(host.kill).not.toHaveBeenCalled();
  });

  it('force kills the helper when graceful dispose times out', async () => {
    vi.useFakeTimers();
    const logger = { info: vi.fn(), warn: vi.fn() };
    const host = createFakeHost();
    const service = new WindowsSmtcService({
      spawnHost: vi.fn(() => host as never),
      hostExists: () => true,
      resolveHostPath: () => 'D:\\Echo\\echo-smtc-host.exe',
      coverCache: { resolve: vi.fn(async () => null) },
      logger,
    });

    await initializeReadyHost(service, host);
    const stopped = service.stopGracefullyImpl(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await stopped;

    expect(host.kill).toHaveBeenCalledWith('SIGKILL');
    expect(logger.warn).toHaveBeenCalledWith('[SMTC] graceful shutdown timed out, force killing');
    vi.useRealTimers();
  });

  it('publishes metadata before remote artwork resolves and ignores stale artwork', async () => {
    const host = createFakeHost();
    const writes: string[] = [];
    host.stdin.on('data', (chunk) => writes.push(chunk.toString()));
    const coverResolvers: Array<(value: string | null) => void> = [];
    const service = new WindowsSmtcService({
      spawnHost: vi.fn(() => host as never),
      hostExists: () => true,
      resolveHostPath: () => 'D:\\Echo\\echo-smtc-host.exe',
      coverCache: {
        resolve: vi.fn(() => new Promise<string | null>((resolve) => coverResolvers.push(resolve))),
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    await initializeReadyHost(service, host);
    const firstMetadata = {
      trackId: 'track-1',
      title: 'First',
      artist: 'Artist',
      album: null,
      albumArtist: null,
      durationSeconds: 120,
      positionSeconds: 0,
      coverPath: null,
      coverUrl: 'https://example.com/first.jpg',
    };
    const secondMetadata = {
      ...firstMetadata,
      trackId: 'track-2',
      title: 'Second',
      coverUrl: 'https://example.com/second.jpg',
    };

    await service.setMetadata(firstMetadata);
    await service.setMetadata(secondMetadata);
    expect(writes.join('')).toContain('"title":"First"');
    expect(writes.join('')).toContain('"title":"Second"');
    expect(coverResolvers).toHaveLength(2);

    coverResolvers[0]?.('D:\\Echo\\first.png');
    await Promise.resolve();
    await Promise.resolve();
    expect(writes.join('')).not.toContain('first.png');
    coverResolvers[1]?.('D:\\Echo\\second.png');
    await vi.waitFor(() => expect(writes.join('')).toContain('second.png'));
  });
});
