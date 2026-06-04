export const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export const formatRate = (value: number | null): string => {
  if (!value || !Number.isFinite(value)) {
    return 'n/a';
  }

  return value >= 1000 ? `${Number(value / 1000).toFixed(value >= 100000 ? 0 : 1)} kHz` : `${Math.round(value)} Hz`;
};

export const formatPercent = (value: number): string => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;

export const basename = (filePath: string | null): string => {
  if (!filePath) {
    return 'No local file';
  }

  return filePath.split(/[\\/]/).pop() || filePath;
};

export const titleFromPath = (filePath: string | null): string => basename(filePath).replace(/\.(aac|aiff?|alac|ape|dff|dsf|flac|m4a|m4p|mp3|ogg|opus|wav|wv)$/i, '');
