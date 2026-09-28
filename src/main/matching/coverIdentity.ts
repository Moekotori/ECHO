/** Cover credits describe two different roles. Never use the original artist as the performer. */
export type CoverIdentity = {
  title: string;
  cover: boolean;
  performer: string | null;
  originalArtist: string | null;
};

const coverMarker = /\bcover(?:s|ed\s+by)?\b|翻唱|歌ってみた|歌みた|カバー/iu;
const performerCredit = /^(?:covered\s+by|cover\s+by|翻唱\s*[:：]|カバー\s*[:：])\s*(.+)$/iu;
const originalCredit = /^(?:cover(?:\s*[.:：]\s*|\s+(?!(?:by|ver(?:sion)?\.?)\b))|翻唱\s*[:：]?\s+|原唱\s*[:：]?\s*|original(?:ly)?\s+by\s+)(.+)$/iu;
const descriptorOnly = /^(?:cover(?:\s+ver(?:sion)?\.?)?|翻唱(?:版)?|歌ってみた|歌みた|カバー(?:版)?)$/iu;
const clean = (value: string): string => value.replace(/\s+/gu, ' ').replace(/^[\s/|\-–—]+|[\s/|\-–—]+$/gu, '').trim();

export const parseCoverIdentity = (value: string | null | undefined): CoverIdentity => {
  const source = (value ?? '').normalize('NFKC').trim();
  let cover = false;
  let performer: string | null = null;
  let originalArtist: string | null = null;
  const stripCredit = (content: string): boolean => {
    const credit = clean(content);
    const singer = performerCredit.exec(credit);
    const original = originalCredit.exec(credit);
    if (singer) {
      performer = clean(singer[1]);
      cover = true;
      return true;
    }
    if (original) {
      originalArtist = clean(original[1]);
      cover = true;
      return true;
    }
    if (descriptorOnly.test(credit)) {
      cover = true;
      return true;
    }
    return false;
  };

  let title = source.replace(/\(([^()]*)\)|\[([^\[\]]*)\]|【([^【】]*)】/gu, (match, ...groups: unknown[]) => {
    const content = groups.slice(0, 3).find((group): group is string => typeof group === 'string') ?? '';
    return stripCredit(content) ? ' ' : match;
  });
  // Free-form credits only at the end, so songs such as "Cover Me" remain intact.
  title = title.replace(/\s+(?:[-–—/]\s*)?((?:covered\s+by|cover\s+by|cover\s*[.:：]|翻唱\s*[:：]|原唱\s*[:：])\s*.+)$/iu,
    (match, credit: string) => stripCredit(credit) ? ' ' : match);
  title = title.replace(/\s+(?:[-–—/]\s*)?(cover(?:\s+ver(?:sion)?\.?)?|翻唱(?:版)?|歌ってみた|歌みた|カバー)$/iu,
    (match, credit: string) => stripCredit(credit) ? ' ' : match);
  return { title: clean(title) || source, cover, performer, originalArtist };
};

export const hasCoverMarker = (value: string | null | undefined): boolean =>
  coverMarker.test((value ?? '').normalize('NFKC'));
