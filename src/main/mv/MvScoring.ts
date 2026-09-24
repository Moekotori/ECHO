import { basename, dirname, extname, normalize } from 'node:path';
import type { LibraryTrack } from '../../shared/types/library';
import type { MvMatchDecision, MvMatchEvidence } from '../../shared/types/mv';
import { isBrowserPlayableVideo } from '../../shared/constants/videoExtensions';
import { buildMvWritingSystemAliases, normalizeMvSemanticText } from './MvTextNormalization';

export const MV_MATCH_ALGORITHM_VERSION = 5;

const sourceWords = [
  'official music video',
  'official video',
  'official mv',
  'music video',
  'official',
  'video',
  '1080p',
  '720p',
  '4k',
  'mv',
  'pv',
  'hd',
  'hq',
  'lyrics',
  'lyric',
  'audio',
  'feat',
  'ft',
  'featuring',
];

const sourceWordPattern = [...sourceWords]
  .sort((left, right) => right.length - left.length)
  .map((word) => word.replace(/\s+/g, '\\s+'))
  .join('|');

export const normalizeMvText = (value: string | null | undefined): string =>
  normalizeMvSemanticText((value ?? '').replace(/\.[a-z0-9]+$/i, ''))
    .replace(new RegExp(`(?:^|\\s)(${sourceWordPattern})(?=\\s|$)`, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim();

const comparableTokens = (value: string): string[] =>
  normalizeMvText(value).match(/[\p{L}\p{N}]+/gu)?.filter((token) => token.length > 1) ?? [];

const phraseIncluded = (haystack: string, needle: string): boolean => {
  if (!haystack || !needle) {
    return false;
  }

  return ` ${haystack} `.includes(` ${needle} `);
};

const tokenCoverage = (haystack: string, needle: string): number => {
  const expected = comparableTokens(needle);
  if (expected.length === 0) {
    return 0;
  }

  const actual = new Set(comparableTokens(haystack));
  return expected.filter((token) => actual.has(token)).length / expected.length;
};

const stripSourceWords = (value: string): string => {
  let result = ` ${value} `;
  for (const word of sourceWords) {
    result = result.replace(new RegExp(`\\s${word.replace(/\s+/g, '\\s+')}\\s`, 'gi'), ' ');
  }

  return result.replace(/\s+/g, ' ').trim();
};

const containsAllWords = (haystack: string, needle: string): boolean => {
  const words = needle.split(' ').filter((word) => word.length > 1);
  return words.length > 0 && words.every((word) => haystack.includes(word));
};

const artistAliases = (
  track: Pick<LibraryTrack, 'artist' | 'albumArtist'>,
  includeWritingSystemAliases = true,
): string[] => {
  const values = [track.artist, track.albumArtist].filter((value): value is string => Boolean(value?.trim()));
  const aliases = values
    .flatMap((value) => [value, ...value.split(/[/&,，;；|]+|\b(?:feat(?:uring)?|ft)\.?\b/giu)])
    .flatMap((value) => includeWritingSystemAliases ? buildMvWritingSystemAliases(value) : [normalizeMvSemanticText(value)])
    .filter((value) => value.length > 1)
    .filter((value) => !/^(unknown artist|various artists?|未知歌手|\d{1,2}時)$/iu.test(value));

  return [...new Set(aliases)];
};

const compareWritingSystemAliases = (
  haystackValue: string | null | undefined,
  needleValue: string | null | undefined,
): { exact: boolean; phrase: boolean; coverage: number; usedAlias: boolean } => {
  const haystacks = buildMvWritingSystemAliases(haystackValue, normalizeMvText);
  const needles = buildMvWritingSystemAliases(needleValue, normalizeMvText);
  let best = { exact: false, phrase: false, coverage: 0, usedAlias: false };

  for (const haystack of haystacks) {
    for (const needle of needles) {
      const exact = Boolean(needle && haystack === needle);
      const phrase = !exact && phraseIncluded(haystack, needle);
      const coverage = tokenCoverage(haystack, needle);
      const stronger = exact || (!best.exact && phrase && !best.phrase) || (!best.exact && !best.phrase && coverage > best.coverage);
      if (stronger) {
        best = {
          exact,
          phrase,
          coverage,
          usedAlias: haystack !== haystacks[0] || needle !== needles[0],
        };
      }
      if (exact) {
        return best;
      }
    }
  }

  return best;
};

const compactArtistText = (value: string): string => value.replace(/\s+/g, '');

const findArtistEvidence = (
  track: Pick<LibraryTrack, 'artist' | 'albumArtist'>,
  candidateTitle: string,
  uploader: string | null | undefined,
  includeWritingSystemAliases = true,
): 'title' | 'uploader' | null => {
  const titles = includeWritingSystemAliases ? buildMvWritingSystemAliases(candidateTitle) : [normalizeMvSemanticText(candidateTitle)];
  const channels = includeWritingSystemAliases ? buildMvWritingSystemAliases(uploader) : [normalizeMvSemanticText(uploader)];
  const aliases = artistAliases(track, includeWritingSystemAliases);
  for (const alias of aliases) {
    const compactAlias = compactArtistText(alias);
    if (channels.some((channel) =>
      phraseIncluded(channel, alias) ||
      (compactAlias.length >= 4 && compactArtistText(channel).includes(compactAlias)))) {
      return 'uploader';
    }
  }

  for (const alias of aliases) {
    if (titles.some((title) => phraseIncluded(title, alias))) {
      return 'title';
    }
  }

  return null;
};

const parseIsoDuration = (value: string): number | null => {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/iu.exec(value.trim());
  if (!match) {
    return null;
  }

  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
};

export const parseMvDurationSeconds = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const isoDuration = parseIsoDuration(trimmed);
  if (isoDuration !== null) {
    return isoDuration;
  }

  if (/^\d+(?:\.\d+)?$/u.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  const parts = trimmed.split(':').map((part) => Number(part));
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return null;
  }

  const seconds = parts.length === 3
    ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
    : parts[0]! * 60 + parts[1]!;
  return seconds > 0 ? seconds : null;
};

const officialVideoPattern = /\b(?:official\s+(?:music\s+)?video|official\s+mv|music\s+video|mv|pv|bga)\b|官方(?:音乐|音樂)?(?:视频|影片)|原创曲|原創曲|オリジナル(?:曲|ソング)/iu;
const nonMvContentPattern = /\b(?:vlog|reaction|tutorial|gameplay|walkthrough|guide|mmd|amv|mad|mashup|pjd|project\s*diva|mega39\s*s|megamix|project\s*sekai|pjsk|colorful\s*stage|lanota|arcaea|d4dj|bang\s*dream|bandori|cubase|fl\s*studio|ableton|roblox|vinyl|wallpaper|wota|sheet\s*music|drum\s*cover|piano\s*cover|instrument\s*cover|on\s*vocal|off\s*vocal|tab|2dmv)\b|教程|网课|網課|手元|譜面|谱面|简谱|簡譜|音游|音遊|音乐\s*id|音樂\s*id|プロセカ|プロジェクトセカイ|世界计划|世界計畫|多彩舞台|整活|模组|模組|解说|解說|挑战|挑戰|动态鼓谱|動態鼓譜|鼓谱|鼓譜|总谱|總譜|吉他谱|吉他譜|贝斯谱|貝斯譜|贝斯版|貝斯版|钢琴谱|鋼琴譜|琴谱|琴譜|特效谱|特效譜|自制谱|自製譜|自制\s*op|自製\s*op|混剪|混剪版|串烧|串燒|三厨狂喜|多厨狂喜|壁纸|壁紙|黑胶|黑膠|试听|試聽|大声听|大聲聽|翻调|翻調|演奏|弹奏|彈奏|口琴|钢琴编曲|鋼琴編曲|原创振付|原創振付|踊ってみた|编舞|編舞|舞台背景|自用背景|爬台|宅舞|动画纯享|動畫純享|ニコカラ|光遇|冰与火之舞|冰與火之舞|osu!?|maimai/iu;
const unofficialVisualPattern = /\b(?:fan[ -]?made|fanmade)\b|原创\s*(?:mv|pv)|原創\s*(?:mv|pv)|自制\s*(?:mv|pv)|自製\s*(?:mv|pv)|オリジナル\s*(?:mv|pv)/iu;
const aiVoiceReplacementPattern = /\b(?:ai\s*(?:cover|voice|singer)|feat(?:uring)?\.?\s*ai|rvc|so-vits)\b|【ai[^】]{0,24}】|ai切|ai翻唱|ai歌唱|ai歌聲|ai声线|ai聲線|音色克隆/iu;
const unrelatedGameEditPattern = /\b(?:genshin|honkai|phigros)\b|原神|崩坏|崩壞|舞萌|音击|音擊/iu;
const variantLabels = [
  { label: 'cover', pattern: /\bcovers?\b|\bcovered\s+by\b|翻唱|歌ってみた|カバー/iu },
  { label: 'live', pattern: /\blive\b|演唱会|演唱會|现场版|現場版|现场演唱|現場演唱|ライブ/iu },
  { label: 'remix', pattern: /\bremix\b|リミックス/iu },
  { label: 'karaoke', pattern: /\bkaraoke\b|卡拉ok|カラオケ/iu },
  { label: 'instrumental', pattern: /\binstrumental\b|伴奏/iu },
  { label: 'lyrics', pattern: /\blyrics?\b|歌词|歌詞/iu },
  { label: 'audio', pattern: /\b(?:official\s+)?audio\b|纯音乐|純音樂/iu },
  { label: 'speed edit', pattern: /\b(?:nightcore|sped\s+up|slowed(?:\s+down)?)\b/iu },
  { label: 're-recorded version', pattern: /\b(?:reformare|re-recorded|rerecorded|re-recording)\b|重录版|重錄版|重新录制|重新錄製/iu },
  { label: 'extended version', pattern: /\bextended(?:\s+(?:mix|version))?\b|加长(?:版)?|加長(?:版)?/iu },
  { label: 'alternate version', pattern: /\b(?:another\s+story|adam\s+by\s+eve|alternate\s+version|broadcast\s+version)\b|播出版|別\s*ver\.?/iu },
] as const;

export type MvScoreResult = {
  score: number;
  reasons: string[];
};

export type NetworkMvScoreResult = MvScoreResult & {
  autoEligible: boolean;
  matchVersion: number;
  decision: MvMatchDecision;
};

export const scoreNetworkMvCandidate = (
  track: Pick<LibraryTrack, 'title' | 'artist' | 'albumArtist' | 'duration'>,
  candidate: { title: string; uploader?: string | null; durationSeconds?: number | null },
): NetworkMvScoreResult => {
  const trackTitle = normalizeMvText(track.title);
  const rawTrackTitle = normalizeMvSemanticText(track.title);
  const rawCandidateTitle = normalizeMvSemanticText(candidate.title);
  const reasons: string[] = [];
  let score = 0;

  const titleComparison = compareWritingSystemAliases(candidate.title, track.title);
  const { coverage, exact: titleExact, phrase: titlePhrase, usedAlias: writingSystemAlias } = titleComparison;
  if (titleExact) {
    score += 0.58;
    reasons.push('title exact');
  } else if (titlePhrase) {
    score += 0.5;
    reasons.push('title phrase');
  } else if (coverage >= 0.999) {
    score += 0.42;
    reasons.push('title tokens exact');
  } else if (coverage >= 0.75) {
    score += 0.32;
    reasons.push(`title tokens ${Math.round(coverage * 100)}%`);
  } else if (coverage >= 0.5) {
    score += 0.18;
    reasons.push(`title tokens ${Math.round(coverage * 100)}%`);
  } else {
    reasons.push('title mismatch');
  }
  const artistEvidence = findArtistEvidence(track, candidate.title, candidate.uploader);
  const artistWritingSystemAlias = Boolean(
    artistEvidence && !findArtistEvidence(track, candidate.title, candidate.uploader, false),
  );
  if (artistEvidence) {
    score += artistEvidence === 'uploader' ? 0.3 : 0.26;
    reasons.push(artistEvidence === 'title' ? 'artist in title' : 'uploader matches artist');
  }
  if ((writingSystemAlias && (titleExact || titlePhrase || coverage >= 0.75)) || artistWritingSystemAlias) {
    reasons.push('writing-system alias');
  }

  const trackDuration = Number(track.duration);
  const candidateDuration = Number(candidate.durationSeconds);
  let durationCorroborated = false;
  let durationConflict = false;
  let durationEvidence: MvMatchEvidence['duration'] = 'unknown';
  if (Number.isFinite(trackDuration) && trackDuration > 0 && Number.isFinite(candidateDuration) && candidateDuration > 0) {
    const relativeDifference = Math.abs(candidateDuration - trackDuration) / Math.max(trackDuration, 1);
    if (relativeDifference <= 0.05) {
      score += 0.18;
      durationCorroborated = true;
      durationEvidence = 'strong';
      reasons.push('duration within 5%');
    } else if (relativeDifference <= 0.12) {
      score += 0.13;
      durationCorroborated = true;
      durationEvidence = 'close';
      reasons.push('duration within 12%');
    } else if (relativeDifference <= 0.2) {
      score += 0.07;
      durationEvidence = 'weak';
      reasons.push('duration within 20%');
    } else if (relativeDifference > 0.35) {
      score -= 0.22;
      durationConflict = true;
      durationEvidence = 'conflict';
      reasons.push('duration conflict');
    }
  }

  const hasOfficialVideoSignal = officialVideoPattern.test(rawCandidateTitle);
  if (hasOfficialVideoSignal) {
    score += 0.05;
    reasons.push('MV signal');
  }

  let contentConflict = false;
  if (nonMvContentPattern.test(rawCandidateTitle) && !nonMvContentPattern.test(rawTrackTitle)) {
    score -= 0.3;
    contentConflict = true;
    reasons.push('non-MV content');
  }

  if (unofficialVisualPattern.test(rawCandidateTitle) && artistEvidence !== 'uploader') {
    score -= 0.24;
    contentConflict = true;
    reasons.push('unverified derivative video');
  }

  if (aiVoiceReplacementPattern.test(rawCandidateTitle) && !artistAliases(track).includes('ai')) {
    score -= 0.3;
    contentConflict = true;
    reasons.push('AI voice replacement');
  }

  if (unrelatedGameEditPattern.test(rawCandidateTitle) && artistEvidence !== 'uploader') {
    score -= 0.24;
    contentConflict = true;
    reasons.push('unrelated game edit');
  }

  for (const variant of variantLabels) {
    if (variant.pattern.test(rawCandidateTitle) && !variant.pattern.test(rawTrackTitle)) {
      score -= 0.18;
      contentConflict = true;
      reasons.push(`variant conflict: ${variant.label}`);
    }
  }

  const strongTitleMatch = titleExact || titlePhrase || coverage >= 0.999;
  const substantialTitleMatch = strongTitleMatch || coverage >= 0.75;
  const corroborated = Boolean(artistEvidence || durationCorroborated);
  const doublyCorroborated = Boolean(artistEvidence && durationCorroborated);
  const titleTokens = comparableTokens(trackTitle);
  const shortOrAmbiguousTitle = trackTitle.length <= 3 || titleTokens.length === 0 || (titleTokens.length === 1 && titleTokens[0]!.length <= 5);
  const shortTitleCorroborated = !shortOrAmbiguousTitle || Boolean(artistEvidence) || (durationCorroborated && hasOfficialVideoSignal);
  const titleEvidenceEligible = strongTitleMatch ? corroborated : substantialTitleMatch && doublyCorroborated;
  const autoEligible = titleEvidenceEligible && shortTitleCorroborated && !durationConflict && !contentConflict;

  if (!corroborated) {
    score = Math.min(score, 0.69);
    reasons.push('auto blocked: no artist or duration evidence');
  }
  if (!autoEligible && (durationConflict || contentConflict || !substantialTitleMatch || !shortTitleCorroborated)) {
    score = Math.min(score, 0.49);
  }

  const normalizedScore = Math.max(0, Math.min(1, Number(score.toFixed(4))));
  const conflicts = reasons.filter((reason) =>
    reason === 'duration conflict' ||
    reason === 'non-MV content' ||
    reason === 'unverified derivative video' ||
    reason === 'AI voice replacement' ||
    reason === 'unrelated game edit' ||
    reason.startsWith('variant conflict:'),
  );
  const evidence: MvMatchEvidence = {
    title: titleExact ? 'exact' : titlePhrase ? 'phrase' : coverage >= 0.5 ? 'tokens' : 'mismatch',
    titleCoverage: Number(coverage.toFixed(4)),
    artist: artistEvidence ?? 'none',
    duration: durationEvidence,
    writingSystemAlias: writingSystemAlias || artistWritingSystemAlias,
    officialVideoSignal: hasOfficialVideoSignal,
    conflicts,
  };
  const decision: MvMatchDecision = {
    score: normalizedScore,
    autoAccept: autoEligible,
    candidateOnly: !autoEligible,
    risk: autoEligible ? 'low' : conflicts.length > 0 ? 'high' : 'medium',
    reasons,
    algorithmVersion: MV_MATCH_ALGORITHM_VERSION,
    evidence,
  };

  return {
    score: normalizedScore,
    reasons,
    autoEligible,
    matchVersion: MV_MATCH_ALGORITHM_VERSION,
    decision,
  };
};

export const scoreLocalMvCandidate = (track: LibraryTrack, filePath: string): MvScoreResult => {
  const audioBase = normalizeMvText(basename(track.path, extname(track.path)));
  const videoBase = normalizeMvText(basename(filePath, extname(filePath)));
  const comparableVideoBase = stripSourceWords(videoBase);
  const title = normalizeMvText(track.title);
  const artist = normalizeMvText(track.artist || track.albumArtist);
  const artistTitle = normalizeMvText(`${track.artist || track.albumArtist} - ${track.title}`);
  const titleArtist = normalizeMvText(`${track.title} - ${track.artist || track.albumArtist}`);
  const reasons: string[] = [];
  let score = 0;

  if (videoBase === audioBase || comparableVideoBase === audioBase) {
    score += 0.55;
    reasons.push('same basename');
  } else if (comparableVideoBase === title || videoBase === title) {
    score += 0.35;
    reasons.push('title exact');
  } else if (comparableVideoBase === artistTitle || comparableVideoBase === titleArtist) {
    score += 0.5;
    reasons.push('artist/title exact');
  } else if (title && containsAllWords(comparableVideoBase, title)) {
    score += 0.24;
    reasons.push('title words');
  }

  if (artist && comparableVideoBase.includes(artist)) {
    score += 0.15;
    reasons.push('artist included');
  }

  const parentFolder = normalize(dirname(filePath)).split(/[\\/]/).pop()?.toLocaleLowerCase() ?? '';
  if (['mv', 'video', 'videos'].includes(parentFolder)) {
    score += 0.1;
    reasons.push('mv folder');
  }

  // TODO: add duration scoring when a lightweight, reliable video probe is available.
  if (isBrowserPlayableVideo(filePath)) {
    score += 0.05;
    reasons.push('browser playable');
  }

  return {
    score: Math.min(1, Number(score.toFixed(4))),
    reasons,
  };
};
