import type { LyricLine, LyricWordTiming } from '../../shared/types/lyrics';
import type { LyricsParseLimits } from '../../shared/lyrics/localLyricsFormats';

const timestamp = (text: string): number | null => {
  const match = text.trim().match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/u);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) return null;
  return Number(match[1] ?? 0) * 3600000 + Number(match[2]) * 60000 + Number(match[3]) * 1000
    + Number(match[4].padEnd(3, '0'));
};

const clean = (text: string): string => text.replace(/<br\s*\/?>/giu, ' ').replace(/<[^>]*>/gu, '')
  .replace(/&#(x[0-9a-f]+|\d+);/giu, (_match, code: string) => {
    const point = code[0].toLowerCase() === 'x' ? Number.parseInt(code.slice(1), 16) : Number(code);
    return point <= 0x10ffff ? String.fromCodePoint(point) : '';
  })
  .replace(/&apos;/gu, "'")
  .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&nbsp;/gu, ' ')
  .replace(/&quot;/gu, '"').replace(/&amp;/gu, '&').replace(/\s+/gu, ' ').trim();

// Read event data only. ASS styles, override commands and vector drawings are never rendered.
export const parseAssLyrics = (value: string, limits: LyricsParseLimits): LyricLine[] | null => {
  if (!/^\s*\[Events\]\s*$/imu.test(value)) return null;
  const lines: LyricLine[] = [];
  let inEvents = false;
  let fields = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
  for (const raw of value.split(/\r?\n/u)) {
    if (lines.length >= limits.maxLines) break;
    const row = raw.trim();
    if (/^\[.*\]$/u.test(row)) { inEvents = /^\[Events\]$/iu.test(row); continue; }
    if (!inEvents) continue;
    if (/^Format:/iu.test(row)) { fields = row.slice(7).split(',').map((field) => field.trim().toLowerCase()); continue; }
    if (!/^Dialogue:/iu.test(row) || fields.at(-1) !== 'text') continue;
    const parts = row.slice(9).split(',');
    if (parts.length < fields.length) continue;
    const start = timestamp(parts[fields.indexOf('start')] ?? '');
    const end = timestamp(parts[fields.indexOf('end')] ?? '');
    if (start === null || end === null || end <= start) continue;
    const body = parts.slice(fields.length - 1).join(',');
    if (body.length > limits.maxLineTextChars * 16) continue;
    let drawing = false;
    let cursor = start;
    let duration: number | null = null;
    let text = '';
    const words: LyricWordTiming[] = [];
    let wordOverflow = false;
    for (const token of body.matchAll(/\{([^}]*)\}|([^{}]+)/gu)) {
      if (token[1] !== undefined) {
        const draw = token[1].match(/\\p(\d+)/u);
        if (draw) drawing = Number(draw[1]) !== 0;
        const karaoke = token[1].match(/\\[kK](?:f|o)?(\d+)/u);
        if (karaoke) { if (duration !== null) cursor += duration; duration = Number(karaoke[1]) * 10; }
        continue;
      }
      if (drawing) continue;
      const fragment = token[2].replace(/\\[Nnh]/gu, ' ');
      text += fragment;
      if (duration !== null && duration > 0 && cursor < end && fragment.trim()) {
        const previous = words.at(-1);
        if (previous?.startMs === cursor) previous.text += fragment;
        else if (words.length < limits.maxWordsPerLine) {
          words.push({ text: fragment, startMs: cursor, endMs: Math.min(end, cursor + duration) });
        } else wordOverflow = true;
      }
    }
    text = text.replace(/\s+/gu, ' ').trim();
    if (!text || text.length > limits.maxLineTextChars) continue;
    lines.push({ timeMs: start, endMs: end, text,
      ...(!wordOverflow && words.length > 0 && words.map((word) => word.text).join('').trim() === text ? { words } : {}) });
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
};

export const parseSubtitleLyrics = (value: string, limits: LyricsParseLimits): LyricLine[] | null => {
  if (!/(?:^|\n)\s*(?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->/u.test(value)) return null;
  const lines: LyricLine[] = [];
  for (const block of value.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').split(/\n[\t ]*\n/u)) {
    if (lines.length >= limits.maxLines) break;
    if (/^(?:NOTE|STYLE|REGION)(?:\s|$)/u.test(block.trimStart())) continue;
    const rows = block.split('\n');
    const index = rows.findIndex((row) => row.includes('-->'));
    if (index < 0) continue;
    const times = rows[index].trim().split(/\s*-->\s*/u);
    const start = timestamp(times[0]);
    const end = timestamp(times[1]?.split(/\s/u)[0] ?? '');
    const text = clean(rows.slice(index + 1).join(' '));
    if (start === null || end === null || end <= start || !text || text.length > limits.maxLineTextChars) continue;
    lines.push({ timeMs: start, endMs: end, text });
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
};
