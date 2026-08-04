import type { LibraryTrack } from '../../../shared/types/library';
import type { PlaybackStatus } from '../../../shared/types/playback';
import { translateCurrentLocale } from '../../i18n/I18nProvider';

type SpotifyError = {
  message?: string;
};

type SpotifyPlayerState = {
  paused: boolean;
  position: number;
  duration: number;
};

type SpotifyPlayer = {
  addListener: (event: string, callback: (payload: any) => void) => boolean;
  activateElement?: () => Promise<void>;
  connect: () => Promise<boolean>;
  disconnect: () => void;
  getCurrentState: () => Promise<SpotifyPlayerState | null>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
};

type SpotifySdk = {
  Player: new (options: {
    name: string;
    getOAuthToken: (callback: (token: string) => void) => void;
    volume?: number;
  }) => SpotifyPlayer;
};

type SpotifyLibraryTrack = LibraryTrack & {
  mediaType: 'streaming';
  provider: 'spotify';
};

declare global {
  interface Window {
    Spotify?: SpotifySdk;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

const spotifySdkUrl = 'https://sdk.scdn.co/spotify-player.js';
const spotifySdkLoadTimeoutMs = 15_000;
const spotifyDeviceReadyTimeoutMs = 20_000;
const spotifySdkQuickFallbackMs = 3_500;
const spotifyPlaybackCommandTimeoutMs = 12_000;
const spotifySdkSupersededMessage = 'spotify_sdk_attempt_superseded';

let sdkLoadPromise: Promise<void> | null = null;
let playerPromise: Promise<SpotifyPlayer> | null = null;
let player: SpotifyPlayer | null = null;
let deviceId: string | null = null;
let usingConnectFallback = false;
let lastVolume = 0.8;
let lastSdkFailureMessage: string | null = null;
let lastConnectDeviceId: string | null = null;
let sdkConnectGeneration = 0;

const delay = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timeoutId: number | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
};

const safeString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 400) : null;
};

const diagnosticBase = (): Record<string, unknown> => ({
  origin: window.location.origin,
  secureContext: window.isSecureContext,
  hasEme: typeof navigator.requestMediaKeySystemAccess === 'function',
  hasSpotifyPlayer: Boolean(window.Spotify?.Player),
  userAgent: navigator.userAgent,
});

const reportSpotifyDiagnostic = (
  event: string,
  detail: Record<string, unknown> = {},
  level: 'info' | 'warn' | 'error' = 'info',
): void => {
  const payload = {
    event,
    ...diagnosticBase(),
    ...detail,
  };
  const line = `[SpotifySDK] ${JSON.stringify(payload)}`;

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.info(line);
  }

  if (level !== 'info') {
    void window.echo?.diagnostics?.reportRendererError?.({
      message: `Spotify SDK ${event}`,
      stack: JSON.stringify(payload).slice(0, 1800),
      source: 'error',
      timestamp: new Date().toISOString(),
    }).catch(() => undefined);
  }
};

const spotifyPlaybackError = (error: SpotifyError | null | undefined, fallback: string): Error => {
  const message = safeString(error?.message);
  if (!message) {
    return new Error(fallback);
  }

  if (/premium|account/iu.test(message)) {
    return new Error('Spotify Premium is required for playback.');
  }
  if (/auth|token/iu.test(message)) {
    return new Error('Spotify sign-in expired. Sign in again from Settings.');
  }
  if (/device|connect|not[_ ]?ready/iu.test(message)) {
    return new Error('Spotify playback device is not ready yet. Try again in a moment.');
  }
  if (/failed to initialize player/iu.test(message) && /Electron/iu.test(navigator.userAgent)) {
    return new Error(translateCurrentLocale('spotifyPlayback.error.noDrmKeysystem'));
  }

  return new Error(message);
};

const loadSpotifySdk = (): Promise<void> => {
  if (window.Spotify?.Player) {
    return Promise.resolve();
  }
  if (sdkLoadPromise) {
    return sdkLoadPromise;
  }

  reportSpotifyDiagnostic('sdk-load-start');
  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${spotifySdkUrl}"]`);
    const timeout = window.setTimeout(() => {
      reportSpotifyDiagnostic('sdk-load-timeout', {}, 'error');
      reject(new Error('Spotify Web Playback SDK load timed out.'));
    }, spotifySdkLoadTimeoutMs);

    window.onSpotifyWebPlaybackSDKReady = () => {
      window.clearTimeout(timeout);
      reportSpotifyDiagnostic('sdk-ready');
      resolve();
    };

    if (existing) {
      reportSpotifyDiagnostic('sdk-script-existing');
      return;
    }

    const script = document.createElement('script');
    script.src = spotifySdkUrl;
    script.async = true;
    script.onload = () => reportSpotifyDiagnostic('sdk-script-loaded');
    script.onerror = () => {
      window.clearTimeout(timeout);
      reportSpotifyDiagnostic('sdk-script-error', {}, 'error');
      reject(new Error('Unable to load Spotify Web Playback SDK. Check the network connection.'));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    sdkLoadPromise = null;
    throw error;
  });

  return sdkLoadPromise;
};

const resetSpotifyPlayer = (nextPlayer?: SpotifyPlayer | null): void => {
  try {
    (nextPlayer ?? player)?.disconnect();
  } catch {
    // SDK cleanup can fail after an initialization error; the next attempt will create a new player.
  }
  if (!nextPlayer || nextPlayer === player) {
    player = null;
    deviceId = null;
    usingConnectFallback = false;
  }
};

const invalidatePendingSpotifySdkAttempt = (): void => {
  sdkConnectGeneration += 1;
  playerPromise = null;
};

const chooseSpotifyConnectDeviceFromList = async (): Promise<string | null> => {
  const devices = await window.echo.spotify.getDevices();
  reportSpotifyDiagnostic('connect-devices', {
    count: devices.length,
    devices: devices.map((item) => ({
      name: item.name,
      type: item.type,
      active: item.isActive,
      restricted: item.isRestricted,
    })),
  });

  const device =
    devices.find((item) => item.id === lastConnectDeviceId && !item.isRestricted) ??
    devices.find((item) => item.isActive && !item.isRestricted) ??
    devices.find((item) => item.type.toLowerCase() === 'computer' && !item.isRestricted) ??
    devices.find((item) => !item.isRestricted);

  if (!device) {
    return null;
  }

  deviceId = device.id;
  lastConnectDeviceId = device.id;
  usingConnectFallback = true;
  return device.id;
};

const shouldAutoLaunchSpotifyOfficialPlayer = async (): Promise<boolean> => {
  const settings = await window.echo?.app?.getSettings?.().catch(() => null);
  return settings?.spotifyAutoLaunchOfficialPlayer !== false;
};

const chooseSpotifyConnectDevice = async (uri: string, webUrl: string): Promise<string> => {
  const existingDeviceId = await chooseSpotifyConnectDeviceFromList();
  if (existingDeviceId) {
    return existingDeviceId;
  }

  const sdkHint = lastSdkFailureMessage ? ` SDK failed: ${lastSdkFailureMessage}` : '';
  if (!(await shouldAutoLaunchSpotifyOfficialPlayer()) || !window.echo.spotify.ensureConnectDevice) {
    throw new Error(translateCurrentLocale('spotifyPlayback.error.noDevice', { hint: sdkHint }));
  }

  reportSpotifyDiagnostic('connect-autolaunch-start', { webUrl, preferredDeviceId: lastConnectDeviceId });
  const result = await window.echo.spotify.ensureConnectDevice({
    uri,
    webUrl,
    preferredDeviceId: lastConnectDeviceId,
  });

  deviceId = result.deviceId;
  lastConnectDeviceId = result.deviceId;
  usingConnectFallback = true;
  reportSpotifyDiagnostic('connect-autolaunch-ready', {
    deviceName: result.deviceName,
    launched: result.launched,
    waitedMs: result.waitedMs,
  });
  return result.deviceId;
};

const ensureSpotifyPlayer = async (): Promise<SpotifyPlayer> => {
  if (player && deviceId) {
    return player;
  }
  if (playerPromise) {
    return playerPromise;
  }

  const generation = sdkConnectGeneration + 1;
  sdkConnectGeneration = generation;
  const isCurrentGeneration = (): boolean => generation === sdkConnectGeneration;

  playerPromise = (async () => {
    const spotifyApi = window.echo?.spotify;
    if (!spotifyApi?.getAccessToken || !spotifyApi.startPlayback || !spotifyApi.transferPlayback) {
      throw new Error('Spotify desktop bridge is unavailable. Open ECHO Next in Electron.');
    }

    await loadSpotifySdk();
    if (!window.Spotify?.Player) {
      throw new Error('Spotify Web Playback SDK is not ready.');
    }

    return withTimeout(
      new Promise<SpotifyPlayer>((resolve, reject) => {
        let settled = false;
        const nextPlayer = new window.Spotify!.Player({
          name: 'ECHO Next Spotify',
          volume: lastVolume,
          getOAuthToken: (callback) => {
            void spotifyApi.getAccessToken()
              .then((token) => {
                reportSpotifyDiagnostic('token-supplied', { hasToken: token.length > 0 });
                callback(token);
              })
              .catch((error) => {
                reportSpotifyDiagnostic('token-error', { message: safeString(error?.message) }, 'error');
                callback('');
              });
          },
        });

        const fail = (error: SpotifyError | null | undefined, fallback: string): void => {
          if (!isCurrentGeneration()) {
            resetSpotifyPlayer(nextPlayer);
            if (!settled) {
              settled = true;
              reject(new Error(spotifySdkSupersededMessage));
            }
            return;
          }

          const nextError = spotifyPlaybackError(error, fallback);
          lastSdkFailureMessage = nextError.message;
          reportSpotifyDiagnostic('player-failed', { message: nextError.message }, 'error');
          resetSpotifyPlayer(nextPlayer);
          if (!settled) {
            settled = true;
            reject(nextError);
          }
        };

        nextPlayer.addListener('initialization_error', (error) => fail(error, 'Spotify Web Playback SDK initialization failed.'));
        nextPlayer.addListener('authentication_error', (error) => fail(error, 'Spotify sign-in expired. Sign in again from Settings.'));
        nextPlayer.addListener('account_error', (error) => fail(error, 'Spotify Premium is required for Web Playback SDK streaming.'));
        nextPlayer.addListener('playback_error', (error) => {
          const nextError = spotifyPlaybackError(error, 'Spotify playback failed.');
          lastSdkFailureMessage = nextError.message;
          reportSpotifyDiagnostic('playback-error', { message: nextError.message }, 'warn');
        });
        nextPlayer.addListener('ready', ({ device_id: readyDeviceId }: { device_id?: string }) => {
          if (!isCurrentGeneration()) {
            resetSpotifyPlayer(nextPlayer);
            if (!settled) {
              settled = true;
              reject(new Error(spotifySdkSupersededMessage));
            }
            return;
          }

          reportSpotifyDiagnostic('player-ready', { hasDeviceId: Boolean(readyDeviceId) });
          if (!readyDeviceId) {
            fail(null, 'Spotify SDK did not return a usable device.');
            return;
          }

          deviceId = readyDeviceId;
          player = nextPlayer;
          usingConnectFallback = false;
          lastSdkFailureMessage = null;
          if (!settled) {
            settled = true;
            resolve(nextPlayer);
          }
        });
        nextPlayer.addListener('not_ready', ({ device_id: staleDeviceId }: { device_id?: string }) => {
          reportSpotifyDiagnostic('player-not-ready', { sameDevice: Boolean(staleDeviceId && staleDeviceId === deviceId) }, 'warn');
          if (!staleDeviceId || staleDeviceId === deviceId) {
            deviceId = null;
          }
        });

        void nextPlayer.activateElement?.().catch((error) => {
          reportSpotifyDiagnostic('activate-element-error', { message: safeString(error?.message) }, 'warn');
        });

        reportSpotifyDiagnostic('player-connect-start');
        void nextPlayer.connect()
          .then((connected) => {
            if (!isCurrentGeneration()) {
              resetSpotifyPlayer(nextPlayer);
              if (!settled) {
                settled = true;
                reject(new Error(spotifySdkSupersededMessage));
              }
              return;
            }

            reportSpotifyDiagnostic('player-connect-result', { connected });
            if (!connected) {
              fail(null, 'Spotify device connection failed. Confirm Spotify Premium is available.');
            }
          })
          .catch((error) => fail(error, 'Spotify device connection failed.'));
      }),
      spotifyDeviceReadyTimeoutMs,
      'Spotify Web Playback SDK device connection timed out. Confirm Spotify Premium and network availability.',
    );
  })().catch((error) => {
    if (errorMessage(error) !== spotifySdkSupersededMessage && isCurrentGeneration()) {
      lastSdkFailureMessage = error instanceof Error ? error.message : String(error);
      resetSpotifyPlayer();
    }
    throw error;
  }).finally(() => {
    if (isCurrentGeneration()) {
      playerPromise = null;
    }
  });

  return playerPromise;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const ensureSpotifyPlayerForPlayback = async (): Promise<SpotifyPlayer | null> => {
  try {
    return await withTimeout(
      ensureSpotifyPlayer(),
      spotifySdkQuickFallbackMs,
      'Spotify Web Playback SDK is still starting. Falling back to Spotify Connect.',
    );
  } catch (error) {
    const message = errorMessage(error);
    if (message !== spotifySdkSupersededMessage) {
      lastSdkFailureMessage = message;
      reportSpotifyDiagnostic('sdk-unavailable-fallback-connect', { message }, 'warn');
    }
    invalidatePendingSpotifySdkAttempt();
    resetSpotifyPlayer();
    return null;
  }
};

const resolveSpotifyPlaybackTarget = async (
  uri: string,
  webUrl: string,
): Promise<{ player: SpotifyPlayer | null; deviceId: string }> => {
  const nextPlayer = await ensureSpotifyPlayerForPlayback();
  if (nextPlayer && deviceId) {
    return { player: nextPlayer, deviceId };
  }

  const connectDeviceId = await chooseSpotifyConnectDevice(uri, webUrl);
  return { player: null, deviceId: connectDeviceId };
};

const statusForTrack = (track: LibraryTrack, state: PlaybackStatus['state'], positionSeconds = 0): PlaybackStatus => ({
  state,
  currentTrackId: track.id,
  positionMs: Math.round(Math.max(0, positionSeconds) * 1000),
  durationMs: Math.round(Math.max(0, track.duration) * 1000),
  filePath: track.stableKey ?? track.path ?? `spotify:${track.providerTrackId ?? track.id}`,
});

const spotifyUriForTrack = (track: LibraryTrack): string => {
  const providerTrackId = track.providerTrackId?.trim();
  if (track.mediaType !== 'streaming' || track.provider !== 'spotify' || !providerTrackId) {
    throw new Error('The current track is not a playable Spotify track.');
  }

  return `spotify:track:${providerTrackId}`;
};

const spotifyWebUrlForTrack = (track: LibraryTrack): string => {
  const providerTrackId = track.providerTrackId?.trim();
  if (track.mediaType !== 'streaming' || track.provider !== 'spotify' || !providerTrackId) {
    throw new Error('The current track is not a playable Spotify track.');
  }

  return `https://open.spotify.com/track/${encodeURIComponent(providerTrackId)}`;
};

const waitForSpotifyPlaying = async (
  expectedUri: string,
  nextPlayer: SpotifyPlayer | null,
): Promise<{ positionMs: number }> => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0) {
      await delay(500);
    }

    const sdkState = nextPlayer ? await nextPlayer.getCurrentState().catch(() => null) : null;
    if (sdkState && !sdkState.paused) {
      return { positionMs: sdkState.position };
    }

    const apiState = await window.echo.spotify.getPlaybackState().catch(() => null);
    if (apiState?.itemUri === expectedUri && apiState.isPlaying) {
      return { positionMs: apiState.progressMs ?? 0 };
    }

    if (attempt === 2) {
      await nextPlayer?.activateElement?.().catch(() => undefined);
      await window.echo.spotify.resume(deviceId).catch(() => undefined);
    }
  }

  const lastState = await window.echo.spotify.getPlaybackState().catch(() => null);
  const deviceName = lastState?.deviceName ? ` (device: ${lastState.deviceName})` : '';
  if (lastState?.itemUri === expectedUri || !lastState?.itemUri) {
    throw new Error(`Spotify accepted the command, but the official player stayed paused${deviceName}.`);
  }

  throw new Error(`Spotify did not switch to the requested track${deviceName}. Try again in a moment.`);
};

const readSpotifyPlaybackSnapshot = async (
  track: LibraryTrack,
  expectedUri: string,
  nextPlayer: SpotifyPlayer | null,
  fallbackPositionMs: number,
  fallbackState: PlaybackStatus['state'],
): Promise<PlaybackStatus> => {
  const sdkState = nextPlayer ? await nextPlayer.getCurrentState().catch(() => null) : null;
  if (sdkState) {
    return statusForTrack(track, sdkState.paused ? 'paused' : 'playing', sdkState.position / 1000);
  }

  const apiState = await window.echo.spotify.getPlaybackState().catch(() => null);
  if (apiState?.itemUri === expectedUri) {
    return statusForTrack(
      track,
      apiState.isPlaying ? 'playing' : fallbackState,
      (apiState.progressMs ?? fallbackPositionMs) / 1000,
    );
  }

  return statusForTrack(track, fallbackState, fallbackPositionMs / 1000);
};

const runSpotifyCommand = async (
  command: Promise<void>,
  timeoutMessage: string,
  fallback?: () => Promise<void> | void,
): Promise<void> => {
  try {
    await withTimeout(command, spotifyPlaybackCommandTimeoutMs, timeoutMessage);
  } catch (error) {
    if (!fallback) {
      throw error;
    }
    await fallback();
  }
};

export const isSpotifyTrack = (track: LibraryTrack | null | undefined): track is SpotifyLibraryTrack =>
  track?.mediaType === 'streaming' && track.provider === 'spotify';

export const playSpotifyTrack = async (track: LibraryTrack, startSeconds = 0): Promise<PlaybackStatus> => {
  const uri = spotifyUriForTrack(track);
  const webUrl = spotifyWebUrlForTrack(track);
  const target = await resolveSpotifyPlaybackTarget(uri, webUrl);
  const nextPlayer = target.player;
  const currentDeviceId = target.deviceId;
  if (!currentDeviceId) {
    throw new Error('Spotify playback device is not ready.');
  }

  const positionMs = Math.round(Math.max(0, startSeconds) * 1000);
  await nextPlayer?.activateElement?.().catch((error) => {
    reportSpotifyDiagnostic('activate-before-play-error', { message: safeString(error?.message) }, 'warn');
  });
  await withTimeout(
    window.echo.spotify.transferPlayback({ deviceId: currentDeviceId, play: false }),
    spotifyPlaybackCommandTimeoutMs,
    'Spotify device transfer timed out. Confirm Spotify Premium and network status.',
  );
  await withTimeout(
    window.echo.spotify.startPlayback({
      deviceId: currentDeviceId,
      uri,
      positionMs,
    }),
    spotifyPlaybackCommandTimeoutMs,
    'Spotify play request timed out. Confirm this track is playable in the account region.',
  );
  if (nextPlayer) {
    await nextPlayer.setVolume(lastVolume).catch(() => undefined);
  } else {
    await window.echo.spotify.setVolume(lastVolume, currentDeviceId).catch(() => undefined);
  }
  const verified = await waitForSpotifyPlaying(uri, nextPlayer);
  return statusForTrack(track, 'playing', verified.positionMs / 1000);
};

export const pauseSpotifyPlayback = async (track: LibraryTrack): Promise<PlaybackStatus> => {
  const nextPlayer = usingConnectFallback ? null : player;
  const uri = spotifyUriForTrack(track);
  await runSpotifyCommand(
    window.echo.spotify.pause(deviceId),
    'Spotify pause request timed out.',
    nextPlayer ? () => nextPlayer.pause() : undefined,
  );
  const status = await readSpotifyPlaybackSnapshot(track, uri, nextPlayer, 0, 'paused');
  return { ...status, state: 'paused' };
};

export const resumeSpotifyPlayback = async (track: LibraryTrack): Promise<PlaybackStatus> => {
  const nextPlayer = usingConnectFallback ? null : player;
  const uri = spotifyUriForTrack(track);
  await nextPlayer?.activateElement?.().catch(() => undefined);
  await runSpotifyCommand(
    window.echo.spotify.resume(deviceId),
    'Spotify resume request timed out.',
    nextPlayer ? () => nextPlayer.resume() : undefined,
  );
  const status = await readSpotifyPlaybackSnapshot(track, uri, nextPlayer, 0, 'playing');
  return { ...status, state: 'playing' };
};

export const seekSpotifyPlayback = async (track: LibraryTrack, positionSeconds: number): Promise<PlaybackStatus> => {
  const nextPlayer = usingConnectFallback ? null : player;
  const uri = spotifyUriForTrack(track);
  const positionMs = Math.round(Math.max(0, positionSeconds) * 1000);
  await runSpotifyCommand(
    window.echo.spotify.seek(positionMs, deviceId),
    'Spotify seek request timed out.',
    nextPlayer ? () => nextPlayer.seek(positionMs) : undefined,
  );
  return readSpotifyPlaybackSnapshot(track, uri, nextPlayer, positionMs, 'playing');
};

export const setSpotifyVolume = async (volume: number): Promise<void> => {
  lastVolume = Math.max(0, Math.min(1, volume));
  const nextPlayer = usingConnectFallback ? null : player;
  await runSpotifyCommand(
    window.echo.spotify.setVolume(lastVolume, deviceId),
    'Spotify volume request timed out.',
    nextPlayer ? () => nextPlayer.setVolume(lastVolume) : undefined,
  );
};

export const stopSpotifyPlayback = async (track: LibraryTrack): Promise<PlaybackStatus> => {
  const paused = await pauseSpotifyPlayback(track);
  return { ...paused, state: 'stopped' };
};
