import type { LyricLine, LyricWordTiming } from '../../shared/types/lyrics';

// LyricsKit LRCX attachments carry relative millisecond times and character indices.
export const parseLrcxLyrics = (
  value: string,
  parseBase: (text: string) => LyricLine[],
  maxWords: number,
): LyricLine[] | null => {
  const attachment = /^(\s*\[[\d:.]+\])\[([a-zA-Z_-]+)(?::([^\]]+))?\](.*)$/u;
  const rows = value.split(/\r?\n/u);
  if (!rows.some((row) => /^(?:tr|tt|fu|ro)$/iu.test(row.match(attachment)?.[2] ?? ''))) return null;
  const offset = rows.find((row) => /^\s*\[offset:/iu.test(row)) ?? '';
  const lines = parseBase(rows.filter((row) => !attachment.test(row)).join('\n'));
  const byTime = new Map(lines.map((line) => [line.timeMs, line]));
  for (const row of rows) {
    const match = row.match(attachment);
    if (!match) continue;
    const time = parseBase(`${offset}\n${match[1]}_`)[0]?.timeMs;
    const line = time === undefined ? undefined : byTime.get(time);
    if (!line) continue;
    const tag = match[2].toLowerCase();
    const body = match[4];
    if (tag === 'tr') {
      if (!line.translation) line.translation = body.trim();
    } else if (tag === 'tt') {
      const chars = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line.text), (part) => part.segment);
      const tags = Array.from(body.matchAll(/<(\d+),(\d+)>/gu), (part) => ({ time: Number(part[1]), index: Number(part[2]) }));
      if (tags.length > maxWords + 1 || !tags.length || tags.some((part, index) =>
        !Number.isFinite(part.time) || part.index > chars.length || (index > 0 && (part.index <= tags[index - 1].index || part.time < tags[index - 1].time)))) continue;
      const duration = Number(body.match(/<(\d+)>\s*$/u)?.[1]);
      const words: LyricWordTiming[] = [];
      for (let index = 0; index < tags.length; index++) {
        const start = tags[index];
        const next = tags[index + 1];
        const text = chars.slice(start.index, next?.index ?? chars.length).join('');
        const end = next?.time ?? (Number.isFinite(duration) ? duration : null);
        if (text.trim()) words.push({ text, startMs: line.timeMs + start.time,
          endMs: end !== null && end > start.time ? line.timeMs + end : null });
      }
      if (words.length && words.length <= maxWords) line.words = words;
    } else if (tag === 'ro' || tag === 'fu') {
      const chars = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line.text), (part) => part.segment);
      let cursor = 0;
      let reading = '';
      for (const part of body.matchAll(/<([^,>]+),(\d+),(\d+)>/gu)) {
        const start = Number(part[2]);
        const end = Number(part[3]);
        if (start < cursor || end <= start || end > chars.length) continue;
        reading += chars.slice(cursor, start).join('') + part[1];
        cursor = end;
      }
      if (reading) {
        reading += chars.slice(cursor).join('');
        if (tag === 'ro') line.romanization = reading;
        else line.kana = reading;
      }
    }
  }
  return lines;
};
