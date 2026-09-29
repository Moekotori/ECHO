import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginStreamingProvider } from './PluginStreamingProvider';

const serviceMock = vi.hoisted(() => ({
  querySources: vi.fn(),
  resolveSourcePlayback: vi.fn(),
}));
const getPrivatePluginOperationsMock = vi.hoisted(() => vi.fn());

vi.mock('../../plugins/privateEntitlements', () => ({
  createPrivateFeatureError: (feature = 'echo-pro') => Object.assign(new Error('echo_pro_private_overlay_unavailable'), {
    code: 'echo_pro_private_overlay_unavailable',
    feature,
  }),
  getPrivatePluginOperations: getPrivatePluginOperationsMock,
}));

describe('PluginStreamingProvider', () => {
  beforeEach(() => {
    serviceMock.querySources.mockReset();
    serviceMock.resolveSourcePlayback.mockReset();
    getPrivatePluginOperationsMock.mockReset();
    getPrivatePluginOperationsMock.mockReturnValue(serviceMock);
  });

  it('maps plugin source candidates into playable streaming tracks', async () => {
    serviceMock.querySources.mockResolvedValue({
      providers: [{ pluginId: 'echo.source', id: 'direct', title: 'Direct' }],
      tracks: [{
        pluginId: 'echo.source',
        providerId: 'direct',
        providerTrackId: 'track-1',
        title: 'Plugin Song',
        artist: 'Plugin Artist',
        album: 'Plugin Album',
        duration: 123,
        coverUrl: 'https://example.com/cover.jpg',
        playable: true,
      }],
    });

    const provider = new PluginStreamingProvider();
    const result = await provider.search({ provider: 'plugin', query: 'song', page: 1, pageSize: 20 });

    expect(serviceMock.querySources).toHaveBeenCalledWith({ query: 'song', page: 1, pageSize: 20 });
    expect(result.provider).toBe('plugin');
    expect(result.tracks[0]).toMatchObject({
      provider: 'plugin',
      title: 'Plugin Song',
      artist: 'Plugin Artist',
      album: 'Plugin Album',
      duration: 123,
      coverThumb: 'https://example.com/cover.jpg',
      playable: true,
      qualities: ['standard'],
    });
    expect(result.tracks[0].providerTrackId).toEqual(expect.any(String));
    await expect(provider.getTrack({ providerTrackId: result.tracks[0].providerTrackId })).resolves.toMatchObject({
      title: 'Plugin Song',
    });
  });

  it('resolves playback through the owning plugin source provider', async () => {
    serviceMock.querySources.mockResolvedValue({
      providers: [],
      tracks: [{
        pluginId: 'echo.source',
        providerId: 'direct',
        providerTrackId: 'track-1',
        title: 'Plugin Song',
        playable: true,
      }],
    });
    serviceMock.resolveSourcePlayback.mockResolvedValue({
      url: 'https://example.com/track-1.mp3',
      expiresAt: null,
      mimeType: 'audio/mpeg',
      bitrate: 320000,
      sampleRate: 44100,
      bitDepth: 16,
      codec: 'mp3',
      headers: { Range: 'bytes=0-' },
      requiresProxy: false,
      supportsRange: true,
    });

    const provider = new PluginStreamingProvider();
    const result = await provider.search({ provider: 'plugin', query: 'song', page: 1, pageSize: 20 });
    const source = await provider.resolvePlayback({ provider: 'plugin', providerTrackId: result.tracks[0].providerTrackId });

    expect(serviceMock.resolveSourcePlayback).toHaveBeenCalledWith({
      pluginId: 'echo.source',
      providerId: 'direct',
      providerTrackId: 'track-1',
    });
    expect(source).toMatchObject({
      provider: 'plugin',
      providerTrackId: result.tracks[0].providerTrackId,
      url: 'https://example.com/track-1.mp3',
      mimeType: 'audio/mpeg',
      headers: { Range: 'bytes=0-' },
      supportsRange: true,
    });
  });

  it('rejects plugin streaming when ECHO Pro is not verified', async () => {
    getPrivatePluginOperationsMock.mockReturnValue(null);

    const provider = new PluginStreamingProvider();
    await expect(provider.search({ provider: 'plugin', query: 'song', page: 1, pageSize: 20 })).rejects.toThrow('echo_pro_private_overlay_unavailable');
    expect(serviceMock.querySources).not.toHaveBeenCalled();
  });
});

