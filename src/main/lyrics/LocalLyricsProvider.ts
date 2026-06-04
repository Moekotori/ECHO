import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { parseFile, type IAudioMetadata, type ILyricsTag } from 'music-metadata';
import type { LyricsQuery, LyricsSearchCandidate, TrackLyrics } from '../../shared/types/lyrics';
import { decodeTextFileBytes } from '../../shared/utils/decodeTextFile';
import type { LyricsProvider, LyricsProviderCapability, LyricsProviderResult, LyricsProviderSearchRequest } from './LyricsProvider';
import { detectLyricsKind, normalizeSyncedLyricAlternates, parsePlainLyrics, parseSyncedLyrics } from './lyricsParser';

export type LocalLyricsCandidate = LyricsSearchCandidate & {
  filePath: string;
  extension: '.lrc' | '.ttml' | '.txt';
};

const nowIso = (): string => new Date().toISOString();

const fileHashId = (filePath: string): string => `local:${createHash('sha1').update(filePath).digest('hex')}`;
const embeddedHashId = (filePath: string, text: string): string => `local:embedded:${createHash('sha1').update(`${filePath}\n${text}`).digest('hex')}`;

const readTextFile = (filePath: string): string | null => {
  try {
    return decodeTextFileBytes(readFileSync(filePath));
  } catch {
    return null;
  }
};

const timestampPattern = /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/u;
const asfLyricsExtensions = new Set(['.asf', '.wma', '.wmv']);
type LyricsSyncText = ILyricsTag['syncText'];

const cleanText = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const lrcTime = (timestamp: number): string => {
  const safeTimestamp = Math.max(0, Math.round(timestamp));
  const minutes = Math.floor(safeTimestamp / 60000);
  const seconds = Math.floor((safeTimestamp % 60000) / 1000);
  const centiseconds = Math.floor((safeTimestamp % 1000) / 10);

  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`;
};

const syncTextToLrc = (syncText: LyricsSyncText): string | null => {
  const lines = syncText
    .filter((line) => typeof line.text === 'string' && line.text.trim() && typeof line.timestamp === 'number' && Number.isFinite(line.timestamp))
    .map((line) => `${lrcTime(line.timestamp ?? 0)}${line.text.trim()}`);

  return lines.length ? lines.join('\n') : null;
};

const lyricsTextToProviderText = (value: string | null): { syncedLyrics: string | null; plainLyrics: string | null } => {
  if (!value) {
    return { syncedLyrics: null, plainLyrics: null };
  }

  return (timestampPattern.test(value) || /<tt(?:\s|>)/iu.test(value)) && parseSyncedLyrics(value).length > 0
    ? { syncedLyrics: value, plainLyrics: null }
    : { syncedLyrics: null, plainLyrics: value };
};

const nativeValues = (metadata: IAudioMetadata, keys: string[]): unknown[] => {
  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const values: unknown[] = [];

  for (const entries of Object.values(metadata.native ?? {})) {
    for (const entry of entries) {
      const id = typeof entry.id === 'string' ? entry.id.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
      if (normalizedKeys.has(id)) {
        values.push(entry.value);
      }
    }
  }

  return values;
};

const firstNativeText = (metadata: IAudioMetadata, keys: string[]): string | null => {
  for (const value of nativeValues(metadata, keys)) {
    const text = cleanText(value);
    if (text) {
      return text;
    }
  }

  return null;
};

const firstAsfNativeLyricsText = (filePath: string, metadata: IAudioMetadata): string | null =>
  asfLyricsExtensions.has(extname(filePath).toLowerCase()) ? firstNativeText(metadata, ['WM/Lyrics']) : null;

const candidatePaths = (audioPath: string): Array<{ filePath: string; extension: LocalLyricsCandidate['extension'] }> => {
  const folder = dirname(audioPath);
  const baseName = basename(audioPath, extname(audioPath));

  return [
    { filePath: join(folder, `${baseName}.lrc`), extension: '.lrc' },
    { filePath: join(folder, `${baseName}.ttml`), extension: '.ttml' },
    { filePath: join(folder, `${baseName}.txt`), extension: '.txt' },
    { filePath: join(folder, 'lyrics', `${baseName}.lrc`), extension: '.lrc' },
    { filePath: join(folder, 'lyrics', `${baseName}.ttml`), extension: '.ttml' },
    { filePath: join(folder, 'lyrics', `${baseName}.txt`), extension: '.txt' },
  ];
};

const localLyricsSourceLabel = (extension: LocalLyricsCandidate['extension']): string => {
  if (extension === '.ttml') {
    return 'Local TTML';
  }

  return extension === '.lrc' ? 'Local LRC' : 'Local text';
};

const localSidecarReasons = (query: LyricsQuery, extension: LocalLyricsCandidate['extension'], raw: string | null): string[] => {
  const reasons = ['local_sidecar_priority'];
  const durationSeconds = Number(query.durationSeconds);
  if (extension === '.txt' || !raw || !Number.isFinite(durationSeconds) || durationSeconds <= 20) {
    return reasons;
  }

  const endMs = Math.max(0, ...parseSyncedLyrics(raw).map((line) => line.timeMs));
  if (endMs > (durationSeconds + 20) * 1000) {
    reasons.push('duration_mismatch', 'candidate_only_duration');
  }

  return reasons;
};

const localSidecarScore = (reasons: string[]): number =>
  reasons.includes('candidate_only_duration') ? 0.42 : 1;

export class LocalLyricsProvider implements LyricsProvider {
  readonly id = 'local' as const;
  readonly label = 'Local';
  readonly priority = 1000;
  readonly capabilities: LyricsProviderCapability = {
    synced: true,
    plain: true,
    translation: false,
    romanization: false,
    byDuration: false,
    byIsrc: false,
    byMusicBrainzId: false,
    needsAccount: false,
  };

  async search(request: LyricsProviderSearchRequest): Promise<LyricsProviderResult[]> {
    const embedded = await this.getEmbeddedResult(request.query);
    if (embedded) {
      return [embedded];
    }

    return this.searchCandidates(request.query)
      .map((candidate) => this.getResultFromCandidate(request.query, candidate))
      .filter((result): result is LyricsProviderResult => Boolean(result));
  }

  getLyrics(query: LyricsQuery): TrackLyrics | null {
    const [candidate] = this.searchCandidates(query);
    return candidate ? this.getLyricsFromCandidate(query, candidate) : null;
  }

  getResultFromCandidate(query: LyricsQuery, candidate: LocalLyricsCandidate): LyricsProviderResult | null {
    const raw = readTextFile(candidate.filePath);
    if (!raw) {
      return null;
    }

    return {
      provider: 'local',
      providerLyricsId: candidate.providerLyricsId ?? fileHashId(candidate.filePath),
      title: query.title,
      artist: query.artist,
      album: query.album ?? null,
      durationSeconds: query.durationSeconds ?? null,
      instrumental: false,
      plainLyrics: candidate.extension === '.txt' ? raw : null,
      syncedLyrics: candidate.extension === '.txt' ? null : raw,
      sourceLabel: localLyricsSourceLabel(candidate.extension),
      matchReasons: candidate.reasons?.length ? candidate.reasons : localSidecarReasons(query, candidate.extension, raw),
      raw: {
        filePath: candidate.filePath,
        extension: candidate.extension,
      },
    };
  }

  searchCandidates(query: LyricsQuery): LocalLyricsCandidate[] {
    if (!query.filePath) {
      return [];
    }

    return candidatePaths(query.filePath)
      .filter((candidate) => existsSync(candidate.filePath))
      .map((candidate): LocalLyricsCandidate => {
        const reasons = localSidecarReasons(query, candidate.extension, readTextFile(candidate.filePath));
        return {
          id: randomUUID(),
          provider: 'local',
          providerLyricsId: fileHashId(candidate.filePath),
          title: query.title,
          artist: query.artist,
          album: query.album ?? null,
          durationSeconds: query.durationSeconds ?? null,
          instrumental: false,
          hasSynced: candidate.extension !== '.txt',
          hasPlain: candidate.extension === '.txt',
          score: localSidecarScore(reasons),
          risk: reasons.includes('candidate_only_duration') ? 'medium' : undefined,
          reasons,
          sourceLabel: localLyricsSourceLabel(candidate.extension),
          filePath: candidate.filePath,
          extension: candidate.extension,
        };
      });
  }

  private async getEmbeddedResult(query: LyricsQuery): Promise<LyricsProviderResult | null> {
    if (!query.filePath) {
      return null;
    }

    try {
      const metadata = await parseFile(query.filePath, {
        duration: false,
        skipCovers: true,
      });
      const lyricsTags = Array.isArray(metadata.common.lyrics) ? metadata.common.lyrics : [];
      const syncedTag = lyricsTags.find((tag) => Array.isArray(tag.syncText) && tag.syncText.length > 0);
      const syncedLyrics = syncedTag ? syncTextToLrc(syncedTag.syncText) : null;
      const plainTag = lyricsTags.find((tag) => typeof tag.text === 'string' && tag.text.trim());
      const plainText = cleanText(plainTag?.text) ?? firstAsfNativeLyricsText(query.filePath, metadata);
      const providerText = syncedLyrics ? { syncedLyrics, plainLyrics: null } : lyricsTextToProviderText(plainText);
      const rawText = providerText.syncedLyrics ?? providerText.plainLyrics;

      if (!rawText) {
        return null;
      }

      return {
        provider: 'local',
        providerLyricsId: embeddedHashId(query.filePath, rawText),
        title: query.title,
        artist: query.artist,
        album: query.album ?? null,
        durationSeconds: query.durationSeconds ?? null,
        instrumental: false,
        plainLyrics: providerText.plainLyrics,
        syncedLyrics: providerText.syncedLyrics,
        sourceLabel: 'Embedded tag',
        matchReasons: ['embedded_tag_priority'],
        raw: {
          source: 'embedded',
          filePath: query.filePath,
          hasSynced: Boolean(providerText.syncedLyrics),
        },
      };
    } catch {
      return null;
    }
  }

  getLyricsFromCandidate(query: LyricsQuery, candidate: LocalLyricsCandidate): TrackLyrics | null {
    const raw = readTextFile(candidate.filePath);
    if (!raw) {
      return null;
    }

    const syncedLyrics = candidate.extension === '.txt' ? null : raw;
    const plainLyrics = candidate.extension === '.txt' ? raw : null;
    const kind = detectLyricsKind({ syncedLyrics, plainLyrics });
    const lines =
      kind === 'synced'
        ? normalizeSyncedLyricAlternates(parseSyncedLyrics(raw))
        : kind === 'plain'
          ? parsePlainLyrics(raw)
          : [];

    if (kind === 'empty') {
      return null;
    }

    const timestamp = nowIso();
    return {
      id: randomUUID(),
      trackId: query.trackId ?? null,
      provider: 'local',
      providerLyricsId: candidate.providerLyricsId ?? fileHashId(candidate.filePath),
      kind,
      title: query.title,
      artist: query.artist,
      album: query.album ?? null,
      durationSeconds: query.durationSeconds ?? null,
      lines,
      plainText: plainLyrics,
      syncedText: syncedLyrics,
      offsetMs: 0,
      score: 1,
      cachedAt: timestamp,
      updatedAt: timestamp,
    };
  }
}
