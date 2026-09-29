import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

export type SidecarExtension = '.lrc' | '.ttml' | '.txt';
export type SidecarRole = 'primary' | 'translation' | 'romanization';
export type SidecarLanguageRole = Exclude<SidecarRole, 'primary'>;

export type SidecarFile = {
  filePath: string;
  extension: SidecarExtension;
  role: SidecarRole;
  language: string | null;
};

export type SidecarSecondaryPaths = {
  translation: string | null;
  romanization: string | null;
};

const sidecarExtensions: readonly SidecarExtension[] = ['.lrc', '.ttml', '.txt'];

const romanizationLanguageTags = new Set([
  'rom',
  'roman',
  'romanised',
  'romanization',
  'romanisation',
  'romanized',
  'lr',
  'py',
  'pinyin',
  '罗马音',
  '罗马字',
  '拼音',
]);

const translationLanguageTags = new Set([
  'zh',
  'cn',
  'chn',
  'chi',
  'chinese',
  'tw',
  'cht',
  'hant',
  'hans',
  'hk',
  'en',
  'eng',
  'ja',
  'jp',
  'jpn',
  'ko',
  'kr',
  'kor',
  'fr',
  'fra',
  'de',
  'deu',
  'es',
  'spa',
  'it',
  'ita',
  'pt',
  'por',
  'ru',
  'rus',
  'th',
  'vi',
  'vie',
  'id',
  '中文',
  '译文',
  '翻译',
  '中译',
  '英文',
  '日文',
  '韩文',
]);

// Matches the trailing `<separator><language tag>` of a sidecar stem, e.g. `Song.zh` -> `.zh`.
const languageTagPattern = /[._-]([^\s._/\\-]{2,12})$/u;

export const sidecarLanguageRole = (language: string): SidecarLanguageRole | null => {
  const tag = language.trim().toLocaleLowerCase();
  if (romanizationLanguageTags.has(tag)) {
    return 'romanization';
  }

  return translationLanguageTags.has(tag) ? 'translation' : null;
};

type LanguageSidecarName = {
  base: string;
  fileName: string;
  extension: SidecarExtension;
  role: SidecarLanguageRole;
  language: string;
};

const parseLanguageSidecarName = (fileName: string): LanguageSidecarName | null => {
  const extension = sidecarExtensions.find((candidate) => fileName.toLocaleLowerCase().endsWith(candidate));
  if (!extension) {
    return null;
  }

  const stem = fileName.slice(0, fileName.length - extension.length);
  const match = languageTagPattern.exec(stem);
  const role = match ? sidecarLanguageRole(match[1] ?? '') : null;
  if (!match || !role) {
    return null;
  }

  return {
    base: stem.slice(0, stem.length - match[0].length),
    fileName,
    extension,
    role,
    language: (match[1] ?? '').trim().toLocaleLowerCase(),
  };
};

const primaryFile = (filePath: string, extension: SidecarExtension): SidecarFile => ({
  filePath,
  extension,
  role: 'primary',
  language: null,
});

export const stripSidecarLanguageTag = (filePath: string): string => {
  const stem = basename(filePath, extname(filePath));
  const match = languageTagPattern.exec(stem);
  return match && sidecarLanguageRole(match[1] ?? '')
    ? stem.slice(0, stem.length - match[0].length)
    : stem;
};

export const sidecarFilesForStem = (directory: string, stem: string): SidecarFile[] => {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    // An unreadable directory must not lose the exact-name sidecars ECHO already supported.
    return sidecarExtensions
      .filter((extension) => existsSync(join(directory, `${stem}${extension}`)))
      .map((extension) => primaryFile(join(directory, `${stem}${extension}`), extension));
  }

  const lowerStem = stem.toLocaleLowerCase();
  const primaries: SidecarFile[] = [];
  const languageFiles: SidecarFile[] = [];

  for (const extension of sidecarExtensions) {
    const matched = entries.find((entry) => entry.toLocaleLowerCase() === `${lowerStem}${extension}`);
    if (matched) {
      primaries.push(primaryFile(join(directory, matched), extension));
    }
  }

  for (const entry of entries) {
    const parsed = parseLanguageSidecarName(entry);
    if (!parsed || parsed.base.toLocaleLowerCase() !== lowerStem) {
      continue;
    }

    languageFiles.push({
      filePath: join(directory, parsed.fileName),
      extension: parsed.extension,
      role: parsed.role,
      language: parsed.language,
    });
  }

  return [...primaries, ...languageFiles];
};

export const sidecarFilesForAudio = (audioPath: string): SidecarFile[] => {
  const folder = dirname(audioPath);
  const stem = basename(audioPath, extname(audioPath));

  return [
    ...sidecarFilesForStem(folder, stem),
    ...sidecarFilesForStem(join(folder, 'lyrics'), stem),
  ];
};

export const sidecarSecondaryPaths = (files: SidecarFile[], primaryPath: string): SidecarSecondaryPaths => {
  const pick = (role: SidecarLanguageRole): string | null =>
    files.find((file) => file.role === role && file.filePath !== primaryPath)?.filePath ?? null;

  return {
    translation: pick('translation'),
    romanization: pick('romanization'),
  };
};

export const sidecarPrimaryFiles = (files: SidecarFile[]): SidecarFile[] => {
  const primaries = files.filter((file) => file.role === 'primary');
  if (primaries.length > 0) {
    return primaries;
  }

  // With no untagged sidecar the language file is the best local lyrics we have, so it stands in as primary.
  const promoted = files.find((file) => file.role === 'translation') ?? files.find((file) => file.role === 'romanization');
  return promoted ? [promoted] : [];
};
