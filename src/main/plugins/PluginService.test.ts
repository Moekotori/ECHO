import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AudioStatus } from '../../shared/types/audio';
import type { PluginManifest } from '../../shared/types/plugins';
import { normalizePluginCommandTimeoutMs, PluginService } from './PluginService';

const mocks = vi.hoisted(() => {
  const status = {
    host: 'ready',
    state: 'stopped',
    currentTrackId: null,
    currentFilePath: null,
    durationSeconds: 0,
    positionSeconds: 0,
    volume: 1,
  };
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const fakeAudioSession = {
    getStatus: vi.fn(() => status),
    play: vi.fn(async () => ({ ...status, state: 'playing' })),
    pause: vi.fn(async () => ({ ...status, state: 'paused' })),
    stop: vi.fn(() => ({ ...status, state: 'stopped' })),
    seek: vi.fn(async (positionSeconds: number) => ({ ...status, positionSeconds })),
    on: vi.fn((eventName: string, listener: (payload: unknown) => void) => {
      const set = listeners.get(eventName) ?? new Set<(payload: unknown) => void>();
      set.add(listener);
      listeners.set(eventName, set);
      return fakeAudioSession;
    }),
    emit: vi.fn((eventName: string, payload: unknown) => {
      listeners.get(eventName)?.forEach((listener) => listener(payload));
    }),
    removeAllListeners: vi.fn(() => listeners.clear()),
  };
  return {
    fakeAudioSession,
    openPathMock: vi.fn(async () => ''),
    getSummaryMock: vi.fn(() => ({ trackCount: 42, albumCount: 3, artistCount: 2 })),
    getTracksMock: vi.fn(() => ({
      items: [{
        id: 'track-1',
        mediaType: 'local',
        path: 'D:\\Music\\Song.flac',
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        duration: 180,
        coverThumb: 'echo-cover://thumb/cover-1',
        fieldSources: { title: 'embedded' },
        unavailable: false,
      }],
      page: 1,
      pageSize: 100,
      total: 1,
      hasMore: false,
    })),
    getTrackMock: vi.fn((trackId: string) => trackId === 'track-1'
      ? {
          id: 'track-1',
          mediaType: 'local',
          path: 'D:\\Music\\Song.flac',
          title: 'Song',
          artist: 'Artist',
          album: 'Album',
          duration: 180,
          codec: 'FLAC',
          sampleRate: 44_100,
          bitDepth: 16,
          bitrate: 920_000,
          coverThumb: 'echo-cover://thumb/cover-1',
          fieldSources: { title: 'embedded' },
          unavailable: false,
        }
      : null),
    getAppSettingsMock: vi.fn(() => ({ smtcEnabled: true })),
    setAppSettingsMock: vi.fn((patch: Record<string, unknown>) => ({ smtcEnabled: true, ...patch })),
    showSaveDialogMock: vi.fn(),
    showOpenDialogMock: vi.fn(),
    trashItemMock: vi.fn(async (_path: string) => undefined),
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: () => join(tmpdir(), 'echo-next-plugin-service-userdata'),
  },
  shell: {
    openPath: mocks.openPathMock,
    trashItem: mocks.trashItemMock,
  },
  dialog: {
    showSaveDialog: mocks.showSaveDialogMock,
    showOpenDialog: mocks.showOpenDialogMock,
  },
}));

vi.mock('../audio/AudioSession', () => ({
  getAudioSession: () => mocks.fakeAudioSession,
}));

vi.mock('../library/LibraryService', () => ({
  getLibraryService: () => ({
    getSummary: mocks.getSummaryMock,
    getTracks: mocks.getTracksMock,
    getTrack: mocks.getTrackMock,
  }),
}));

vi.mock('../app/appSettings', () => ({
  getAppSettings: mocks.getAppSettingsMock,
  setAppSettings: mocks.setAppSettingsMock,
}));

const writePlugin = (root: string, manifest: PluginManifest, script: string): void => {
  const directory = join(root, manifest.id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'echo.plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(join(directory, manifest.entry ?? 'plugin.js'), `${script}\n`, 'utf8');
};

describe('PluginService', () => {
  let pluginRoot: string;
  let service: PluginService;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.fakeAudioSession.removeAllListeners();
    mocks.fakeAudioSession.getStatus.mockClear();
    mocks.fakeAudioSession.play.mockClear();
    mocks.fakeAudioSession.pause.mockClear();
    mocks.fakeAudioSession.stop.mockClear();
    mocks.fakeAudioSession.seek.mockClear();
    mocks.getSummaryMock.mockClear();
    mocks.getTracksMock.mockClear();
    mocks.getTrackMock.mockClear();
    mocks.getAppSettingsMock.mockClear();
    mocks.setAppSettingsMock.mockClear();
    mocks.openPathMock.mockClear();
    mocks.showSaveDialogMock.mockReset();
    mocks.showOpenDialogMock.mockReset();
    mocks.trashItemMock.mockReset();
    mocks.trashItemMock.mockImplementation(async (path: string) => {
      rmSync(path, { recursive: true, force: true });
    });
    pluginRoot = mkdtempSync(join(tmpdir(), 'echo-next-plugin-service-'));
    service = new PluginService(pluginRoot);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    rmSync(pluginRoot, { recursive: true, force: true });
  });

  it('creates editable example plugins disabled by default', () => {
    const created = service.createExample('playback-panel');
    const result = service.list();

    expect(created.pluginId).toBe('echo.playback-panel');
    expect(existsSync(join(created.directory, 'echo.plugin.json'))).toBe(true);
    expect(existsSync(join(created.directory, 'plugin.js'))).toBe(true);
    expect(result.plugins[0]).toMatchObject({
      id: 'echo.playback-panel',
      enabled: false,
      status: 'disabled',
      permissions: ['playback:read'],
    });
  });

  it('creates a theme preset example with declarative theme contributions', () => {
    const created = service.createExample('theme-preset');
    const summary = service.list().plugins[0];

    expect(created.pluginId).toBe('echo.theme-preset');
    expect(summary).toMatchObject({
      id: 'echo.theme-preset',
      enabled: false,
      status: 'disabled',
      permissions: [],
    });
    expect(summary.security.themePresetCount).toBe(1);
    expect(summary.contributes.themePresets?.[0]).toMatchObject({
      id: 'aurora-glass',
      title: 'Aurora Glass',
      basePreset: 'classic',
    });
  });

  it('surfaces plugin-provided track context menu contributions', () => {
    const manifest: PluginManifest = {
      id: 'echo.audio-authenticity',
      name: 'Audio Authenticity',
      version: '0.0.1',
      apiVersion: 2,
      entry: 'plugin.js',
      permissions: ['library:read', 'audio:analyze'],
      contributes: {
        commands: [{ id: 'analyze-track', title: 'Analyze selected track authenticity' }],
        trackContextMenus: [{ id: 'audio-authenticity', title: '音频可信度', commandId: 'analyze-track', localOnly: true }],
      },
    };
    writePlugin(pluginRoot, manifest, [
      "echo.commands.register('analyze-track', async () => ({ title: 'OK' }));",
    ].join('\n'));
    const summary = service.list().plugins[0];

    expect(summary).toMatchObject({
      id: 'echo.audio-authenticity',
      enabled: false,
      status: 'disabled',
      permissions: ['library:read', 'audio:analyze'],
    });
    expect(summary.security.highRiskPermissions).toEqual(['audio:analyze']);
    expect(summary.commands.map((command) => command.id)).toEqual(['analyze-track']);
    expect(summary.contributes.trackContextMenus).toEqual([
      { id: 'audio-authenticity', title: '音频可信度', commandId: 'analyze-track', localOnly: true },
    ]);
  });

  it('requires explicit permission trust before enabling a plugin', () => {
    service.createExample('playback-panel');

    expect(() => service.enable({ pluginId: 'echo.playback-panel' })).toThrow('plugin_permission_confirmation_required');
    expect(service.list().plugins[0].enabled).toBe(false);
  });

  it('stops and removes a plugin directory when deleting it', async () => {
    const manifest: PluginManifest = {
      id: 'echo.delete-me',
      name: 'Delete Me',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      permissions: [],
    };
    writePlugin(pluginRoot, manifest, "echo.commands.register('ping', () => 'pong');");
    service.enable({ pluginId: 'echo.delete-me', trustedPermissions: [] });

    const result = await service.deletePlugin('echo.delete-me');

    expect(result).toMatchObject({
      pluginId: 'echo.delete-me',
      directory: join(pluginRoot, 'echo.delete-me'),
    });
    expect(mocks.trashItemMock).toHaveBeenCalledWith(join(pluginRoot, 'echo.delete-me'));
    expect(existsSync(join(pluginRoot, 'echo.delete-me'))).toBe(false);
    expect(service.list().plugins).toEqual([]);
    const state = JSON.parse(readFileSync(join(pluginRoot, 'plugin-state.json'), 'utf8')) as { plugins: Record<string, unknown> };
    expect(state.plugins['echo.delete-me']).toBeUndefined();
  });

  it('starts trusted plugins and runs registered commands through the sandbox API', async () => {
    service.createExample('playback-panel');
    service.enable({ pluginId: 'echo.playback-panel', trustedPermissions: ['playback:read'] });

    await service.runCommand({ pluginId: 'echo.playback-panel', commandId: 'show-status' });

    expect(mocks.fakeAudioSession.getStatus).toHaveBeenCalled();
    const summary = service.list().plugins[0];
    expect(summary.activity.commandRunCount).toBe(1);
    expect(summary.activity.lastCommandAt).toBeTruthy();
    expect(summary.security.sandboxedPanel).toBe(true);
    expect(service.getLogs('echo.playback-panel').some((entry) => entry.message.includes('当前播放状态'))).toBe(true);
  });

  it('throttles playback status events and writes only plugin-owned storage', async () => {
    const manifest: PluginManifest = {
      id: 'echo.status-cache',
      name: 'Status Cache',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      permissions: ['playback:read'],
    };
    writePlugin(pluginRoot, manifest, [
      "echo.events.on('playback:status', async (status) => {",
      "  await echo.storage.set('lastStatus', { state: status.state, trackId: status.currentTrackId });",
      '});',
    ].join('\n'));

    service.enable({ pluginId: 'echo.status-cache', trustedPermissions: ['playback:read'] });
    mocks.fakeAudioSession.emit('status', { state: 'playing', currentTrackId: 'track-old' });
    mocks.fakeAudioSession.emit('status', { state: 'playing', currentTrackId: 'track-new' });
    await vi.advanceTimersByTimeAsync(499);
    expect(existsSync(join(pluginRoot, 'echo.status-cache', 'plugin-storage.json'))).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const storage = JSON.parse(readFileSync(join(pluginRoot, 'echo.status-cache', 'plugin-storage.json'), 'utf8')) as {
      lastStatus: { state: string; trackId: string };
    };
    expect(storage.lastStatus).toEqual({ state: 'playing', trackId: 'track-new' });
  });

  it('caps library track queries and returns only requested fields', async () => {
    const manifest: PluginManifest = {
      id: 'echo.library-reader',
      name: 'Library Reader',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      permissions: ['library:read'],
    };
    writePlugin(pluginRoot, manifest, [
      "echo.commands.register('cache-tracks', async () => {",
      "  const page = await echo.library.getTracks({",
      '    pageSize: 500,',
      "    search: 'x'.repeat(140),",
      "    fields: ['id', 'title', 'fieldSources', 'unknown']",
      '  });',
      "  await echo.storage.set('tracksPage', page);",
      '});',
    ].join('\n'));

    service.enable({ pluginId: 'echo.library-reader', trustedPermissions: ['library:read'] });
    await service.runCommand({ pluginId: 'echo.library-reader', commandId: 'cache-tracks' });

    expect(mocks.getTracksMock).toHaveBeenCalledWith({
      page: 1,
      pageSize: 100,
      search: 'x'.repeat(120),
    });
    const storage = JSON.parse(readFileSync(join(pluginRoot, 'echo.library-reader', 'plugin-storage.json'), 'utf8')) as {
      tracksPage: { items: Array<Record<string, unknown>>; pageSize: number };
    };
    expect(storage.tracksPage.pageSize).toBe(100);
    expect(storage.tracksPage.items[0]).toEqual({
      id: 'track-1',
      title: 'Song',
      fieldSources: { title: 'embedded' },
    });
  });

  it('exports and imports plugin packages without runtime storage', async () => {
    service.createExample('command-tool');
    writeFileSync(join(pluginRoot, 'echo.command-tool', 'plugin-storage.json'), '{"secret":"nope"}\n', 'utf8');
    const packagePath = join(pluginRoot, 'echo.command-tool.echo');

    await expect(service.exportPluginPackage('echo.command-tool', packagePath)).resolves.toBe(packagePath);

    const payload = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      type: string;
      files: Array<{ path: string; content: string }>;
    };
    expect(payload.type).toBe('echo-next-plugin-package');
    expect(payload.files.map((file) => file.path)).toEqual(expect.arrayContaining(['echo.plugin.json', 'plugin.js']));
    expect(payload.files.map((file) => file.path)).not.toContain('plugin-storage.json');

    const importRoot = mkdtempSync(join(tmpdir(), 'echo-next-plugin-import-'));
    try {
      const importService = new PluginService(importRoot);
      await expect(importService.importPluginPackage(packagePath)).resolves.toMatchObject({
        pluginId: 'echo.command-tool',
        importedFileCount: 2,
      });
      expect(existsSync(join(importRoot, 'echo.command-tool', 'echo.plugin.json'))).toBe(true);
      expect(existsSync(join(importRoot, 'echo.command-tool', 'plugin.js'))).toBe(true);
      expect(existsSync(join(importRoot, 'echo.command-tool', 'plugin-storage.json'))).toBe(false);
      expect(importService.list().plugins[0]).toMatchObject({ id: 'echo.command-tool', enabled: false });
    } finally {
      rmSync(importRoot, { recursive: true, force: true });
    }
  });

  it('uses .echo as the default plugin package extension', async () => {
    service.createExample('command-tool');
    const packagePath = join(pluginRoot, 'echo.command-tool.echo');
    mocks.showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: packagePath });

    await expect(service.exportPluginPackage('echo.command-tool')).resolves.toBe(packagePath);

    expect(mocks.showSaveDialogMock).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: 'echo.command-tool-0.0.1.echo',
      filters: expect.arrayContaining([
        { name: 'ECHO plugin package', extensions: ['echo'] },
      ]),
    }));
  });

  it('isolates a plugin after repeated startup crashes', async () => {
    const manifest: PluginManifest = {
      id: 'echo.crasher',
      name: 'Crasher',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      permissions: [],
    };
    writePlugin(pluginRoot, manifest, "throw new Error('boom');");
    writeFileSync(join(pluginRoot, 'plugin-state.json'), JSON.stringify({
      plugins: {
        'echo.crasher': {
          enabled: true,
          trustedPermissions: [],
          crashTimestamps: [new Date().toISOString(), new Date().toISOString()],
        },
      },
    }, null, 2), 'utf8');

    service.scheduleAutoStart();
    await vi.advanceTimersByTimeAsync(1_200);
    await Promise.resolve();

    const summary = service.list().plugins[0];
    expect(summary.enabled).toBe(false);
    expect(summary.disabledByHost).toBe(true);
    expect(summary.status).toBe('disabled');
    expect(summary.error).toContain('boom');
    expect(service.getLogs('echo.crasher').some((entry) => entry.message.includes('plugin_disabled_after_repeated_errors'))).toBe(true);
  });

  it('rejects oversized storage writes and permissionless event subscriptions', async () => {
    const manifest: PluginManifest = {
      id: 'echo.guardrails',
      name: 'Guardrails',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      permissions: [],
    };
    writePlugin(pluginRoot, manifest, [
      "echo.commands.register('subscribe-library', () => {",
      "  echo.events.on('library:changed', () => {});",
      '});',
      "echo.commands.register('write-large', async () => {",
      "  await echo.storage.set('large', 'x'.repeat(70 * 1024));",
      '});',
    ].join('\n'));

    service.enable({ pluginId: 'echo.guardrails', trustedPermissions: [] });

    await expect(service.runCommand({ pluginId: 'echo.guardrails', commandId: 'subscribe-library' })).rejects.toThrow('plugin_permission_denied:library:read');
    await expect(service.runCommand({ pluginId: 'echo.guardrails', commandId: 'write-large' })).rejects.toThrow('plugin_storage_value_too_large');
  });

  it('rejects oversized command args and command results with stable log codes', async () => {
    const manifest: PluginManifest = {
      id: 'echo.command-limits',
      name: 'Command Limits',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      permissions: [],
    };
    writePlugin(pluginRoot, manifest, [
      "echo.commands.register('count-args', (...args) => args.length);",
      "echo.commands.register('large-result', () => 'x'.repeat(260 * 1024));",
    ].join('\n'));

    service.enable({ pluginId: 'echo.command-limits', trustedPermissions: [] });

    await expect(service.runCommand({
      pluginId: 'echo.command-limits',
      commandId: 'count-args',
      args: ['x'.repeat(70 * 1024)],
    })).rejects.toThrow('plugin_command_args_too_large');
    await expect(service.runCommand({ pluginId: 'echo.command-limits', commandId: 'large-result' })).rejects.toThrow('plugin_command_result_too_large');

    const messages = service.getLogs('echo.command-limits').map((entry) => entry.message);
    expect(messages.some((message) => message.includes('plugin_command_args_too_large'))).toBe(true);
    expect(messages.some((message) => message.includes('plugin_command_result_too_large'))).toBe(true);
  });

  it('clamps extended command timeouts to audio-analysis permission boundaries', async () => {
    expect(normalizePluginCommandTimeoutMs(12_000, [])).toBe(2_000);
    expect(normalizePluginCommandTimeoutMs(12_000, ['audio:analyze'])).toBe(12_000);
    expect(normalizePluginCommandTimeoutMs(24_000, ['audio:analyze'])).toBe(24_000);
    expect(normalizePluginCommandTimeoutMs(60_000, ['audio:analyze'])).toBe(24_000);
    expect(normalizePluginCommandTimeoutMs(1, ['audio:analyze'])).toBe(250);
  });

  it('stores sanitized command timeouts on runtime command summaries', async () => {
    const plainManifest: PluginManifest = {
      id: 'echo.plain-command-timeouts',
      name: 'Plain Command Timeouts',
      version: '0.0.1',
      apiVersion: 2,
      entry: 'plugin.js',
      permissions: [],
    };
    writePlugin(pluginRoot, plainManifest, [
      "echo.commands.register('plain', { title: 'Plain', timeoutMs: 12000 }, () => 'ok');",
      "echo.commands.register('tiny', { title: 'Tiny', timeoutMs: 1 }, () => 'ok');",
    ].join('\n'));

    service.enable({ pluginId: 'echo.plain-command-timeouts', trustedPermissions: [] });
    expect(service.list().plugins.find((plugin) => plugin.id === 'echo.plain-command-timeouts')?.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'plain', timeoutMs: 2_000 }),
      expect.objectContaining({ id: 'tiny', timeoutMs: 250 }),
    ]));

    const audioManifest: PluginManifest = {
      id: 'echo.command-timeouts',
      name: 'Command Timeouts',
      version: '0.0.1',
      apiVersion: 2,
      entry: 'plugin.js',
      permissions: ['audio:analyze'],
    };
    writePlugin(pluginRoot, audioManifest, [
      "echo.commands.register('plain', { title: 'Plain', timeoutMs: 24000 }, () => 'ok');",
      "echo.commands.register('tiny', { title: 'Tiny', timeoutMs: 1 }, () => 'ok');",
    ].join('\n'));

    service.enable({ pluginId: 'echo.command-timeouts', trustedPermissions: ['audio:analyze'] });
    expect(service.list().plugins.find((plugin) => plugin.id === 'echo.command-timeouts')?.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'plain', timeoutMs: 24_000 }),
      expect.objectContaining({ id: 'tiny', timeoutMs: 250 }),
    ]));
  });

  it('times out async event handlers without blocking other handlers or plugin summaries', async () => {
    const manifest: PluginManifest = {
      id: 'echo.event-timeout',
      name: 'Event Timeout',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      permissions: ['playback:read'],
    };
    writePlugin(pluginRoot, manifest, [
      "echo.events.on('playback:status', () => new Promise(() => undefined));",
      "echo.events.on('playback:status', async (status) => {",
      "  await echo.storage.set('lastStatus', status.currentTrackId);",
      '});',
    ].join('\n'));

    service.enable({ pluginId: 'echo.event-timeout', trustedPermissions: ['playback:read'] });
    mocks.fakeAudioSession.emit('status', { state: 'playing', currentTrackId: 'track-timeout' });

    await vi.advanceTimersByTimeAsync(500);
    const storage = JSON.parse(readFileSync(join(pluginRoot, 'echo.event-timeout', 'plugin-storage.json'), 'utf8')) as { lastStatus: string };
    expect(storage.lastStatus).toBe('track-timeout');

    await vi.advanceTimersByTimeAsync(2_000);
    expect(service.getLogs('echo.event-timeout').some((entry) => entry.message.includes('plugin_event_handler_timeout'))).toBe(true);
    expect(service.list().plugins[0]).toMatchObject({ id: 'echo.event-timeout', status: 'running' });
  });

  it('marks active network, reserved library writes, and limited permissions in the security summary', () => {
    const manifest: PluginManifest = {
      id: 'echo.reserved-permissions',
      name: 'Reserved Permissions',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      permissions: ['network', 'library:write', 'fs:plugin'],
    };
    writePlugin(pluginRoot, manifest, '');

    service.enable({ pluginId: 'echo.reserved-permissions', trustedPermissions: ['network', 'library:write', 'fs:plugin'] });

    const summary = service.list().plugins[0];
    expect(summary.security.reservedPermissions).toEqual(['library:write']);
    expect(summary.security.limitedPermissions).toEqual(['fs:plugin']);
    expect(summary.security.highRiskPermissions).toEqual(['network', 'library:write']);
    expect(summary.security.networkEnabled).toBe(true);
  });

  it('registers metadata providers and returns bounded candidates without writing library data', async () => {
    const manifest: PluginManifest = {
      id: 'echo.metadata-provider',
      name: 'Metadata Provider',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      permissions: ['library:read'],
      contributes: {
        metadataProviders: [{ id: 'tags', title: 'Tag Helper' }],
      },
    };
    writePlugin(pluginRoot, manifest, [
      "echo.metadata.registerProvider('tags', { title: 'Tag Helper' }, async ({ track }) => ({",
      '  candidates: [{',
      "    title: `${track.title} Remastered`,",
      "    artist: 'Plugin Artist',",
      "    album: 'Plugin Album',",
      "    genre: 'Plugin Genre',",
      '    year: 2026,',
      '    trackNo: 9999,',
      '    confidence: 2,',
      "    ignored: 'nope'",
      '  }]',
      '}));',
    ].join('\n'));

    service.enable({ pluginId: 'echo.metadata-provider', trustedPermissions: ['library:read'] });

    const result = await service.queryMetadata({ track: { id: 'track-1', title: 'Song', artist: 'Artist', duration: 180 } });

    expect(result.providers).toEqual([{ id: 'tags', title: 'Tag Helper', pluginId: 'echo.metadata-provider' }]);
    expect(result.candidates).toEqual([{
      title: 'Song Remastered',
      artist: 'Plugin Artist',
      album: 'Plugin Album',
      genre: 'Plugin Genre',
      year: 2026,
      trackNo: 999,
      confidence: 1,
      pluginId: 'echo.metadata-provider',
      providerId: 'tags',
    }]);
    const summary = service.list().plugins[0];
    expect(summary.security.metadataProviderCount).toBe(1);
    expect(summary.metadataProviders).toEqual([{ id: 'tags', title: 'Tag Helper', pluginId: 'echo.metadata-provider' }]);
    expect(mocks.getTracksMock).not.toHaveBeenCalled();
  });

  it('can query one metadata provider without invoking the others', async () => {
    const manifest: PluginManifest = {
      id: 'echo.metadata-filter',
      name: 'Metadata Filter',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      permissions: ['library:read'],
    };
    writePlugin(pluginRoot, manifest, [
      "echo.metadata.registerProvider('first', () => ({ candidates: [{ title: 'First' }] }));",
      "echo.metadata.registerProvider('second', () => { throw new Error('second should not run'); });",
    ].join('\n'));

    service.enable({ pluginId: 'echo.metadata-filter', trustedPermissions: ['library:read'] });

    await expect(service.queryMetadata({
      track: { title: 'Song' },
      provider: { pluginId: 'echo.metadata-filter', providerId: 'first' },
    })).resolves.toMatchObject({
      providers: [{ id: 'first', title: 'first', pluginId: 'echo.metadata-filter' }],
      candidates: [{ title: 'First', pluginId: 'echo.metadata-filter', providerId: 'first' }],
    });
    expect(service.getLogs('echo.metadata-filter').some((entry) => entry.message.includes('second should not run'))).toBe(false);
  });

  it('requires library read permission and logs metadata provider timeout failures', async () => {
    const noPermissionManifest: PluginManifest = {
      id: 'echo.metadata-denied',
      name: 'Metadata Denied',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      permissions: [],
    };
    writePlugin(pluginRoot, noPermissionManifest, [
      "echo.metadata.registerProvider('denied', () => ({ candidates: [{ title: 'Nope' }] }));",
    ].join('\n'));

    service.enable({ pluginId: 'echo.metadata-denied', trustedPermissions: [] });
    await expect(service.queryMetadata({ track: { title: 'Song' } })).resolves.toEqual({ providers: [], candidates: [] });
    expect(service.getLogs('echo.metadata-denied').some((entry) => entry.message.includes('plugin_permission_denied:library:read'))).toBe(true);

    const timeoutManifest: PluginManifest = {
      id: 'echo.metadata-timeout',
      name: 'Metadata Timeout',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      permissions: ['library:read'],
    };
    writePlugin(pluginRoot, timeoutManifest, [
      "echo.metadata.registerProvider('slow', () => new Promise(() => undefined));",
    ].join('\n'));
    service.enable({ pluginId: 'echo.metadata-timeout', trustedPermissions: ['library:read'] });

    const resultPromise = service.queryMetadata({ track: { title: 'Song' } });
    await vi.advanceTimersByTimeAsync(2_500);
    await expect(resultPromise).resolves.toMatchObject({
      providers: [{ id: 'slow', title: 'slow', pluginId: 'echo.metadata-timeout' }],
      candidates: [],
    });
    expect(service.getLogs('echo.metadata-timeout').some((entry) => entry.message.includes('plugin_metadata_provider_timeout'))).toBe(true);
  });

  it('registers bounded custom source providers and resolves explicit playback URLs', async () => {
    const manifest: PluginManifest = {
      id: 'echo.source-provider',
      name: 'Source Provider',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      permissions: ['sources:provide'],
      contributes: {
        sourceProviders: [{ id: 'direct', title: 'Direct URL' }],
      },
    };
    writePlugin(pluginRoot, manifest, [
      "echo.sources.registerProvider('direct', { title: 'Direct URL' }, {",
      '  search: async ({ query }) => ({',
      '    total: 1,',
      '    tracks: [{',
      "      providerTrackId: 'song-1',",
      "      title: `${query} Result`,",
      "      artist: 'Plugin Artist',",
      "      album: 'Plugin Album',",
      '      duration: 180,',
      '      playable: true,',
      "      ignored: 'nope'",
      '    }]',
      '  }),',
      '  resolvePlayback: async ({ providerTrackId }) => ({',
      '    url: `https://example.com/${providerTrackId}.mp3`,',
      "    mimeType: 'audio/mpeg',",
      '    bitrate: 999999999,',
      '    headers: { Range: "bytes=0-", "Bad Header": "nope" },',
      '    supportsRange: true',
      '  })',
      '});',
    ].join('\n'));

    service.enable({ pluginId: 'echo.source-provider', trustedPermissions: ['sources:provide'] });

    const result = await service.querySources({ query: 'Song', pageSize: 1000 });

    expect(result.providers).toEqual([{ id: 'direct', title: 'Direct URL', pluginId: 'echo.source-provider' }]);
    expect(result.tracks).toEqual([{
      providerTrackId: 'song-1',
      title: 'Song Result',
      artist: 'Plugin Artist',
      album: 'Plugin Album',
      duration: 180,
      playable: true,
      pluginId: 'echo.source-provider',
      providerId: 'direct',
    }]);
    await expect(service.resolveSourcePlayback({
      pluginId: 'echo.source-provider',
      providerId: 'direct',
      providerTrackId: 'song-1',
    })).resolves.toMatchObject({
      pluginId: 'echo.source-provider',
      providerId: 'direct',
      providerTrackId: 'song-1',
      url: 'https://example.com/song-1.mp3',
      mimeType: 'audio/mpeg',
      bitrate: 2000000,
      headers: { Range: 'bytes=0-' },
      supportsRange: true,
    });
    expect(service.list().plugins[0].security.sourceProviderCount).toBe(1);
  });

  it('requires source permission and rejects unsafe source playback URLs', async () => {
    const deniedManifest: PluginManifest = {
      id: 'echo.source-denied',
      name: 'Source Denied',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      permissions: [],
    };
    writePlugin(pluginRoot, deniedManifest, [
      "echo.sources.registerProvider('denied', { search: () => ({ tracks: [{ providerTrackId: 'x', title: 'Nope' }] }) });",
    ].join('\n'));
    service.enable({ pluginId: 'echo.source-denied', trustedPermissions: [] });
    await expect(service.querySources({ query: 'Song' })).resolves.toEqual({ providers: [], tracks: [] });
    expect(service.getLogs('echo.source-denied').some((entry) => entry.message.includes('plugin_permission_denied:sources:provide'))).toBe(true);

    const unsafeManifest: PluginManifest = {
      id: 'echo.source-unsafe',
      name: 'Source Unsafe',
      version: '0.0.1',
      apiVersion: 1,
      entry: 'plugin.js',
      permissions: ['sources:provide'],
    };
    writePlugin(pluginRoot, unsafeManifest, [
      "echo.sources.registerProvider('unsafe', {",
      "  search: () => ({ tracks: [{ providerTrackId: 'file', title: 'File URL', playable: true }] }),",
      "  resolvePlayback: () => ({ url: 'file:///C:/Music/song.flac' })",
      '});',
    ].join('\n'));
    service.enable({ pluginId: 'echo.source-unsafe', trustedPermissions: ['sources:provide'] });

    await expect(service.resolveSourcePlayback({
      pluginId: 'echo.source-unsafe',
      providerId: 'unsafe',
      providerTrackId: 'file',
    })).rejects.toThrow('plugin_source_playback_url_invalid');
  });

  it('supports v2 host-mediated network API with permission and header guardrails', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        method: init?.method,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const manifest: PluginManifest = {
      id: 'echo.network-provider',
      name: 'Network Provider',
      version: '0.0.1',
      apiVersion: 2,
      entry: 'plugin.js',
      permissions: ['network'],
      contributes: {
        settings: [{ id: 'endpoint', title: 'Endpoint', type: 'string', defaultValue: 'https://example.com/api' }],
      },
    };
    writePlugin(pluginRoot, manifest, [
      "echo.commands.register('fetch', async () => {",
      "  const settings = await echo.settings.getAll();",
      "  const result = await echo.net.fetchJson({",
      '    url: settings.endpoint,',
      "    method: 'GET',",
      "    headers: { Accept: 'application/json', Authorization: 'secret' }",
      '  });',
      "  await echo.storage.set('networkResult', result);",
      '});',
    ].join('\n'));

    service.enable({ pluginId: 'echo.network-provider', trustedPermissions: ['network'] });
    await service.runCommand({ pluginId: 'echo.network-provider', commandId: 'fetch' });

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/api', expect.objectContaining({
      method: 'GET',
    }));
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Accept: 'application/json' });
    const storage = JSON.parse(readFileSync(join(pluginRoot, 'echo.network-provider', 'plugin-storage.json'), 'utf8')) as {
      networkResult: { method: string; headers: Record<string, string> };
    };
    expect(storage.networkResult.method).toBe('GET');
    expect(storage.networkResult.headers.authorization).toBeUndefined();
    expect(service.list().plugins[0].activity.networkCallCount).toBe(1);
    expect(service.list().plugins[0].security.networkEnabled).toBe(true);
  });

  it('exposes host-controlled audio analysis only with the audio permission', async () => {
    const deniedManifest: PluginManifest = {
      id: 'echo.audio-denied',
      name: 'Audio Denied',
      version: '0.0.1',
      apiVersion: 2,
      entry: 'plugin.js',
      permissions: [],
    };
    writePlugin(pluginRoot, deniedManifest, [
      "echo.commands.register('analyze', async () => echo.audio.analyzeTrack('track-1'));",
    ].join('\n'));
    service.enable({ pluginId: 'echo.audio-denied', trustedPermissions: [] });

    await expect(service.runCommand({ pluginId: 'echo.audio-denied', commandId: 'analyze' })).rejects.toThrow('plugin_permission_denied:audio:analyze');

    const manifest: PluginManifest = {
      id: 'echo.audio-analyzer',
      name: 'Audio Analyzer',
      version: '0.0.1',
      apiVersion: 2,
      entry: 'plugin.js',
      permissions: ['audio:analyze'],
    };
    writePlugin(pluginRoot, manifest, [
      "echo.commands.register('analyze', async () => {",
      "  const report = await echo.audio.analyzeTrack({ trackId: 'track-1' });",
      "  await echo.storage.set('report', report);",
      '  return report;',
      '});',
    ].join('\n'));
    service.enable({ pluginId: 'echo.audio-analyzer', trustedPermissions: ['audio:analyze'] });

    await expect(service.runCommand({ pluginId: 'echo.audio-analyzer', commandId: 'analyze' })).resolves.toMatchObject({
      trackId: 'track-1',
      status: 'ready',
      verdict: 'trusted_lossless',
      metrics: {
        codec: 'FLAC',
        sampleRate: 44_100,
        bitDepth: 16,
        bitrate: 920_000,
      },
    });
    expect(mocks.getTrackMock).toHaveBeenCalledWith('track-1');
    const storage = JSON.parse(readFileSync(join(pluginRoot, 'echo.audio-analyzer', 'plugin-storage.json'), 'utf8')) as {
      report: { verdict: string; limitations: string[] };
    };
    expect(storage.report.verdict).toBe('trusted_lossless');
    expect(storage.report.limitations[0]).toContain('host-controlled');
    expect(service.list().plugins.find((plugin) => plugin.id === 'echo.audio-analyzer')?.security.highRiskPermissions).toEqual(['audio:analyze']);
  });

  it('keeps v2 plugin-owned settings isolated from application settings', async () => {
    const manifest: PluginManifest = {
      id: 'echo.owned-settings',
      name: 'Owned Settings',
      version: '0.0.1',
      apiVersion: 2,
      entry: 'plugin.js',
      permissions: [],
      contributes: {
        settings: [
          { id: 'mode', title: 'Mode', type: 'select', defaultValue: 'safe', options: [{ label: 'Safe', value: 'safe' }, { label: 'Fast', value: 'fast' }] },
          { id: 'secret', title: 'Secret', type: 'secret' },
        ],
      },
    };
    writePlugin(pluginRoot, manifest, [
      "echo.commands.register('read-settings', async () => {",
      "  await echo.storage.set('settings', await echo.settings.getAll());",
      '});',
    ].join('\n'));

    service.enable({ pluginId: 'echo.owned-settings', trustedPermissions: [] });
    expect(service.getPluginSettings('echo.owned-settings').values).toEqual({ mode: 'safe' });
    expect(service.updatePluginSettings('echo.owned-settings', { mode: 'fast', secret: 'token', unknown: 'ignored' }).values).toEqual({
      mode: 'fast',
      secret: 'token',
    });
    await service.runCommand({ pluginId: 'echo.owned-settings', commandId: 'read-settings' });

    expect(mocks.getAppSettingsMock).not.toHaveBeenCalled();
    expect(mocks.setAppSettingsMock).not.toHaveBeenCalled();
    const storage = JSON.parse(readFileSync(join(pluginRoot, 'echo.owned-settings', 'plugin-storage.json'), 'utf8')) as {
      settings: Record<string, unknown>;
    };
    expect(storage.settings).toEqual({ mode: 'fast', secret: 'token' });
  });

  it('registers bounded lyrics and cover providers as candidates only', async () => {
    const manifest: PluginManifest = {
      id: 'echo.media-candidates',
      name: 'Media Candidates',
      version: '0.0.1',
      apiVersion: 2,
      entry: 'plugin.js',
      permissions: ['library:read'],
      contributes: {
        lyricsProviders: [{ id: 'lyrics', title: 'Lyrics' }],
        coverProviders: [{ id: 'covers', title: 'Covers' }],
      },
    };
    writePlugin(pluginRoot, manifest, [
      "echo.lyrics.registerProvider('lyrics', { title: 'Lyrics' }, async () => ({",
      "  candidates: [{ title: 'LRC', language: 'ja', lrc: '[00:00.00]hello', confidence: 2 }]",
      '}));',
      "echo.covers.registerProvider('covers', { title: 'Covers' }, async () => ({",
      "  candidates: [{ imageUrl: 'https://example.com/cover.jpg', width: 99999, confidence: 2 }, { imageUrl: 'file:///bad.jpg' }]",
      '}));',
    ].join('\n'));

    service.enable({ pluginId: 'echo.media-candidates', trustedPermissions: ['library:read'] });

    await expect(service.queryLyrics({ track: { title: 'Song' } })).resolves.toMatchObject({
      providers: [{ id: 'lyrics', title: 'Lyrics', pluginId: 'echo.media-candidates' }],
      candidates: [{ title: 'LRC', language: 'ja', lrc: '[00:00.00]hello', confidence: 1, pluginId: 'echo.media-candidates', providerId: 'lyrics' }],
    });
    await expect(service.queryCovers({ track: { title: 'Song' } })).resolves.toMatchObject({
      providers: [{ id: 'covers', title: 'Covers', pluginId: 'echo.media-candidates' }],
      candidates: [{ imageUrl: 'https://example.com/cover.jpg', width: 12000, confidence: 1, pluginId: 'echo.media-candidates', providerId: 'covers' }],
    });
    const summary = service.list().plugins[0];
    expect(summary.security.lyricsProviderCount).toBe(1);
    expect(summary.security.coverProviderCount).toBe(1);
    expect(summary.activity.providerCallCount).toBe(2);
    expect(mocks.getTracksMock).not.toHaveBeenCalled();
  });

  it('overwrites imported packages only when explicitly allowed and keeps a backup', async () => {
    service.createExample('command-tool');
    const packagePath = join(pluginRoot, 'echo.command-tool.echo');
    await service.exportPluginPackage('echo.command-tool', packagePath);

    await expect(service.importPluginPackage(packagePath)).rejects.toThrow('plugin_import_target_exists');
    await expect(service.importPluginPackage(packagePath, { allowOverwrite: true })).resolves.toMatchObject({
      pluginId: 'echo.command-tool',
      importedFileCount: 2,
      checksum: expect.any(String),
      backedUpDirectory: expect.stringContaining('echo.command-tool.backup-'),
    });
    const summary = service.list().plugins[0];
    expect(summary.packageInfo.checksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(summary.enabled).toBe(false);
  });
});
