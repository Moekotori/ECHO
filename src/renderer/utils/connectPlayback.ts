import { hqPlayerConnectDeviceId, type ConnectSessionStatus } from '../../shared/types/connect';
import type { AudioPlaybackState } from '../../shared/types/audio';
import type { PlaybackStatus } from '../../shared/types/playback';

const hqPlayerEndedGraceMs = 5000;
const activeConnectStates = new Set<ConnectSessionStatus['state']>(['connecting', 'ready', 'playing', 'paused', 'stopped']);

export const connectStateToPlaybackState = (status: ConnectSessionStatus): AudioPlaybackState => {
  switch (status.state) {
    case 'playing':
      return 'playing';
    case 'paused':
      return 'paused';
    case 'stopped':
      return 'stopped';
    case 'error':
      return 'error';
    case 'idle':
      return 'idle';
    default:
      return 'loading';
  }
};

export const isHqPlayerConnectStatus = (status: ConnectSessionStatus | null | undefined): status is ConnectSessionStatus =>
  status?.protocol === 'hqplayer' && status.deviceId === hqPlayerConnectDeviceId;

export const isHqPlayerStoppedAtTrackEnd = (status: ConnectSessionStatus): boolean => {
  if (!isHqPlayerConnectStatus(status) || status.state !== 'stopped' || !status.currentTrackId) {
    return false;
  }

  const durationMs = Math.round(Math.max(0, status.durationSeconds || status.metadata?.durationSeconds || 0) * 1000);
  if (durationMs <= 0) {
    return false;
  }

  const positionMs = Math.round(Math.max(0, status.positionSeconds) * 1000);
  return positionMs >= Math.max(0, durationMs - hqPlayerEndedGraceMs);
};

export const isActiveConnectPlaybackStatus = (
  status: ConnectSessionStatus | null | undefined,
): status is ConnectSessionStatus =>
  Boolean(
    status?.deviceId &&
      status.protocol &&
      (activeConnectStates.has(status.state) || isHqPlayerStoppedAtTrackEnd(status)),
  );

export const playbackStatusFromConnectStatus = (
  status: ConnectSessionStatus,
  fallback: Partial<Pick<PlaybackStatus, 'currentTrackId' | 'durationMs' | 'filePath'>> = {},
): PlaybackStatus => ({
  state: isHqPlayerStoppedAtTrackEnd(status) ? 'ended' : connectStateToPlaybackState(status),
  currentTrackId: status.currentTrackId ?? fallback.currentTrackId ?? null,
  positionMs: Math.round(Math.max(0, status.positionSeconds) * 1000),
  durationMs: Math.round(
    Math.max(0, status.durationSeconds || status.metadata?.durationSeconds || (fallback.durationMs ?? 0) / 1000) * 1000,
  ),
  filePath: fallback.filePath ?? null,
});
