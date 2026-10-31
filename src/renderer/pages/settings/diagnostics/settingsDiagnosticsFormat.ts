import type { LibraryDatabaseProtectionStatus, DuplicateTrackCleanupPreview } from '../../../../shared/types/library';
import type { UpdateStatus } from '../../../../shared/types/updates';
import type { TranslationKey } from '../../../i18n/locales';

export const formatRate = (value: number | null): string => {
  if (!value) {
    return 'n/a';
  }

  return `${value} Hz`;
};

export const formatDiagnosticsDuration = (valueMs: number | null | undefined): string => {
  if (!Number.isFinite(valueMs) || valueMs === null || valueMs === undefined || valueMs < 0) {
    return 'n/a';
  }

  if (valueMs < 1000) {
    return `${Math.round(valueMs)} ms`;
  }

  const seconds = valueMs / 1000;
  if (seconds < 60) {
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
};

export const formatDiagnosticsTimestampDuration = (startedAt: string | null | undefined, finishedAt: string | null | undefined): string => {
  if (!startedAt || !finishedAt) {
    return 'n/a';
  }

  const startedMs = Date.parse(startedAt);
  const finishedMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs) || finishedMs < startedMs) {
    return 'n/a';
  }

  return formatDiagnosticsDuration(finishedMs - startedMs);
};

export const formatDiagnosticsPercent = (value: number | null | undefined): string => {
  if (!Number.isFinite(value) || value === null || value === undefined) {
    return 'n/a';
  }

  return `${Math.round(value * 1000) / 10}%`;
};

export const getUpdateStateLabel = (state: UpdateStatus['state']): TranslationKey => {
  switch (state) {
    case 'checking':
      return 'settings.about.updates.state.checking';
    case 'available':
      return 'settings.about.updates.state.available';
    case 'downloading':
      return 'settings.about.updates.state.downloading';
    case 'downloaded':
      return 'settings.about.updates.state.downloaded';
    case 'not-available':
      return 'settings.about.updates.state.notAvailable';
    case 'error':
      return 'settings.about.updates.state.error';
    case 'disabled':
      return 'settings.about.updates.state.disabled';
    default:
      return 'settings.about.updates.state.idle';
  }
};

export const formatUpdateBytes = (bytes: number | null | undefined): string => {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) {
    return 'n/a';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};

type DuplicateCleanupMember = DuplicateTrackCleanupPreview['groups'][number]['keep'];

export const formatDuplicateCleanupTrackQuality = (member: DuplicateCleanupMember): string => {
  const { track } = member;
  const parts: string[] = [];

  if (track.codec) {
    parts.push(track.codec.toUpperCase());
  }
  if (track.bitDepth && track.sampleRate) {
    parts.push(`${track.bitDepth}bit / ${formatRate(track.sampleRate)}`);
  } else if (track.sampleRate) {
    parts.push(formatRate(track.sampleRate));
  }
  if (track.bitrate && track.bitrate > 0) {
    parts.push(`${Math.round(track.bitrate / 1000)} kbps`);
  }
  if (member.sizeBytes && member.sizeBytes > 0) {
    parts.push(formatUpdateBytes(member.sizeBytes));
  }
  parts.push(`评分 ${member.qualityScore}`);

  return parts.join(' · ');
};

export const formatCacheBytes = (bytes: number | null | undefined): string => {
  if (!Number.isFinite(bytes) || bytes === null || bytes === undefined || bytes <= 0) {
    return '0 B';
  }

  return formatUpdateBytes(bytes);
};

export const formatProtectionTimestamp = (value: string | null | undefined): string => {
  if (!value) {
    return '暂无';
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  return new Date(timestamp).toLocaleString();
};

export const getDatabaseHealthLabel = (status: LibraryDatabaseProtectionStatus['health']['status'] | undefined): TranslationKey => {
  switch (status) {
    case 'ok':
      return 'settings.danger.database.health.ok';
    case 'corrupt':
      return 'settings.danger.database.health.corrupt';
    case 'unreadable':
      return 'settings.danger.database.health.unreadable';
    default:
      return 'settings.danger.database.health.idle';
  }
};

