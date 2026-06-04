// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryTrack } from '../../../shared/types/library';

const makeSpotifyTrack = (): LibraryTrack => ({
  id: 'streaming:spotify:abc123',
  path: 'streaming:spotify:abc123',
  stableKey: 'streaming:spotify:abc123',
  mediaType: 'streaming',
  provider: 'spotify',
  providerTrackId: 'abc123',
  title: 'Spotify Song',
  artist: 'Spotify Artist',
  album: 'Spotify Album',
  albumArtist: 'Spotify Album Artist',
  trackNo: 1,
  discNo: 1,
  year: 2026,
  genre: null,
  duration: 180,
  codec: 'spotify',
  sampleRate: null,
  bitDepth: null,
  bitrate: null,
  coverId: null,
  coverThumb: null,
  fieldSources: {},
});

const expectedUri = 'spotify:track:abc123';

type MockSpotifyPlayer = {
  addListener: (event: string, callback: (payload?: any) => void) => boolean;
  activateElement: () => Promise<void>;
  connect: () => Promise<boolean>;
  disconnect: () => void;
  getCurrentState: () => Promise<{ paused: boolean; position: number; duration: number } | null>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
};

const installEchoSpotifyApi = (overrides: Partial<Window['echo']['spotify']> = {}): Window['echo']['spotify'] => {
  const spotify = {
    getAccessToken: vi.fn().mockResolvedValue('access-token'),
    getDevices: vi.fn().mockResolvedValue([
      {
        id: 'connect-device',
        name: 'Spotify Desktop',
        type: 'Computer',
        isActive: true,
        isRestricted: false,
        volumePercent: 80,
      },
    ]),
    getPlaybackState: vi.fn().mockResolvedValue({
      isPlaying: true,
      progressMs: 12_000,
      itemUri: expectedUri,
      deviceId: 'connect-device',
      deviceName: 'Spotify Desktop',
    }),
    ensureConnectDevice: vi.fn().mockResolvedValue({
      deviceId: 'connect-device',
      deviceName: 'Spotify Desktop',
      launched: 'none' as const,
      waitedMs: 0,
    }),
    startPlayback: vi.fn().mockResolvedValue(undefined),
    transferPlayback: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
    setVolume: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  window.echo = {
    spotify,
    app: {
      getSettings: vi.fn().mockResolvedValue({ spotifyAutoLaunchOfficialPlayer: true }),
    },
    diagnostics: {
      reportRendererError: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Window['echo'];

  return spotify;
};

const installSpotifySdk = (player: Partial<MockSpotifyPlayer>): Record<string, (payload?: any) => void> => {
  const listeners: Record<string, (payload?: any) => void> = {};
  const nextPlayer = {
    addListener: vi.fn((event: string, callback: (payload?: any) => void) => {
      listeners[event] = callback;
      return true;
    }),
    activateElement: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn(),
    getCurrentState: vi.fn().mockResolvedValue(null),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
    setVolume: vi.fn().mockResolvedValue(undefined),
    ...player,
  };

  window.Spotify = {
    Player: vi.fn(() => nextPlayer),
  } as never;

  return listeners;
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  delete (window as Partial<Window>).Spotify;
  delete window.onSpotifyWebPlaybackSDKReady;
  delete (window as Partial<Window>).echo;
});

describe('spotifyPlayback', () => {
  it('falls back to an existing Spotify Connect device when SDK initialization fails', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const track = makeSpotifyTrack();
    const spotify = installEchoSpotifyApi();
    const listeners = installSpotifySdk({
      connect: vi.fn(async () => {
        listeners.initialization_error?.({ message: 'Failed to initialize player' });
        return true;
      }),
    });
    const { playSpotifyTrack } = await import('./spotifyPlayback');

    const status = await playSpotifyTrack(track, 21);

    expect(spotify.getDevices).toHaveBeenCalled();
    expect(spotify.ensureConnectDevice).not.toHaveBeenCalled();
    expect(spotify.transferPlayback).toHaveBeenCalledWith({ deviceId: 'connect-device', play: false });
    expect(spotify.startPlayback).toHaveBeenCalledWith({
      deviceId: 'connect-device',
      uri: expectedUri,
      positionMs: 21_000,
    });
    expect(status).toMatchObject({
      state: 'playing',
      currentTrackId: track.id,
      positionMs: 12_000,
    });
  });

  it('falls back to Connect when the SDK is still not ready after the quick handoff window', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const track = makeSpotifyTrack();
    const spotify = installEchoSpotifyApi();
    installSpotifySdk({
      connect: vi.fn(() => new Promise<boolean>(() => undefined)),
    });
    const { playSpotifyTrack } = await import('./spotifyPlayback');

    const promise = playSpotifyTrack(track);
    await vi.advanceTimersByTimeAsync(3_500);
    const status = await promise;

    expect(spotify.getDevices).toHaveBeenCalled();
    expect(spotify.startPlayback).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'connect-device' }));
    expect(status.state).toBe('playing');
  });

  it('keeps the observed Spotify progress after pause, resume, and seek commands', async () => {
    const track = makeSpotifyTrack();
    const spotify = installEchoSpotifyApi({
      getPlaybackState: vi
        .fn()
        .mockResolvedValueOnce({
          isPlaying: false,
          progressMs: 43_000,
          itemUri: expectedUri,
          deviceId: 'connect-device',
          deviceName: 'Spotify Desktop',
        })
        .mockResolvedValueOnce({
          isPlaying: true,
          progressMs: 44_000,
          itemUri: expectedUri,
          deviceId: 'connect-device',
          deviceName: 'Spotify Desktop',
        })
        .mockResolvedValueOnce({
          isPlaying: true,
          progressMs: 55_000,
          itemUri: expectedUri,
          deviceId: 'connect-device',
          deviceName: 'Spotify Desktop',
        }),
    });
    const { pauseSpotifyPlayback, resumeSpotifyPlayback, seekSpotifyPlayback } = await import('./spotifyPlayback');

    await expect(pauseSpotifyPlayback(track)).resolves.toMatchObject({ state: 'paused', positionMs: 43_000 });
    await expect(resumeSpotifyPlayback(track)).resolves.toMatchObject({ state: 'playing', positionMs: 44_000 });
    await expect(seekSpotifyPlayback(track, 55)).resolves.toMatchObject({ state: 'playing', positionMs: 55_000 });

    expect(spotify.pause).toHaveBeenCalledWith(null);
    expect(spotify.resume).toHaveBeenCalledWith(null);
    expect(spotify.seek).toHaveBeenCalledWith(55_000, null);
  });

  it('maps Spotify stop to an official-player pause while preserving the current position', async () => {
    const track = makeSpotifyTrack();
    const spotify = installEchoSpotifyApi({
      getPlaybackState: vi.fn().mockResolvedValue({
        isPlaying: false,
        progressMs: 61_000,
        itemUri: expectedUri,
        deviceId: 'connect-device',
        deviceName: 'Spotify Desktop',
      }),
    });
    const { stopSpotifyPlayback } = await import('./spotifyPlayback');

    const status = await stopSpotifyPlayback(track);

    expect(spotify.pause).toHaveBeenCalledWith(null);
    expect(status).toMatchObject({
      state: 'stopped',
      positionMs: 61_000,
    });
  });
});
