import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const isHttpUrl = (value: string): boolean => /^https?:\/\//iu.test(value);

export const normalizePlaybackFilePath = (value: string): string => {
  const trimmed = value.trim();

  if (isHttpUrl(trimmed)) {
    return trimmed;
  }

  if (/^file:\/\//iu.test(trimmed)) {
    try {
      return fileURLToPath(trimmed);
    } catch {
      return trimmed;
    }
  }

  if (existsSync(trimmed)) {
    return trimmed;
  }

  if (!/%[0-9a-f]{2}/iu.test(trimmed)) {
    return trimmed;
  }

  try {
    const decoded = decodeURIComponent(trimmed);
    return existsSync(decoded) ? decoded : trimmed;
  } catch {
    return trimmed;
  }
};
