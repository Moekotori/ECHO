import type { DownloadJob } from '../../shared/types/downloads';
import type { QobuzFormatId, QobuzDownloadOptions } from '../../shared/types/qobuz';
import { QOBUZ_QUALITY_BY_FORMAT } from '../../shared/types/qobuz';
import { NonStreamableError, QobuzApiClient } from './QobuzApiClient';
import { QobuzAuthService } from './QobuzAuthService';
import type { DownloadService } from '../downloads/DownloadService';

// ── helpers ───────────────────────────────────────────────────

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const sanitizeFileName = (name: string): string =>
  name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 200);

const formatFolderName = (
  template: string,
  album: Record<string, unknown>,
  quality: QobuzFormatId,
): string => {
  const artist = text(asRecord(album.artist).name) || text(album.artist_name) || 'Unknown Artist';
  const title = text(album.title) || 'Unknown Album';
  const year = text(album.release_date_original)?.slice(0, 4) || text(album.release_date_stream)?.slice(0, 4) || '0000';
  const qualityInfo = QOBUZ_QUALITY_BY_FORMAT.get(quality);
  const bitDepth = qualityInfo?.formatId === 5 ? '16' : (qualityInfo?.formatId === 27 ? '24' : '16');
  const sampleRate = qualityInfo?.formatId === 5 ? '44.1kHz' : (qualityInfo?.formatId === 27 ? '192kHz' : '96kHz');

  return template
    .replace(/\{artist\}/g, artist)
    .replace(/\{album\}/g, title)
    .replace(/\{year\}/g, year)
    .replace(/\{bit_depth\}B?/gi, `${bitDepth}B`)
    .replace(/\{sampling_rate\}k?Hz?/gi, `${sampleRate}`);
};

// ── service class ─────────────────────────────────────────────

export class QobuzDownloadService {
  private resolvedUrls = new Map<string, { url: string; expiresAt: number }>();
  private readonly URL_EXPIRY_MS = 30 * 60 * 1000; // 30 min

  constructor(
    private downloadService: DownloadService,
  ) {}

  private get auth(): QobuzAuthService {
    return QobuzAuthService.getInstance();
  }

  private get api(): QobuzApiClient {
    return this.auth.getApiClient();
  }

  /**
   * Download an entire Qobuz album to the local library.
   * Resolves signed CDN URLs for each track, then creates
   * DownloadService direct-audio jobs for the actual HTTP download.
   */
  async downloadAlbum(
    albumId: string,
    quality: QobuzFormatId,
    options?: QobuzDownloadOptions,
  ): Promise<{ jobIds: string[]; albumTitle: string }> {
    await this.auth.ensureValid();

    // 1. Fetch album metadata
    const rawAlbum = await this.api.getAlbum(albumId);
    const album = asRecord(rawAlbum);

    if (album.streamable === false) {
      throw new NonStreamableError('此专辑不支持下载');
    }

    const albumArtist = asRecord(album.artist);
    const albumTitle = text(album.title) || 'Unknown Album';
    const qualityInfo = QOBUZ_QUALITY_BY_FORMAT.get(quality);

    // 2. Determine output folder
    const outputDir = options?.outputDir ?? this.downloadService.getSettings().outputDirectory;
    if (!outputDir) {
      throw new Error('请先设置下载目录');
    }

    const folderTemplate = options?.folderFormat ?? '{artist} - {album} ({year}) [{bit_depth}B-{sampling_rate}kHz]';
    const folderName = formatFolderName(folderTemplate, album, quality);
    const outputSubdirectory = folderName;

    // 3. Download cover art
    const coverUrl = text(asRecord(album.image).large) || text(asRecord(album.image).small);

    // 4. Create download jobs for each track
    const tracks = asArray(asRecord(album.tracks).items);
    const jobIds: string[] = [];

    for (const [index, trackItem] of tracks.entries()) {
      const track = asRecord(trackItem);
      const trackId = typeof track.id === 'number' ? String(track.id) : text(track.id);
      if (!trackId) continue;

      // Resolve signed CDN URL
      const fileUrl = await this.getOrRefreshTrackUrl(trackId, quality);

      const trackNum = String(index + 1).padStart(2, '0');
      const trackTitle = text(track.title) || `Track ${trackNum}`;
      const ext = qualityInfo?.extension ?? 'flac';
      const fileName = `${trackNum}. ${sanitizeFileName(trackTitle)}.${ext}`;

      const performer = asRecord(track.performer);

      const job: DownloadJob = this.downloadService.createUrlJob(fileUrl, {
        directAudio: true,
        directAudioMimeType: qualityInfo?.mimeType ?? 'audio/flac',
        directAudioExtension: ext,
        streamingProvider: 'qobuz',
        streamingProviderTrackId: trackId,
        streamingStableKey: `streaming:qobuz:${trackId}`,
        requestHeaders: { 'Referer': 'https://play.qobuz.com/' },
        importToLibrary: options?.importToLibrary !== false,
        outputSubdirectory,
        title: trackTitle,
        artist: text(performer.name) || text(albumArtist.name) || 'Unknown Artist',
        album: albumTitle,
        albumArtist: text(albumArtist.name) || undefined,
        coverUrl: coverUrl || undefined,
        webpageUrl: `https://play.qobuz.com/album/${albumId}`,
      });

      jobIds.push(job.id);
    }

    return { jobIds, albumTitle };
  }

  /**
   * Get a signed CDN URL for a track, with caching and
   * refresh-before-expiry logic to handle CDN URL expiration.
   */
  private async getOrRefreshTrackUrl(trackId: string, formatId: QobuzFormatId): Promise<string> {
    const cached = this.resolvedUrls.get(trackId);
    // Refresh if URL will expire within 5 minutes
    if (cached && Date.now() < cached.expiresAt - 5 * 60 * 1000) {
      return cached.url;
    }

    const fresh = await this.api.getTrackFileUrl(trackId, formatId);
    this.resolvedUrls.set(trackId, {
      url: fresh.url,
      expiresAt: Date.now() + this.URL_EXPIRY_MS,
    });
    return fresh.url;
  }

  /** Clear the URL cache (called on logout). */
  clearCache(): void {
    this.resolvedUrls.clear();
  }
}
