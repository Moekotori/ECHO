import type { LyricLine, LyricWordTiming } from '../../shared/types/lyrics';
import type { LyricsParseLimits } from '../../shared/lyrics/localLyricsFormats';

export const parseLegacyTimedLyrics = (value: string, limits: LyricsParseLimits): LyricLine[] | null => {
  const snc = /(?:^\uFEFF?|\n)⑩\d{8}⑿/u.test(value);
  const trc = /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]\s*<\d+>/u.test(value);
  if (!snc && !trc) return null;
  const lines: LyricLine[] = [];
  const offset = Math.max(-600000, Math.min(600000, Number(value.match(/^\s*\[offset:([+-]?\d+)\]/imu)?.[1] ?? 0)));
  for (const raw of value.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    if (lines.length >= limits.maxLines) break;
    if (snc) {
      const match = raw.match(/^⑩(\d{2})(\d{2})(\d{2})(\d{2})⑿(.*)$/u);
      if (match) {
        if (Number(match[2]) > 59 || Number(match[3]) > 59) continue;
        lines.push({ timeMs: Number(match[1]) * 3600000 + Number(match[2]) * 60000
          + Number(match[3]) * 1000 + Number(match[4]) * 10, text: match[5].trim() });
      } else if (lines.length && raw.trim()) {
        const previous = lines[lines.length - 1];
        if (previous.text.length + raw.length + 1 <= limits.maxLineTextChars) previous.text += ` ${raw.trim()}`;
      }
      continue;
    }
    const match = raw.match(/^\s*\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/u);
    if (!match || Number(match[2]) > 59) continue;
    const timeMs = Math.max(0, Number(match[1]) * 60000 + Number(match[2]) * 1000
      + Number((match[3] ?? '').padEnd(3, '0')) - offset);
    let cursor = timeMs;
    const words: LyricWordTiming[] = [];
    let overflow = false;
    const body = match[4];
    for (const part of body.matchAll(/<(\d+)>([^<]*)/gu)) {
      if (words.length >= limits.maxWordsPerLine) { overflow = true; break; }
      const durationMs = Number(part[1]);
      const endMs = cursor + durationMs;
      if (!Number.isFinite(endMs) || durationMs <= 0) { overflow = true; break; }
      if (part[2].trim() && endMs > cursor) words.push({ text: part[2], startMs: cursor, endMs });
      cursor = endMs;
    }
    lines.push({ timeMs, text: body.replace(/<\d+>/gu, '').trim(),
      ...(words.length && !overflow ? { words, endMs: cursor } : {}) });
  }
  return lines.filter((line) => line.text.length > 0 && line.text.length <= limits.maxLineTextChars)
    .sort((a, b) => a.timeMs - b.timeMs);
};
