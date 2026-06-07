export const formatAudioChannelLayout = (channels: number | null | undefined): string | null => {
  if (!channels || !Number.isFinite(channels)) {
    return null;
  }

  const rounded = Math.round(channels);
  if (rounded <= 0) {
    return null;
  }

  if (rounded === 1) {
    return 'Mono';
  }

  if (rounded === 2) {
    return 'Stereo';
  }

  if (rounded === 6) {
    return '5.1 (6 ch)';
  }

  if (rounded === 8) {
    return '7.1 (8 ch)';
  }

  return `${rounded} ch`;
};
