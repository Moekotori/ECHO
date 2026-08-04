import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname } from 'node:path';
import { BrowserWindow } from 'electron';
import { IpcChannels } from '../../shared/constants/ipcChannels';
import type {
  EchoLinkAlbumPreview,
  EchoLinkLibraryAlbumsResponse,
  EchoLinkLibraryAlbumTracksResponse,
  EchoLinkLibraryTracksResponse,
  EchoLinkPlayback,
  EchoLinkPlaybackCommand,
  EchoLinkPlaybackState,
  EchoLinkSettingsResponse,
  EchoLinkServerStatus,
  EchoLinkStatusResponse,
  EchoLinkStreamResponse,
  EchoLinkTrackPreview,
  EchoLinkWebBackground,
} from '../../shared/types/echoLink';
import type { AudioStatus } from '../../shared/types/audio';
import type { LibraryAlbum, LibraryPage, LibraryPageQuery, LibraryTrack } from '../../shared/types/library';
import type { TrackLyrics } from '../../shared/types/lyrics';
import type { PersistedPlaybackSessionV1, PersistedQueueItem } from '../../shared/types/playback';
import { getAudioSession } from '../audioPublicApi';
import { getLibraryService } from '../library/LibraryService';
import { getLyricsService } from '../lyrics/LyricsService';
import type { CoverVariant } from '../library/libraryTypes';
import { EchoLinkMdnsAdvertiser } from './EchoLinkMdnsAdvertiser';
import type { EchoLinkMdnsAdvertisement } from './EchoLinkMdnsAdvertiser';

type LibraryServiceLike = {
  getTrack(trackId: string): LibraryTrack | null;
  getTracks(query?: LibraryPageQuery): LibraryPage<LibraryTrack>;
  getAlbums(query?: LibraryPageQuery): LibraryPage<LibraryAlbum>;
  getAlbum(albumId: string): LibraryAlbum | null;
  getAlbumTracks(albumId: string, query?: Pick<LibraryPageQuery, 'page' | 'pageSize'>): LibraryPage<LibraryTrack>;
  resolveCoverAsset(coverId: string, variant: CoverVariant): { filePath: string; mimeType: string | null } | null;
};

type AudioSessionLike = {
  getStatus(): AudioStatus;
  play(): Promise<AudioStatus>;
  pause(): Promise<AudioStatus>;
  stop(): AudioStatus;
  seek(positionSeconds: number): Promise<AudioStatus>;
  setOutput(settings: { volume?: number }): Promise<AudioStatus>;
  playLocalFile(request: {
    filePath: string;
    trackId?: string;
    startSeconds?: number;
    metadata?: {
      title: string;
      artist: string;
      album: string;
      albumArtist: string;
      coverUrl: string | null;
    };
  }): Promise<AudioStatus>;
};

type LyricsServiceLike = {
  getLyricsForTrack(trackId: string): Promise<TrackLyrics | null>;
};

type EchoLinkServiceDependencies = {
  audioSession?: AudioSessionLike;
  libraryService?: LibraryServiceLike;
  lyricsService?: LyricsServiceLike;
  dispatchPlaybackAction?: (action: 'nextTrack' | 'previousTrack') => void;
  broadcastPlaybackQueueSession?: (session: PersistedPlaybackSessionV1) => void;
  createMdnsAdvertiser?: () => Pick<EchoLinkMdnsAdvertiser, 'start' | 'stop'>;
  getLanAddresses?: () => string[];
  now?: () => number;
  deviceId?: string;
  deviceName?: string;
  port?: number;
};

type MediaTokenRecord = {
  filePath: string;
  mimeType: string;
  expiresAtEpochMs: number;
};

type ArtworkTokenRecord = {
  filePath: string | null;
  mimeType: string;
  expiresAtEpochMs: number;
};

type WebBackgroundAssetRecord = {
  token: string;
  filePath: string;
  mimeType: string;
};

type HttpErrorEvent = {
  at: string;
  path: string;
  statusCode: number;
  message: string;
};

type MediaServeSummary = {
  tokenPrefix: string;
  range: string | null;
  bytes: number | null;
  servedAt: string;
};

type MdnsState = {
  state: 'disabled' | 'advertising' | 'error';
  serviceName: string;
  error: string | null;
  advertisedAddresses: string[];
};

const defaultPort = 26789;
const linkVersion = '1';
const streamTokenTtlMs = 5 * 60 * 1000;
const artworkTokenTtlMs = 30 * 60 * 1000;
const maxLibraryPageSize = 500;
const maxJsonBodyBytes = 2 * 1024 * 1024;
const defaultDeviceName = 'PC ECHO';
const defaultWebBackground: EchoLinkWebBackground = { type: 'none', url: '' };
const internalWebBackgroundPathPrefix = '/echo-link/v1/background/';
const internalWebBackgroundUrlPattern = /^\/echo-link\/v1\/background\/[A-Za-z0-9_-]+$/u;
const webBackgroundImageExtensions = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp']);

const safeHeader = (value: string | string[] | undefined): string | undefined => (typeof value === 'string' ? value : undefined);

const normalizeRemoteAddress = (value: string | undefined): string => (value ?? '').replace(/^::ffff:/u, '');

const isLanAddress = (address: string): boolean =>
  address === '::1' ||
  /^127\./u.test(address) ||
  /^10\./u.test(address) ||
  /^192\.168\./u.test(address) ||
  /^172\.(1[6-9]|2\d|3[0-1])\./u.test(address) ||
  /^169\.254\./u.test(address);

const listLanAddresses = (): string[] => {
  const addresses: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && isLanAddress(entry.address)) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
};

const mimeTypeForAudioPath = (filePath: string): string => {
  switch (extname(filePath).toLowerCase()) {
    case '.mp3':
    case '.mp2':
    case '.mp1':
      return 'audio/mpeg';
    case '.flac':
      return 'audio/flac';
    case '.wav':
      return 'audio/wav';
    case '.m4a':
    case '.mp4':
    case '.alac':
      return 'audio/mp4';
    case '.aac':
      return 'audio/aac';
    case '.ogg':
    case '.opus':
      return 'audio/ogg';
    case '.aif':
    case '.aiff':
      return 'audio/aiff';
    default:
      return 'application/octet-stream';
  }
};

const mimeTypeForImagePath = (filePath: string): string => {
  switch (extname(filePath).toLowerCase()) {
    case '.avif':
      return 'image/avif';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
};

const androidFriendlyAudioExtensions = new Set(['.mp3', '.flac', '.wav', '.m4a', '.mp4', '.aac', '.ogg', '.opus']);

const isAndroidFriendlyAudioPath = (filePath: string): boolean => androidFriendlyAudioExtensions.has(extname(filePath).toLowerCase());

const stateForAudioStatus = (status: AudioStatus): EchoLinkPlaybackState => {
  switch (status.state) {
    case 'loading':
    case 'playing':
    case 'paused':
    case 'stopped':
    case 'error':
      return status.state;
    case 'ended':
      return 'stopped';
    case 'idle':
    default:
      return 'idle';
  }
};

const sourceLabelForTrack = (track: LibraryTrack): string => {
  if (track.mediaType === 'remote') {
    return track.sourceDisplayName ?? 'Remote Library';
  }
  if (track.mediaType === 'streaming') {
    return track.provider ?? 'Streaming';
  }
  return 'Local Library';
};

const canPlayOnPhone = (track: LibraryTrack): boolean =>
  (track.mediaType ?? 'local') === 'local' && existsSync(track.path) && isAndroidFriendlyAudioPath(track.path);

const firstNonEmpty = (...values: Array<string | null | undefined>): string | null => {
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
};

const fileNameFromPath = (filePath: string | null | undefined): string | null => {
  const trimmed = firstNonEmpty(filePath);
  if (!trimmed) {
    return null;
  }
  return trimmed.split(/[\\/]/u).pop() ?? trimmed;
};

const comparablePath = (filePath: string | null | undefined): string | null => firstNonEmpty(filePath)?.replace(/\\/gu, '/').toLowerCase() ?? null;

const webSafeArtworkUrl = (value: string | null | undefined): string | null => {
  const trimmed = firstNonEmpty(value);
  return trimmed && /^(https?:|data:)/iu.test(trimmed) ? trimmed : null;
};

class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

const normalizeWebBackground = (value: unknown): EchoLinkWebBackground => {
  const input = value && typeof value === 'object' ? value as { type?: unknown; url?: unknown } : {};
  const type: EchoLinkWebBackground['type'] = input.type === 'image' || input.type === 'video' ? input.type : 'none';
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  if (type === 'none' || !url) {
    return { ...defaultWebBackground };
  }
  if (url.length > 4096) {
    throw new HttpError(400, 'background_url_too_long');
  }
  if (!/^https?:\/\//iu.test(url) && !/^data:(image|video)\//iu.test(url) && !internalWebBackgroundUrlPattern.test(url)) {
    throw new HttpError(400, 'background_url_must_be_http_or_data');
  }
  return { type, url };
};

const normalizeLocalWebBackgroundImage = (value: unknown): { filePath: string; mimeType: string } => {
  const inputPath = typeof value === 'string' ? value.trim() : '';
  if (!inputPath) {
    throw new HttpError(400, 'background_image_file_required');
  }
  if (!existsSync(inputPath)) {
    throw new HttpError(404, 'background_image_file_missing');
  }
  const filePath = realpathSync(inputPath);
  const fileStat = statSync(filePath);
  if (!fileStat.isFile()) {
    throw new HttpError(400, 'background_image_must_be_file');
  }
  if (!webBackgroundImageExtensions.has(extname(filePath).toLowerCase())) {
    throw new HttpError(400, 'background_image_type_not_supported');
  }
  return { filePath, mimeType: mimeTypeForImagePath(filePath) };
};

const formatLrcTimestamp = (timeMs: number): string => {
  const safe = Math.max(0, Math.floor(timeMs));
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const centiseconds = Math.floor((safe % 1000) / 10);
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`;
};

const lyricsToAndroidText = (lyrics: TrackLyrics): string | null => {
  const syncedText = lyrics.syncedText?.trim();
  if (syncedText) {
    return syncedText;
  }
  const plainText = lyrics.plainText?.trim();
  if (plainText) {
    return plainText;
  }
  const lines = lyrics.lines
    .filter((line) => line.text.trim().length > 0)
    .map((line) => (line.timeMs >= 0 ? `${formatLrcTimestamp(line.timeMs)}${line.text}` : line.text));
  return lines.length > 0 ? lines.join('\n') : null;
};

const writeJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  const payload = Buffer.from(`${JSON.stringify(body)}\n`, 'utf8');
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': String(payload.byteLength),
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(payload);
};

const writeText = (response: ServerResponse, statusCode: number, message: string): void => {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.end(message);
};

const writeHtml = (response: ServerResponse, body: string): void => {
  const payload = Buffer.from(body, 'utf8');
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': String(payload.byteLength),
    'Content-Type': 'text/html; charset=utf-8',
  });
  response.end(payload);
};

const writeError = (response: ServerResponse, statusCode: number, code: string, message = code): void => {
  writeJson(response, statusCode, { code, message, error: code });
};

const createWebControlHtml = (token: string): string => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ECHO Web Control</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #080a0f;
      --panel: rgba(15, 18, 27, 0.74);
      --panel-strong: rgba(18, 22, 31, 0.96);
      --line: rgba(255, 255, 255, 0.13);
      --text: #f8f5ef;
      --muted: #aeb7c5;
      --accent: #9be8f4;
      --warm: #ffcf7a;
      --rose: #ff8caf;
      --violet: #a98cff;
      --glass: rgba(13, 11, 17, 0.56);
      --danger: #ff8a8a;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      overflow-x: hidden;
      color: var(--text);
      background:
        radial-gradient(circle at 42% 42%, rgba(255, 140, 184, 0.24), transparent 34%),
        radial-gradient(circle at 62% 58%, rgba(155, 232, 244, 0.16), transparent 38%),
        radial-gradient(circle at 28% 72%, rgba(255, 207, 122, 0.08), transparent 32%),
        linear-gradient(135deg, #211520 0%, #10131d 48%, #08151a 100%);
      background-size: auto;
    }
    button, input { font: inherit; }
    button {
      border: 1px solid var(--line);
      border-radius: 8px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.08);
      cursor: pointer;
      transition: border-color 150ms ease, background 150ms ease, transform 150ms ease;
    }
    button:disabled { cursor: not-allowed; opacity: 0.52; }
    button:hover:not(:disabled) {
      border-color: rgba(155, 232, 244, 0.42);
      background: rgba(155, 232, 244, 0.12);
      transform: translateY(-1px);
    }
    .shell {
      position: relative;
      min-height: 100vh;
      overflow: hidden;
    }
    .topbar,
    .now,
    .sea-head {
      position: fixed;
      z-index: 10;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(8, 10, 15, 0.7);
      box-shadow: 0 20px 54px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255,255,255,0.08);
      backdrop-filter: blur(22px);
      opacity: 0.16;
      transition: opacity 160ms ease, transform 160ms ease;
    }
    .topbar:hover,
    .now:hover,
    .sea-head:hover,
    .topbar:focus-within,
    .now:focus-within,
    .sea-head:focus-within {
      opacity: 1;
    }
    .topbar {
      top: 14px;
      left: 14px;
      right: auto;
      width: auto;
      max-width: calc(100vw - 28px);
      display: grid;
      grid-template-columns: auto auto;
      gap: 12px;
      align-items: center;
      padding: 8px 9px 8px 11px;
      border-color: rgba(255,255,255,0.08);
      background: rgba(12, 10, 15, 0.34);
      transform: scale(0.92);
      transform-origin: top left;
    }
    .brand small, .now small, .album-detail small, .sea-head small {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 740;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .brand strong {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: clamp(18px, 2vw, 24px);
      line-height: 1.02;
    }
    .beta-badge {
      display: inline-grid;
      min-height: 20px;
      place-items: center;
      padding: 0 8px;
      border: 1px solid rgba(255, 190, 220, 0.28);
      border-radius: 999px;
      color: rgba(255, 232, 244, 0.92);
      background: linear-gradient(135deg, rgba(255, 140, 190, 0.24), rgba(155, 232, 244, 0.12));
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
      font-size: 11px;
      font-weight: 820;
      line-height: 1;
      white-space: nowrap;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }
    .controls button, .album-detail button {
      min-height: 34px;
      min-width: 34px;
      padding: 0 10px;
      font-size: 15px;
      font-weight: 780;
      line-height: 1;
    }
    .controls button.primary, .album-detail button.primary {
      color: #071210;
      border-color: transparent;
      background: var(--accent);
    }
    .stage {
      position: fixed;
      inset: 0;
      overflow: hidden;
      cursor: grab;
      touch-action: none;
      user-select: none;
      perspective: 1400px;
      background:
        radial-gradient(circle at 44% 43%, rgba(255, 132, 184, 0.34), transparent 36%),
        radial-gradient(circle at 64% 58%, rgba(123, 222, 236, 0.22), transparent 42%),
        radial-gradient(circle at 30% 74%, rgba(255, 215, 128, 0.12), transparent 36%),
        linear-gradient(135deg, #3a192b 0%, #1b1525 47%, #06191d 100%);
    }
    .stage::before {
      content: "";
      position: absolute;
      inset: 0;
      z-index: 1;
      pointer-events: none;
      background:
        linear-gradient(rgba(255,255,255,0.028) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.024) 1px, transparent 1px),
        linear-gradient(180deg, rgba(255,255,255,0.08), transparent 24%, transparent 72%, rgba(0,0,0,0.32)),
        linear-gradient(90deg, rgba(0,0,0,0.18), transparent 20%, transparent 80%, rgba(0,0,0,0.24));
      background-size: 96px 96px, 96px 96px, auto, auto;
      opacity: 0.56;
    }
    .stage::after {
      content: "";
      position: absolute;
      inset: 0;
      z-index: 3;
      pointer-events: none;
      background:
        linear-gradient(180deg, rgba(0,0,0,0.04), transparent 18%, transparent 74%, rgba(0,0,0,0.32)),
        linear-gradient(90deg, rgba(0,0,0,0.22), transparent 22%, transparent 78%, rgba(0,0,0,0.24));
    }
    .stage[data-dragging="true"] {
      cursor: grabbing;
    }
    .now {
      left: 18px;
      bottom: 18px;
      display: grid;
      grid-template-columns: 86px minmax(0, 280px);
      gap: 12px;
      align-items: center;
      max-width: min(92vw, 360px);
      padding: 8px;
      border-color: rgba(255,255,255,0.08);
      background: rgba(12, 10, 15, 0.52);
      opacity: 0.14;
      transform: scale(0.74);
      transform-origin: bottom left;
    }
    .now-art {
      width: 66px;
      height: 66px;
      overflow: hidden;
      border-radius: 8px;
      background: #1f232b;
    }
    .now-art img, .album-card img, .album-detail img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .now h1 {
      margin: 0;
      font-size: 20px;
      line-height: 1.1;
    }
    .now p {
      margin: 4px 0 0;
      color: var(--muted);
      line-height: 1.45;
    }
    .now .progress-row,
    .now .search {
      grid-column: 1 / -1;
    }
    .now .search {
      display: none;
    }
    .progress {
      height: 7px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(255,255,255,0.12);
    }
    .progress span {
      display: block;
      height: 100%;
      width: 0;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--accent), var(--warm));
    }
    .search {
      display: flex;
      gap: 8px;
      min-width: 0;
    }
    .search input {
      width: 100%;
      min-height: 42px;
      padding: 0 13px;
      border: 1px solid var(--line);
      border-radius: 8px;
      outline: 0;
      color: var(--text);
      background: rgba(255,255,255,0.08);
    }
    .search input:focus {
      border-color: rgba(155, 232, 244, 0.56);
      box-shadow: 0 0 0 3px rgba(155, 232, 244, 0.12);
    }
    .sea-head {
      top: 92px;
      right: 18px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      max-width: min(92vw, 420px);
      padding: 8px 9px;
      border-color: rgba(255,255,255,0.08);
      background: rgba(12, 10, 15, 0.34);
      transform: scale(0.9);
      transform-origin: top right;
    }
    .sea-head h2 { margin: 0; font-size: 15px; }
    .sea-head small { color: var(--muted); font-weight: 680; }
    .album-mural {
      position: absolute;
      inset: 0;
      z-index: 0;
      overflow: hidden;
      pointer-events: none;
      background:
        radial-gradient(circle at 48% 46%, rgba(255,255,255,0.08), transparent 38%),
        radial-gradient(circle at 36% 62%, rgba(255, 179, 214, 0.12), transparent 34%),
        radial-gradient(circle at 66% 55%, rgba(154, 232, 244, 0.09), transparent 38%);
      opacity: 0.86;
      filter: saturate(1.12);
    }
    .custom-background {
      position: absolute;
      inset: 0;
      z-index: 0;
      overflow: hidden;
      pointer-events: none;
      opacity: 0;
      transition: opacity 280ms ease;
    }
    .custom-background[data-active="true"] {
      opacity: 1;
    }
    .custom-background img,
    .custom-background video {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
      filter: saturate(1.08) brightness(0.76);
      transform: scale(1.018);
    }
    .custom-background::after {
      content: "";
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at 48% 46%, rgba(255,255,255,0.08), transparent 38%),
        linear-gradient(180deg, rgba(0,0,0,0.04), rgba(0,0,0,0.5)),
        linear-gradient(90deg, rgba(0,0,0,0.22), transparent 22%, transparent 78%, rgba(0,0,0,0.3));
    }
    .stage[data-custom-background="true"] .album-mural {
      opacity: 0.18;
    }
    .album-mural::after {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(180deg, rgba(0,0,0,0.02), rgba(0,0,0,0.42)),
        linear-gradient(90deg, rgba(0,0,0,0.2), transparent 22%, transparent 78%, rgba(0,0,0,0.28));
    }
    .sea-viewport {
      position: absolute;
      inset: 0;
      z-index: 2;
      overflow: hidden;
      cursor: grab;
      touch-action: none;
      perspective: 1420px;
    }
    .album-sea {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 3600px;
      height: 2400px;
      transform: translate3d(var(--pan-x, -1800px), var(--pan-y, -1200px), 0);
      transform-origin: 0 0;
      transform-style: preserve-3d;
      transition: none;
      will-change: transform;
    }
    .stage[data-dragging="true"] .sea-viewport {
      cursor: grabbing;
    }
    .album-card {
      position: absolute;
      left: var(--card-x);
      top: var(--card-y);
      width: var(--card-w, 142px);
      z-index: var(--display-z, var(--card-z, 1));
      height: calc(var(--card-w, 142px) * var(--card-ratio, 1.42));
      min-width: 0;
      overflow: hidden;
      padding: 0;
      border: 0;
      border-radius: 18px;
      background: rgba(9, 9, 13, 0.12);
      box-shadow: 0 16px 42px rgba(0,0,0,var(--card-shadow, 0.3));
      transform: translate3d(var(--focus-x, 0px), calc(var(--depth-y, 0px) + var(--focus-y, 0px)), calc(var(--depth-z, 0px) + var(--focus-z, 0px))) rotateX(var(--display-pitch, var(--pitch, 0deg))) rotateY(var(--display-yaw, var(--yaw, 0deg))) rotate(var(--tilt, 0deg)) scale(var(--display-scale, var(--card-scale, 1)));
      opacity: var(--display-opacity, var(--opacity, 1));
      filter: blur(var(--display-blur, var(--card-blur, 0px)));
      contain: layout paint style;
      transition: transform 170ms cubic-bezier(.2,.7,.2,1), box-shadow 170ms ease, opacity 170ms ease, filter 170ms ease;
      backface-visibility: hidden;
      content-visibility: auto;
      contain-intrinsic-size: 138px 196px;
      transform-origin: center center;
      user-select: none;
    }
    .album-card::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(135deg, rgba(255,255,255,0.18), transparent 25%),
        linear-gradient(315deg, rgba(255,255,255,0.08), transparent 48%);
      opacity: 0.34;
    }
    .album-card::after {
      content: "";
      position: absolute;
      top: 10px;
      right: 12px;
      z-index: 2;
      width: 32px;
      height: 32px;
      pointer-events: none;
      background:
        linear-gradient(90deg, transparent 45%, rgba(255,255,255,0.72) 49%, transparent 53%),
        linear-gradient(180deg, transparent 45%, rgba(255,255,255,0.72) 49%, transparent 53%);
      opacity: 0.1;
      transform: rotate(18deg) scale(var(--spark-scale, 1));
    }
    .album-card:hover {
      border-color: rgba(255,255,255,0.16);
      box-shadow: 0 30px 78px rgba(0,0,0,0.48);
      transform: translate3d(var(--focus-x, 0px), calc(var(--depth-y, 0px) + var(--focus-y, 0px) - 10px), calc(var(--depth-z, 0px) + 120px)) rotateX(0deg) rotateY(0deg) rotate(0deg) scale(1.04);
      filter: blur(0);
      opacity: 1;
    }
    .album-card[data-selected="true"] {
      border-color: rgba(255,255,255,0.2);
      box-shadow: 0 26px 70px rgba(255, 178, 213, 0.16), 0 22px 56px rgba(0,0,0,0.4);
      opacity: 1;
    }
    .album-card[data-now="true"] {
      border-color: rgba(255, 192, 220, 0.52);
      box-shadow: 0 30px 78px rgba(255, 160, 204, 0.16), 0 22px 56px rgba(0,0,0,0.42);
      opacity: 1;
    }
    .album-card[data-busy="true"] {
      pointer-events: none;
      opacity: 0.78;
    }
    .album-card[data-layer="back"] {
      filter: blur(var(--display-blur, var(--card-blur, 0.8px)));
    }
    .album-card[data-layer="back"] .album-copy {
      opacity: 1;
    }
    .album-card[data-layer="back"] .album-mini-controls {
      opacity: 0.92;
    }
    .album-card[data-focused="true"] .album-copy,
    .album-card[data-focused="true"] .album-mini-controls {
      opacity: 1;
    }
    .album-card[data-spotlight="true"] {
      box-shadow: 0 34px 90px rgba(0,0,0,0.5);
    }
    .album-card button {
      position: relative;
      z-index: 1;
      display: block;
      width: 100%;
      height: 100%;
      padding: 0;
      border: 0;
      border-radius: inherit;
      color: inherit;
      text-align: left;
      background: transparent;
    }
    .album-card button:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
    .album-cover {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      border: 0;
      border-radius: inherit;
      background:
        linear-gradient(135deg, rgba(169, 140, 255, 0.78), rgba(255, 140, 175, 0.72) 46%, rgba(155, 232, 244, 0.58)),
        linear-gradient(45deg, rgba(255,255,255,0.14) 0 10%, transparent 10% 20%, rgba(255,255,255,0.12) 20% 30%, transparent 30% 100%),
        #20242d;
      box-shadow: none;
    }
    .album-cover::before {
      content: "";
      position: absolute;
      inset: 0;
      z-index: 2;
      pointer-events: none;
      background:
        linear-gradient(145deg, rgba(255,255,255,0.22), transparent 28%),
        linear-gradient(315deg, transparent 58%, rgba(255,255,255,0.14));
      mix-blend-mode: screen;
    }
    .album-cover::after {
      content: "";
      position: absolute;
      inset: 0;
      z-index: 3;
      pointer-events: none;
      border-radius: inherit;
      background: linear-gradient(180deg, transparent 42%, rgba(0,0,0,0.2) 56%, rgba(0,0,0,0.76) 100%);
    }
    .album-cover img {
      position: relative;
      z-index: 1;
      user-select: none;
      -webkit-user-drag: none;
    }
    .album-copy {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 2;
      min-height: 54px;
      margin: 0;
      padding: 9px 11px 34px;
      border: 0;
      border-radius: 0;
      background: rgba(0, 0, 0, 0.74);
      backdrop-filter: none;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
    }
    .album-card[data-focused="true"] .album-copy,
    .album-card[data-spotlight="true"] .album-copy {
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(7px) saturate(1.05);
    }
    .album-copy strong, .album-copy span {
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
    }
    .album-copy strong {
      -webkit-line-clamp: 2;
      padding-right: 26px;
      color: var(--text);
      font-size: 12px;
      font-weight: 600;
      line-height: 1.26;
      text-shadow: 0 2px 12px rgba(0,0,0,0.5);
    }
    .album-copy span {
      margin-top: 3px;
      -webkit-line-clamp: 1;
      color: rgba(255, 255, 255, 0.6);
      font-size: 10px;
      line-height: 1.28;
    }
    .album-more {
      position: absolute;
      top: 8px;
      right: 8px;
      display: grid;
      width: 22px;
      height: 22px;
      place-items: center;
      border: 0;
      border-radius: 999px;
      color: rgba(255,255,255,0.5);
      background: transparent;
      font-style: normal;
      font-size: 10px;
      font-weight: 900;
      cursor: pointer;
      pointer-events: auto;
    }
    .album-track-count {
      display: none;
    }
    .album-mini-controls {
      position: absolute;
      left: 10px;
      right: 10px;
      bottom: 8px;
      z-index: 4;
      display: grid;
      grid-template-columns: 1fr 1.18fr 1fr 1fr;
      align-items: center;
      justify-items: center;
      gap: 3px;
      margin-top: 0;
    }
    .album-mini-controls i,
    .album-mini-controls em {
      position: relative;
      display: grid;
      width: 100%;
      max-width: 24px;
      height: 23px;
      place-items: center;
      border: 0;
      border-radius: 999px;
      color: rgba(255, 255, 255, 0.78);
      background: transparent;
      font-style: normal;
      font-size: 0;
      font-weight: 900;
    }
    .album-mini-controls i {
      width: 27px;
      max-width: 27px;
      height: 27px;
      color: rgba(255, 255, 255, 0.9);
      border-color: transparent;
      background: rgba(255,255,255,0.15);
      pointer-events: auto;
      box-shadow: 0 7px 16px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.07);
      font-size: 0;
      transform: translateY(-1px);
    }
    .album-mini-controls em::before,
    .album-mini-controls em::after,
    .album-mini-controls i::before {
      content: "";
      display: block;
      box-sizing: border-box;
    }
    .album-prev::before,
    .album-next::before {
      width: 0;
      height: 0;
      border-top: 5px solid transparent;
      border-bottom: 5px solid transparent;
      opacity: 0.9;
    }
    .album-prev::before {
      border-right: 7px solid currentColor;
      transform: translateX(2px);
    }
    .album-next::before {
      border-left: 7px solid currentColor;
      transform: translateX(-2px);
    }
    .album-prev::after,
    .album-next::after {
      position: absolute;
      width: 2px;
      height: 11px;
      border-radius: 2px;
      background: currentColor;
      opacity: 0.85;
    }
    .album-prev::after {
      left: 8px;
    }
    .album-next::after {
      right: 8px;
    }
    .album-play-hit::before {
      width: 0;
      height: 0;
      margin-left: 2px;
      border-top: 6px solid transparent;
      border-bottom: 6px solid transparent;
      border-left: 9px solid currentColor;
    }
    .album-heart::before {
      width: 12px;
      height: 12px;
      border-right: 2px solid currentColor;
      border-bottom: 2px solid currentColor;
      border-radius: 2px;
      opacity: 0.82;
      transform: translateY(-1px) rotate(45deg);
    }
    .album-heart::after {
      position: absolute;
      width: 7px;
      height: 7px;
      border-radius: 999px;
      box-shadow: -3px 2px 0 0 currentColor, 2px -3px 0 0 currentColor;
      opacity: 0.82;
      transform: rotate(45deg);
    }
    .album-mini-controls em {
      pointer-events: none;
    }
    .album-play-hit {
      cursor: pointer;
    }
    .album-play-hit:hover {
      color: rgba(255,255,255,0.96);
      background: rgba(255,255,255,0.25);
    }
    .album-card[data-busy="true"] .album-mini-controls i {
      color: transparent;
      background:
        radial-gradient(circle at center, transparent 44%, #071210 46%, #071210 54%, transparent 56%),
        rgba(155, 232, 244, 0.94);
    }
    .stage[data-moving="true"] .album-card,
    .stage[data-dragging="true"] .album-card {
      transition: none;
      will-change: transform;
      filter: none;
      box-shadow: 0 8px 22px rgba(0,0,0,0.24);
    }
    .stage[data-moving="true"] .album-card[data-spotlight="true"],
    .stage[data-dragging="true"] .album-card[data-spotlight="true"] {
      box-shadow: 0 28px 72px rgba(0,0,0,0.42), 0 0 0 1px rgba(255,255,255,0.1);
    }
    .stage[data-moving="true"] .album-card::before,
    .stage[data-moving="true"] .album-card::after,
    .stage[data-dragging="true"] .album-card::before,
    .stage[data-dragging="true"] .album-card::after {
      opacity: 0.12;
    }
    .stage[data-moving="true"] .album-copy,
    .stage[data-dragging="true"] .album-copy {
      background: rgba(0,0,0,0.76);
      backdrop-filter: none;
    }
    .stage[data-moving="true"] .album-mural,
    .stage[data-dragging="true"] .album-mural {
      filter: none;
    }
    .album-detail {
      position: fixed;
      inset: auto clamp(14px, 3vw, 34px) clamp(14px, 3vw, 34px) auto;
      z-index: 12;
      display: none;
      grid-template-columns: 92px minmax(0, 300px);
      gap: 12px;
      max-width: min(92vw, 480px);
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(20, 23, 30, 0.94);
      box-shadow: 0 24px 60px rgba(0,0,0,0.4);
      backdrop-filter: blur(18px);
    }
    .album-detail[data-open="true"] { display: grid; }
    .album-detail .cover {
      width: 92px;
      height: 92px;
      overflow: hidden;
      border-radius: 8px;
      background: #20242d;
    }
    .album-detail h3 {
      margin: 2px 0 4px;
      font-size: 18px;
      line-height: 1.16;
    }
    .album-detail p {
      margin: 0 0 10px;
      color: var(--muted);
      line-height: 1.35;
    }
    .album-detail .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .track-list {
      display: grid;
      gap: 4px;
      grid-column: 1 / -1;
      max-height: 214px;
      overflow: auto;
      padding-top: 4px;
    }
    .track-row {
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr);
      gap: 8px;
      align-items: center;
      width: 100%;
      min-height: 32px;
      padding: 0 8px;
      color: var(--text);
      text-align: left;
      background: rgba(255,255,255,0.05);
    }
    .track-row span {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .track-row i {
      color: var(--muted);
      font-style: normal;
      font-size: 11px;
      font-weight: 800;
    }
    .track-row:hover,
    .track-row:focus-visible {
      border-color: rgba(143, 225, 209, 0.58);
      background: rgba(143, 225, 209, 0.1);
      outline: 0;
    }
    .empty-sea {
      position: absolute;
      left: 50%;
      top: 50%;
      width: min(84vw, 320px);
      padding: 16px 18px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: var(--muted);
      text-align: center;
      background: rgba(20, 23, 30, 0.82);
      transform: translate(-50%, -50%);
      backdrop-filter: blur(18px);
    }
    .toast {
      position: fixed;
      left: 50%;
      bottom: 18px;
      z-index: 20;
      display: none;
      max-width: min(88vw, 520px);
      padding: 10px 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: var(--text);
      background: rgba(20, 23, 30, 0.94);
      transform: translateX(-50%);
    }
    .toast[data-open="true"] { display: block; }
    @media (max-width: 760px) {
      .topbar {
        left: 12px;
        right: 12px;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        padding: 8px;
      }
      .brand small {
        font-size: 10px;
      }
      .brand strong {
        overflow: hidden;
        font-size: 20px;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .beta-badge {
        min-height: 18px;
        padding: 0 7px;
        font-size: 10px;
      }
      .controls {
        flex-wrap: nowrap;
        justify-content: flex-end;
        gap: 6px;
      }
      .controls button {
        flex: 0 0 32px;
        width: 32px;
        min-height: 32px;
        padding: 0;
        font-size: 15px;
      }
      .sea-head {
        top: 86px;
        left: auto;
        right: 12px;
        grid-template-columns: auto;
        max-width: max-content;
        padding: 6px;
      }
      .sea-head div {
        display: none;
      }
      .sea-head button {
        min-height: 30px;
        padding: 0 12px;
        font-size: 12px;
      }
      .now {
        left: 12px;
        right: 12px;
        bottom: 12px;
        grid-template-columns: 58px minmax(0, 1fr);
        gap: 10px;
        max-width: none;
        padding: 8px;
      }
      .now-art {
        width: 58px;
        height: 58px;
      }
      .now h1 {
        overflow: hidden;
        font-size: 20px;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .now p {
        overflow: hidden;
        font-size: 13px;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .now .search {
        display: none;
      }
      .progress {
        height: 5px;
      }
      .album-card {
        width: var(--card-w, 132px);
      }
      .album-copy {
        min-height: 52px;
        padding: 8px 9px 32px;
      }
      .album-copy strong {
        font-size: 11.5px;
      }
      .album-copy span {
        font-size: 10px;
      }
      .album-mini-controls {
        left: 10px;
        right: 10px;
        bottom: 7px;
      }
      .album-mini-controls i,
      .album-mini-controls em {
        max-width: 22px;
        height: 22px;
      }
      .album-mini-controls i {
        width: 25px;
        max-width: 25px;
        height: 25px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .album-card {
        transition: none;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <small>ECHO Web Control</small>
        <strong>Album Sea <span class="beta-badge">测试版</span></strong>
      </div>
      <div class="controls" aria-label="Playback controls">
        <button id="prevBtn" type="button" aria-label="上一首" title="上一首">&#9198;</button>
        <button id="playBtn" class="primary" type="button" aria-label="播放/暂停" title="播放/暂停">&#9654;</button>
        <button id="nextBtn" type="button" aria-label="下一首" title="下一首">&#9197;</button>
        <button id="stopBtn" type="button" aria-label="停止" title="停止">&#9632;</button>
      </div>
    </header>
    <main class="stage">
      <div class="custom-background" id="customBackground" aria-hidden="true"></div>
      <div class="album-mural" id="albumMural" aria-hidden="true"></div>
      <aside class="now">
        <div class="now-art"><img id="nowArt" alt="" hidden></div>
        <div>
          <small id="stateLabel">连接中</small>
          <h1 id="nowTitle">ECHO</h1>
          <p id="nowMeta">等待桌面端播放</p>
        </div>
        <div class="progress-row">
          <div class="progress"><span id="progressFill"></span></div>
          <p id="timeLabel">0:00 / 0:00</p>
        </div>
        <form class="search" id="searchForm">
          <input id="searchInput" type="search" placeholder="搜索专辑 / 艺人">
          <button type="submit">搜索</button>
        </form>
      </aside>
      <section>
        <div class="sea-head">
          <div>
            <h2>专辑海</h2>
            <small id="albumCount">载入中</small>
          </div>
          <button id="refreshAlbums" type="button">换一批</button>
        </div>
        <div class="sea-viewport" id="seaViewport">
          <div class="album-sea" id="albumSea" aria-live="polite"></div>
        </div>
      </section>
    </main>
  </div>
  <section class="album-detail" id="albumDetail" aria-live="polite"></section>
  <div class="toast" id="toast"></div>
  <script>
    const TOKEN = ${JSON.stringify(token)};
    const authHeaders = { Authorization: 'Bearer ' + TOKEN, 'X-ECHO-Link-Version': '1' };
    const world = { width: 3600, height: 2400 };
    const layout = { cols: 1, rows: 1, cellW: 156, cellH: 212 };
    const state = {
      albums: [],
      selectedAlbum: null,
      selectedTracks: [],
      query: '',
      randomSeed: 0,
      panX: -1800,
      panY: -1200,
      drag: null,
      dragMoved: false,
      suppressClickUntil: 0,
      lastTap: null,
      velocityX: 0,
      velocityY: 0,
      momentumFrame: 0,
      panFrame: 0,
      wheelIdleTimer: 0,
      clickTimer: 0,
      playingAlbumId: null,
      commandBusy: 0,
      albumRequestId: 0,
      nowAlbumTitle: '',
      nowAlbumArtist: '',
      albumTracks: new Map(),
      renderedCards: [],
      statusBusy: false,
      focusClientX: window.innerWidth / 2,
      focusClientY: window.innerHeight / 2,
      webBackground: { type: 'none', url: '' },
    };
    const $ = (id) => document.getElementById(id);
    const stage = document.querySelector('.stage');
    const maxRenderedAlbums = window.innerWidth >= 1700 ? 132 : 100;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const fmt = (ms) => {
      const safe = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
      return Math.floor(safe / 60) + ':' + String(safe % 60).padStart(2, '0');
    };
    const toast = (message) => {
      const el = $('toast');
      el.textContent = message;
      el.dataset.open = 'true';
      window.clearTimeout(toast.timer);
      toast.timer = window.setTimeout(() => { el.dataset.open = 'false'; }, 1800);
    };
    const clearClickTimer = () => {
      if (state.clickTimer) {
        window.clearTimeout(state.clickTimer);
        state.clickTimer = 0;
      }
    };
    const cardFromPoint = (x, y) => {
      const target = document.elementFromPoint(x, y);
      const card = target?.closest?.('.album-card');
      if (card) {
        return card;
      }
      let bestCard = null;
      let bestScore = -Infinity;
      document.querySelectorAll('.album-card').forEach((candidate) => {
        const rect = candidate.getBoundingClientRect();
        const hitPad = 8;
        if (x < rect.left - hitPad || x > rect.right + hitPad || y < rect.top - hitPad || y > rect.bottom + hitPad) {
          return;
        }
        const style = getComputedStyle(candidate);
        const opacity = Number(style.opacity || '0');
        if (opacity <= 0.08 || style.pointerEvents === 'none') {
          return;
        }
        const centerDistance = Math.hypot(x - rect.left - rect.width / 2, y - rect.top - rect.height / 2);
        const z = Number(style.zIndex || '0');
        const score = z + opacity * 80 - centerDistance * 0.02;
        if (score > bestScore) {
          bestScore = score;
          bestCard = candidate;
        }
      });
      return bestCard;
    };
    const albumFromPoint = (x, y) => {
      const card = cardFromPoint(x, y);
      return card ? state.albums.find((album) => album.id === card.dataset.albumId) || null : null;
    };
    const playHitFromPoint = (x, y) => {
      const direct = document.elementFromPoint(x, y)?.closest?.('.album-play-hit');
      if (direct) {
        return direct;
      }
      const card = cardFromPoint(x, y);
      const playHit = card?.querySelector?.('.album-play-hit') || null;
      if (!playHit) {
        return null;
      }
      const rect = playHit.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom ? playHit : null;
    };
    const handleAlbumTap = (album, x, y) => {
      const now = Date.now();
      const last = state.lastTap;
      const repeat = last && last.albumId === album.id && now - last.at < 340 && Math.abs(x - last.x) + Math.abs(y - last.y) < 28;
      clearClickTimer();
      if (repeat) {
        state.lastTap = null;
        playAlbum(album).catch((error) => toast(error.message));
        return;
      }
      state.lastTap = { albumId: album.id, at: now, x, y };
      state.clickTimer = window.setTimeout(() => {
        state.clickTimer = 0;
        playAlbum(album).catch((error) => toast(error.message));
      }, 120);
    };
    const setAlbumBusy = (albumId, busy) => {
      document.querySelectorAll('.album-card').forEach((card) => {
        if (card.dataset.albumId === albumId) {
          card.dataset.busy = busy ? 'true' : 'false';
        }
      });
    };
    const syncSelectedAlbum = () => {
      document.querySelectorAll('.album-card').forEach((card) => {
        card.dataset.selected = state.selectedAlbum && card.dataset.albumId === state.selectedAlbum.id ? 'true' : 'false';
      });
    };
    const normalizeKey = (value) => String(value || '').trim().toLowerCase();
    const syncNowPlayingAlbum = () => {
      document.querySelectorAll('.album-card').forEach((card) => {
        const title = normalizeKey(card.dataset.albumTitle);
        const artist = normalizeKey(card.dataset.albumArtist);
        const sameTitle = title && title === normalizeKey(state.nowAlbumTitle);
        const sameArtist = !state.nowAlbumArtist || !artist || artist === normalizeKey(state.nowAlbumArtist);
        card.dataset.now = sameTitle && sameArtist ? 'true' : 'false';
      });
    };
    const setCommandBusy = (busy) => {
      document.querySelectorAll('.controls button, #playAlbumBtn').forEach((button) => {
        button.disabled = busy;
      });
    };
    const api = async (path, options = {}) => {
      const response = await fetch(path, {
        ...options,
        headers: { ...authHeaders, ...(options.headers || {}) },
      });
      if (!response.ok) {
        throw new Error((await response.json().catch(() => ({}))).message || 'HTTP ' + response.status);
      }
      return response.json();
    };
    const clearWebBackground = () => {
      const el = $('customBackground');
      el.replaceChildren();
      delete el.dataset.active;
      state.webBackground = { type: 'none', url: '' };
      if (stage) {
        delete stage.dataset.customBackground;
      }
    };
    const applyWebBackground = (background) => {
      const type = background?.type === 'video' ? 'video' : background?.type === 'image' ? 'image' : 'none';
      const url = typeof background?.url === 'string' ? background.url.trim() : '';
      const el = $('customBackground');
      const alreadyActive = state.webBackground.type === type && state.webBackground.url === url && (type === 'none' || el.dataset.active === 'true');
      if (alreadyActive) {
        return;
      }
      state.webBackground = { type, url };
      if (type === 'none' || !url) {
        clearWebBackground();
        return;
      }

      const media = document.createElement(type === 'video' ? 'video' : 'img');
      media.src = url;
      media.addEventListener('error', () => {
        clearWebBackground();
        toast('背景加载失败');
      }, { once: true });
      if (type === 'video') {
        media.muted = true;
        media.autoplay = true;
        media.loop = true;
        media.playsInline = true;
        media.preload = 'auto';
        media.setAttribute('playsinline', '');
      } else {
        media.alt = '';
      }
      el.replaceChildren(media);
      el.dataset.active = 'true';
      if (stage) {
        stage.dataset.customBackground = 'true';
      }
      if (type === 'video') {
        media.play?.().catch(() => undefined);
      }
    };
    const loadSettings = async () => {
      try {
        const settings = await api('/echo-link/v1/settings');
        applyWebBackground(settings.webBackground);
      } catch {
        clearWebBackground();
      }
    };
    const command = async (body) => {
      state.commandBusy += 1;
      setCommandBusy(true);
      try {
        await api('/echo-link/v1/playback/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        await loadStatus();
        window.setTimeout(loadStatus, 350);
        window.setTimeout(loadStatus, 900);
        window.setTimeout(loadStatus, 1600);
      } finally {
        state.commandBusy = Math.max(0, state.commandBusy - 1);
        setCommandBusy(state.commandBusy > 0);
      }
    };
    const loadStatus = async () => {
      if (state.statusBusy) {
        return;
      }
      state.statusBusy = true;
      try {
        const { playback } = await api('/echo-link/v1/status');
        const track = playback.track;
        $('stateLabel').textContent = playback.state + ' · ' + playback.outputMode;
        $('nowTitle').textContent = track?.title || 'ECHO';
        $('nowMeta').textContent = track ? [track.artist, track.album].filter(Boolean).join(' · ') : '等待桌面端播放';
        state.nowAlbumTitle = track?.album || '';
        state.nowAlbumArtist = track?.albumArtist || track?.artist || '';
        syncNowPlayingAlbum();
        $('timeLabel').textContent = fmt(playback.positionMs) + ' / ' + fmt(playback.durationMs);
        $('progressFill').style.width = playback.durationMs > 0 ? Math.min(100, playback.positionMs / playback.durationMs * 100) + '%' : '0%';
        if (track?.artworkUrl) {
          $('nowArt').src = track.artworkUrl;
          $('nowArt').hidden = false;
        } else {
          $('nowArt').hidden = true;
        }
      } catch (error) {
        $('stateLabel').textContent = '连接失败';
        $('nowMeta').textContent = error.message;
        state.nowAlbumTitle = '';
        state.nowAlbumArtist = '';
        syncNowPlayingAlbum();
      } finally {
        state.statusBusy = false;
      }
    };
    const previewNowPlaying = (album, track) => {
      state.nowAlbumTitle = album.title || track?.album || '';
      state.nowAlbumArtist = album.albumArtist || track?.albumArtist || track?.artist || '';
      syncNowPlayingAlbum();
      $('stateLabel').textContent = 'playing 路 pc';
      $('nowTitle').textContent = track?.title || album.title || 'Untitled Album';
      $('nowMeta').textContent = [track?.artist || album.albumArtist, album.title].filter(Boolean).join(' 路 ');
      if (track?.artworkUrl || album.artworkUrl) {
        $('nowArt').src = track?.artworkUrl || album.artworkUrl;
        $('nowArt').hidden = false;
      }
    };
    const applyPan = () => {
      $('albumSea').style.setProperty('--pan-x', state.panX + 'px');
      $('albumSea').style.setProperty('--pan-y', state.panY + 'px');
      updateAlbumFocus();
    };
    const requestPan = () => {
      if (state.panFrame) {
        return;
      }
      state.panFrame = window.requestAnimationFrame(() => {
        state.panFrame = 0;
        applyPan();
      });
    };
    const panBounds = () => ({
      minX: -world.width + window.innerWidth * 0.72,
      maxX: -window.innerWidth * 0.32,
      minY: -world.height + window.innerHeight * 0.72,
      maxY: -window.innerHeight * 0.32,
    });
    const limitValue = (value, min, max, elasticity = 0) => {
      if (value < min) {
        return elasticity > 0 ? min + (value - min) * elasticity : min;
      }
      if (value > max) {
        return elasticity > 0 ? max + (value - max) * elasticity : max;
      }
      return value;
    };
    const constrainPan = (x, y, elasticity = 0) => {
      const bounds = panBounds();
      return {
        x: limitValue(x, bounds.minX, bounds.maxX, elasticity),
        y: limitValue(y, bounds.minY, bounds.maxY, elasticity),
      };
    };
    const setFocusClientPoint = (x, y) => {
      state.focusClientX = clamp(x, 0, window.innerWidth);
      state.focusClientY = clamp(y, 0, window.innerHeight);
    };
    const focusWorldPoint = () => ({
      x: (window.innerWidth / 2 + (state.focusClientX - window.innerWidth / 2) * 0.24) - window.innerWidth / 2 - state.panX,
      y: (window.innerHeight / 2 + (state.focusClientY - window.innerHeight / 2) * 0.24) - window.innerHeight / 2 - state.panY,
    });
    const stopMomentum = () => {
      if (state.momentumFrame) {
        window.cancelAnimationFrame(state.momentumFrame);
        state.momentumFrame = 0;
      }
      if (state.panFrame) {
        window.cancelAnimationFrame(state.panFrame);
        state.panFrame = 0;
      }
      state.velocityX = 0;
      state.velocityY = 0;
      if (stage && !state.drag) {
        delete stage.dataset.moving;
      }
    };
    const startMomentum = () => {
      if (reduceMotion || Math.abs(state.velocityX) + Math.abs(state.velocityY) < 0.45) {
        stopMomentum();
        return;
      }
      if (stage) {
        stage.dataset.moving = 'true';
      }
      const step = () => {
        state.velocityX *= 0.948;
        state.velocityY *= 0.948;
        const nextX = state.panX + state.velocityX;
        const nextY = state.panY + state.velocityY;
        const constrained = constrainPan(nextX, nextY);
        if (constrained.x !== nextX) {
          state.velocityX *= 0.2;
        }
        if (constrained.y !== nextY) {
          state.velocityY *= 0.2;
        }
        state.panX = constrained.x;
        state.panY = constrained.y;
        applyPan();
        if (Math.abs(state.velocityX) + Math.abs(state.velocityY) < 0.14) {
          stopMomentum();
          return;
        }
        state.momentumFrame = window.requestAnimationFrame(step);
      };
      state.momentumFrame = window.requestAnimationFrame(step);
    };
    const setCenteredPan = () => {
      state.panX = -Math.round(world.width / 2);
      state.panY = -Math.round(world.height / 2);
      const constrained = constrainPan(state.panX, state.panY);
      state.panX = constrained.x;
      state.panY = constrained.y;
    };
    const centerWorld = () => {
      setCenteredPan();
      applyPan();
    };
    const updateLayout = () => {
      const count = Math.max(1, Math.min(maxRenderedAlbums, state.albums.length));
      const wide = window.innerWidth >= 760;
      const aspect = Math.max(0.72, Math.min(2.2, window.innerWidth / Math.max(1, window.innerHeight)));
      layout.cellW = wide ? 204 : 144;
      layout.cellH = wide ? 286 : 204;
      layout.cols = wide
        ? Math.max(13, Math.ceil(Math.sqrt(count * aspect * 1.18)))
        : Math.max(8, Math.ceil(Math.sqrt(count * aspect * 0.8)));
      layout.rows = Math.max(wide ? 5 : 6, Math.ceil(count / layout.cols));
      world.width = Math.max(Math.ceil(window.innerWidth * 1.16), layout.cols * layout.cellW + 150);
      world.height = Math.max(Math.ceil(window.innerHeight * 1.16), layout.rows * layout.cellH + 150);
      const sea = $('albumSea');
      sea.style.width = world.width + 'px';
      sea.style.height = world.height + 'px';
    };
    const seeded = (index, salt) => {
      const raw = Math.sin((index + 1) * 9283.123 + state.randomSeed * 31 + salt * 97) * 10000;
      return raw - Math.floor(raw);
    };
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const greatestCommonDivisor = (a, b) => {
      let left = Math.abs(a);
      let right = Math.abs(b);
      while (right) {
        const next = left % right;
        left = right;
        right = next;
      }
      return left || 1;
    };
    const albumSlotStride = (slotCount) => {
      let stride = Math.max(3, layout.cols * 2 + 1);
      if (stride % 2 === 0) {
        stride += 1;
      }
      while (stride < slotCount && greatestCommonDivisor(stride, slotCount) !== 1) {
        stride += 2;
      }
      return stride;
    };
    const readStyleNumber = (card, name, fallback = 0) => {
      const value = Number.parseFloat(card.style.getPropertyValue(name));
      return Number.isFinite(value) ? value : fallback;
    };
    const createAlbumPlan = (card, index) => {
      const w = readStyleNumber(card, '--card-w', 120);
      const ratio = readStyleNumber(card, '--card-ratio', 1.42);
      const scale = readStyleNumber(card, '--card-scale', 1);
      const layer = card.dataset.layer || 'back';
      const x = readStyleNumber(card, '--card-x', 0);
      const y = readStyleNumber(card, '--card-y', 0);
      const wide = window.innerWidth >= 760;
      const reserveRadius = Math.max(280, Math.min(window.innerWidth, window.innerHeight) * (wide ? 0.54 : 0.62));
      const reserveFocusX = -state.panX;
      const reserveFocusY = -state.panY;
      const reserveNear = 1 - clamp(Math.hypot(x + w / 2 - reserveFocusX, y + (w * ratio) / 2 - reserveFocusY) / reserveRadius, 0, 1);
      const reserveFocus = reserveNear * reserveNear * (3 - 2 * reserveNear);
      const focusedScale = Math.min(1.38, scale * (1 + reserveFocus * 0.46 + (reserveFocus > 0.7 ? 0.1 : 0)));
      return {
        card,
        index,
        layer,
        x,
        y,
        w,
        h: w * ratio,
        ratio,
        baseScale: scale,
        baseOpacity: readStyleNumber(card, '--opacity', 1),
        baseBlur: readStyleNumber(card, '--card-blur', 0),
        baseZ: readStyleNumber(card, '--card-z', 1),
        baseBright: readStyleNumber(card, '--card-bright', 1),
        baseSat: readStyleNumber(card, '--card-sat', 1),
        basePitch: readStyleNumber(card, '--pitch', 0),
        baseYaw: readStyleNumber(card, '--yaw', 0),
        depthY: readStyleNumber(card, '--depth-y', 0),
        collisionScale: Math.max(scale, focusedScale),
      };
    };
    const applyAlbumPlan = (plan) => {
      plan.card.style.setProperty('--card-x', Math.round(plan.x) + 'px');
      plan.card.style.setProperty('--card-y', Math.round(plan.y) + 'px');
    };
    const setStyleVar = (element, name, value) => {
      if (element.style.getPropertyValue(name) !== value) {
        element.style.setProperty(name, value);
      }
    };
    const setPointerEvents = (element, value) => {
      if (element.style.pointerEvents !== value) {
        element.style.pointerEvents = value;
      }
    };
    const quantize = (value, step) => {
      return Math.round(value / step) * step;
    };
    const planCenterX = (plan) => plan.x + plan.w / 2;
    const planCenterY = (plan) => plan.y + plan.depthY + plan.h / 2;
    const settleAlbumPlan = (plan, placed) => {
      const gap = 14;
      const pad = 10;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        let moved = false;
        const width = plan.w * plan.collisionScale;
        const height = plan.h * plan.collisionScale;
        for (const other of placed) {
          const otherWidth = other.w * other.collisionScale;
          const otherHeight = other.h * other.collisionScale;
          const dx = planCenterX(plan) - planCenterX(other);
          const dy = planCenterY(plan) - planCenterY(other);
          const overlapX = (width + otherWidth) / 2 + gap - Math.abs(dx);
          const overlapY = (height + otherHeight) / 2 + gap - Math.abs(dy);
          if (overlapX <= 0 || overlapY <= 0) {
            continue;
          }
          const signX = dx === 0 ? (seeded(plan.index, 24) > 0.5 ? 1 : -1) : Math.sign(dx);
          const signY = dy === 0 ? (seeded(plan.index, 25) > 0.5 ? 1 : -1) : Math.sign(dy);
          if (overlapX < overlapY) {
            plan.x += signX * Math.min(overlapX, layout.cellW * 0.9);
          } else {
            plan.y += signY * Math.min(overlapY, layout.cellH * 0.9);
          }
          moved = true;
        }
        plan.x = clamp(plan.x, pad, world.width - plan.w - pad);
        plan.y = clamp(plan.y, pad, world.height - plan.h - pad);
        if (!moved) {
          break;
        }
      }
    };
    const relaxAlbumPlans = (plans) => {
      if (plans.length < 2) {
        return;
      }
      const pad = 10;
      const passes = window.innerWidth >= 760 ? 3 : 2;
      for (let pass = 0; pass < passes; pass += 1) {
        let moved = false;
        for (let i = 0; i < plans.length - 1; i += 1) {
          const a = plans[i];
          const aWidth = a.w * a.collisionScale;
          const aHeight = a.h * a.collisionScale;
          const aPinned = false;
          for (let j = i + 1; j < plans.length; j += 1) {
            const b = plans[j];
            const bWidth = b.w * b.collisionScale;
            const bHeight = b.h * b.collisionScale;
            const gap = 28;
            const dx = planCenterX(b) - planCenterX(a);
            const dy = planCenterY(b) - planCenterY(a);
            const overlapX = (aWidth + bWidth) / 2 + gap - Math.abs(dx);
            const overlapY = (aHeight + bHeight) / 2 + gap - Math.abs(dy);
            if (overlapX <= 0 || overlapY <= 0) {
              continue;
            }
            const signX = dx === 0 ? (seeded(b.index, 28) > 0.5 ? 1 : -1) : Math.sign(dx);
            const signY = dy === 0 ? (seeded(b.index, 29) > 0.5 ? 1 : -1) : Math.sign(dy);
            const bPinned = false;
            const aWeight = aPinned ? 0.18 : 0.56;
            const bWeight = bPinned ? 0.18 : 0.56;
            const total = aWeight + bWeight;
            const push = Math.min((overlapX < overlapY ? overlapX : overlapY) + 2, overlapX < overlapY ? layout.cellW * 0.46 : layout.cellH * 0.46);
            const aPush = (push * aWeight) / total;
            const bPush = (push * bWeight) / total;
            if (overlapX < overlapY) {
              a.x -= signX * aPush;
              b.x += signX * bPush;
            } else {
              a.y -= signY * aPush;
              b.y += signY * bPush;
            }
            a.x = clamp(a.x, pad, world.width - a.w - pad);
            a.y = clamp(a.y, pad, world.height - a.h - pad);
            b.x = clamp(b.x, pad, world.width - b.w - pad);
            b.y = clamp(b.y, pad, world.height - b.h - pad);
            moved = true;
          }
        }
        if (!moved) {
          break;
        }
      }
    };
    const planFocusInfo = (plan) => {
      const wide = window.innerWidth >= 760;
      const focusRadius = Math.max(330, Math.min(window.innerWidth, window.innerHeight) * (wide ? 0.52 : 0.6));
      const focusPoint = focusWorldPoint();
      const focusX = focusPoint.x;
      const focusY = focusPoint.y;
      const dx = plan.x + plan.w / 2 - focusX;
      const dy = plan.y + plan.h / 2 - focusY;
      const near = 1 - clamp(Math.hypot(dx, dy) / focusRadius, 0, 1);
      const focus = near * near * (3 - 2 * near);
      return {
        focus,
        scale: Math.min(1.34, plan.baseScale * (1 + focus * 0.5 + (focus > 0.7 ? 0.08 : 0))),
        focusY: -Math.round(focus * 28),
      };
    };
    const planVisualBox = (plan) => {
      const focusInfo = planFocusInfo(plan);
      const width = plan.w * focusInfo.scale;
      const height = plan.h * focusInfo.scale;
      const centerX = plan.x + plan.w / 2;
      const centerY = plan.y + plan.depthY + focusInfo.focusY + plan.h / 2;
      return {
        x: centerX - width / 2,
        y: centerY - height / 2,
        width,
        height,
      };
    };
    const resolveVisibleAlbumPlans = (plans) => {
      if (plans.length < 2) {
        return;
      }
      const pad = 10;
      for (let pass = 0; pass < 5; pass += 1) {
        let moved = false;
        for (let i = 0; i < plans.length - 1; i += 1) {
          const a = plans[i];
          const aBox = planVisualBox(a);
          const aPinned = false;
          for (let j = i + 1; j < plans.length; j += 1) {
            const b = plans[j];
            const bBox = planVisualBox(b);
            const gap = 28;
            const dx = (bBox.x + bBox.width / 2) - (aBox.x + aBox.width / 2);
            const dy = (bBox.y + bBox.height / 2) - (aBox.y + aBox.height / 2);
            const overlapX = (aBox.width + bBox.width) / 2 + gap - Math.abs(dx);
            const overlapY = (aBox.height + bBox.height) / 2 + gap - Math.abs(dy);
            if (overlapX <= 0 || overlapY <= 0) {
              continue;
            }
            const bPinned = false;
            const signX = dx === 0 ? (seeded(b.index, 34) > 0.5 ? 1 : -1) : Math.sign(dx);
            const signY = dy === 0 ? (seeded(b.index, 35) > 0.5 ? 1 : -1) : Math.sign(dy);
            const aWeight = aPinned ? 0.16 : 0.84;
            const bWeight = bPinned ? 0.16 : 0.84;
            const total = aWeight + bWeight;
            const push = Math.min((overlapX < overlapY ? overlapX : overlapY) + 2, overlapX < overlapY ? layout.cellW * 0.48 : layout.cellH * 0.48);
            const aPush = (push * aWeight) / total;
            const bPush = (push * bWeight) / total;
            if (overlapX < overlapY) {
              a.x -= signX * aPush;
              b.x += signX * bPush;
            } else {
              a.y -= signY * aPush;
              b.y += signY * bPush;
            }
            a.x = clamp(a.x, pad, world.width - a.w - pad);
            a.y = clamp(a.y, pad, world.height - a.h - pad);
            b.x = clamp(b.x, pad, world.width - b.w - pad);
            b.y = clamp(b.y, pad, world.height - b.h - pad);
            moved = true;
          }
        }
        if (!moved) {
          break;
        }
      }
    };
    const settleBackgroundAlbumPlans = (plans) => {
      const movable = plans.filter((plan) => plan.layer === 'back');
      if (!movable.length) {
        return;
      }
      const pad = 10;
      for (let pass = 0; pass < 5; pass += 1) {
        let moved = false;
        for (const plan of movable) {
          const width = plan.w * plan.collisionScale;
          const height = plan.h * plan.collisionScale;
          for (const other of plans) {
            if (plan === other) {
              continue;
            }
            const otherWidth = other.w * other.collisionScale;
            const otherHeight = other.h * other.collisionScale;
            const gap = 8;
            const dx = planCenterX(plan) - planCenterX(other);
            const dy = planCenterY(plan) - planCenterY(other);
            const overlapX = (width + otherWidth) / 2 + gap - Math.abs(dx);
            const overlapY = (height + otherHeight) / 2 + gap - Math.abs(dy);
            if (overlapX <= 0 || overlapY <= 0) {
              continue;
            }
            const signX = dx === 0 ? (seeded(plan.index, 32) > 0.5 ? 1 : -1) : Math.sign(dx);
            const signY = dy === 0 ? (seeded(plan.index, 33) > 0.5 ? 1 : -1) : Math.sign(dy);
            if (overlapX < overlapY) {
              plan.x += signX * Math.min(overlapX + 3, layout.cellW * 0.48);
            } else {
              plan.y += signY * Math.min(overlapY + 3, layout.cellH * 0.48);
            }
            plan.x = clamp(plan.x, pad, world.width - plan.w - pad);
            plan.y = clamp(plan.y, pad, world.height - plan.h - pad);
            moved = true;
          }
        }
        if (!moved) {
          break;
        }
      }
    };
    const updateAlbumFocus = () => {
      if (!state.renderedCards.length) {
        return;
      }
      const wide = window.innerWidth >= 760;
      const focusRadius = Math.max(330, Math.min(window.innerWidth, window.innerHeight) * (wide ? 0.52 : 0.6));
      const softRadius = focusRadius * 1.72;
      const focusPoint = focusWorldPoint();
      const focusX = focusPoint.x;
      const focusY = focusPoint.y;
      const viewPad = wide ? 420 : 260;
      const viewLeft = -state.panX - viewPad;
      const viewTop = -state.panY - viewPad;
      const viewRight = -state.panX + window.innerWidth + viewPad;
      const viewBottom = -state.panY + window.innerHeight + viewPad;
      const dragging = Boolean(state.drag);
      const moving = dragging || stage?.dataset.moving === 'true';
      const visible = [];
      for (const meta of state.renderedCards) {
        if (meta.x > viewRight || meta.x + meta.w < viewLeft || meta.y > viewBottom || meta.y + meta.h < viewTop) {
          if (meta.card.dataset.focused === 'true') {
            meta.card.dataset.focused = 'false';
          }
          if (meta.card.dataset.spotlight === 'true') {
            meta.card.dataset.spotlight = 'false';
          }
          setPointerEvents(meta.card, 'none');
          continue;
        }
        const dx = meta.x + meta.w / 2 - focusX;
        const dy = meta.y + meta.h / 2 - focusY;
        const distance = Math.hypot(dx, dy);
        const near = 1 - clamp(distance / focusRadius, 0, 1);
        const halo = 1 - clamp(distance / softRadius, 0, 1);
        const focus = near * near * (3 - 2 * near);
        visible.push({ meta, focus, halo, distance, dx, dy });
      }
      const spotlight = visible
        .filter((item) => item.focus > 0.18)
        .sort((a, b) => b.focus - a.focus)[0] ?? null;
      const updates = [];
      for (const item of visible) {
        const meta = item.meta;
        const focus = item.focus;
        const halo = item.halo;
        const isSpotlight = spotlight?.meta === meta;
        const spotlightBoost = isSpotlight ? (moving ? 0.04 : 0.035) : 0;
        const displayScale = Math.min(moving ? 1.18 : 1.2, meta.baseScale * (1 + focus * (moving ? 0.38 : 0.42) + spotlightBoost));
        const displayOpacity = clamp(meta.baseOpacity + halo * (1 - meta.baseOpacity) * 0.92 + focus * 0.08, 0.28, 1);
        const minBlur = moving ? 0 : (meta.layer === 'front' ? 0.18 : 0.25);
        const blurCeiling = moving ? 0 : Math.min(1.45, meta.baseBlur);
        const displayBlur = moving ? 0 : Math.min(blurCeiling, Math.max(minBlur, meta.baseBlur - focus * meta.baseBlur * 0.9));
        const displayZ = Math.round(meta.baseZ + focus * 320 + halo * 30 + (isSpotlight ? 230 : 0));
        const flatten = 1 - focus * 0.92;
        const repelDistance = Math.max(1, item.distance);
        const repel = moving ? halo * 28 * (1 - focus * 0.35) : 0;
        const repelX = Math.round((item.dx / repelDistance) * repel);
        const repelY = Math.round((item.dy / repelDistance) * repel * 0.5);
        const focusYOffset = -Math.round(focus * (isSpotlight ? 26 : 20)) + repelY;
        const boxW = meta.w * displayScale;
        const boxH = meta.h * displayScale;
        const boxCenterX = meta.x + meta.w / 2 + repelX;
        const boxCenterY = meta.y + meta.depthY + focusYOffset + meta.h / 2;
        updates.push({
          meta,
          focus,
          halo,
          isSpotlight,
          displayScale,
          displayOpacity,
          displayBlur,
          displayZ,
          flatten,
          repelX,
          focusYOffset,
          box: { x: boxCenterX - boxW / 2, y: boxCenterY - boxH / 2, width: boxW, height: boxH },
          pointerEvents: displayOpacity > 0.24 || focus > 0.04 ? 'auto' : 'none',
        });
      }
      const kept = [];
      for (const update of updates.slice().sort((a, b) => b.displayZ - a.displayZ)) {
        let occluded = false;
        if (!moving) {
          for (const other of kept) {
            const overlapX = Math.max(0, Math.min(update.box.x + update.box.width, other.box.x + other.box.width) - Math.max(update.box.x, other.box.x));
            const overlapY = Math.max(0, Math.min(update.box.y + update.box.height, other.box.y + other.box.height) - Math.max(update.box.y, other.box.y));
            const overlapArea = overlapX * overlapY;
            if (overlapArea <= 1) {
              continue;
            }
            const overlapRatio = overlapArea / Math.min(update.box.width * update.box.height, other.box.width * other.box.height);
            if (overlapRatio > 0.18 && update.focus < other.focus + 0.18) {
              occluded = true;
              break;
            }
          }
        }
        if (occluded) {
          update.displayOpacity = Math.min(update.displayOpacity, 0.07);
          update.pointerEvents = 'none';
          update.isSpotlight = false;
        } else {
          kept.push(update);
        }
      }
      for (const update of updates) {
        const meta = update.meta;
        setStyleVar(meta.card, '--display-scale', quantize(update.displayScale, 0.01).toFixed(2));
        setStyleVar(meta.card, '--display-opacity', quantize(update.displayOpacity, 0.01).toFixed(2));
        setStyleVar(meta.card, '--display-z', String(update.displayZ));
        setPointerEvents(meta.card, update.pointerEvents);
        setStyleVar(meta.card, '--focus-x', update.repelX + 'px');
        setStyleVar(meta.card, '--focus-y', update.focusYOffset + 'px');
        setStyleVar(meta.card, '--focus-z', Math.round(update.focus * (update.isSpotlight ? 190 : 145)) + 'px');
        setStyleVar(meta.card, '--display-pitch', quantize(update.isSpotlight ? 0 : meta.basePitch * update.flatten, 0.1).toFixed(1) + 'deg');
        setStyleVar(meta.card, '--display-yaw', quantize(update.isSpotlight ? 0 : meta.baseYaw * update.flatten, 0.1).toFixed(1) + 'deg');
        setStyleVar(meta.card, '--display-blur', quantize(update.displayBlur, 0.25).toFixed(2) + 'px');
        meta.card.dataset.focused = update.displayOpacity > 0.08 && update.focus > 0.52 ? 'true' : 'false';
        meta.card.dataset.spotlight = update.displayOpacity > 0.08 && update.isSpotlight ? 'true' : 'false';
      }
    };
    const renderMural = () => {
      const mural = $('albumMural');
      if (!mural) {
        return;
      }
      mural.innerHTML = '';
    };
    const albumStyle = (index) => {
      const wide = window.innerWidth >= 760;
      const depth = seeded(index, 10);
      const backIndex = index;
      const far = depth < 0.48;
      const baseSize = far ? (wide ? 122 : 80) : (wide ? 140 : 98);
      const size = Math.round(baseSize + seeded(index, 1) * (wide ? 26 : 18));
      const slotCount = Math.max(1, layout.cols * layout.rows);
      const slot = (backIndex * albumSlotStride(slotCount) + Math.floor((state.randomSeed % 997) / 997 * slotCount)) % slotCount;
      const col = slot % layout.cols;
      const row = Math.floor(slot / layout.cols);
      const originX = Math.round((world.width - layout.cols * layout.cellW) / 2 + (wide ? 8 : 6));
      const originY = Math.round((world.height - layout.rows * layout.cellH) / 2 + (wide ? 10 : 8));
      const rowStagger = (row % 2 === 1 ? layout.cellW * 0.22 : 0) + Math.sin(row * 0.67 + state.randomSeed * 0.05) * layout.cellW * 0.04;
      const columnLift = Math.cos(col * 0.73 + state.randomSeed * 0.04) * layout.cellH * 0.04;
      const waveX = Math.sin(row * 1.42 + col * 0.37 + state.randomSeed * 0.09) * layout.cellW * 0.05;
      const waveY = Math.cos(col * 1.18 + row * 0.29 + state.randomSeed * 0.07) * layout.cellH * 0.045;
      const jitterX = (seeded(index, 2) - 0.5) * Math.min(34, layout.cellW * 0.1);
      const jitterY = (seeded(index, 3) - 0.5) * Math.min(42, layout.cellH * 0.1);
      const rawX = originX + col * layout.cellW + rowStagger + waveX + jitterX;
      const rawY = originY + row * layout.cellH + columnLift + waveY + jitterY;
      const centerX = world.width / 2;
      const centerY = world.height / 2;
      const pull = far ? 0.96 + seeded(index, 17) * 0.03 : 0.92 + seeded(index, 17) * 0.04;
      const depthY = Math.round((seeded(index, 7) - 0.5) * (far ? 56 : 34));
      const depthZ = far ? -120 - Math.round(seeded(index, 13) * 88) : -24 - Math.round(seeded(index, 13) * 58);
      const perspectiveCompensation = 1 + Math.min(0.16, Math.abs(depthZ) / 1420 * 0.9);
      const x = Math.round(clamp(centerX + (rawX + size / 2 - centerX) * pull * perspectiveCompensation - size / 2, 8, world.width - size - 8));
      const y = Math.round(clamp(centerY + (rawY + size * 0.71 - centerY) * (pull + 0.02) * (1 + (perspectiveCompensation - 1) * 0.55) - size * 0.71, 8, world.height - size * 1.42 - 8));
      const tilt = (seeded(index, 4) - 0.5) * (far ? 6.4 : 4.2);
      const scale = far ? 0.58 + seeded(index, 6) * 0.18 : 0.72 + seeded(index, 6) * 0.2;
      const opacity = far ? 0.46 + seeded(index, 5) * 0.24 : 0.68 + seeded(index, 5) * 0.28;
      const z = far ? 18 + Math.round(seeded(index, 11) * 14) : 42 + Math.round(seeded(index, 11) * 26);
      const bright = far ? 0.9 : 1.02;
      const sat = far ? 0.98 : 1.07;
      const shadow = far ? 0.24 : 0.32;
      const sparkle = far ? 0.26 + seeded(index, 12) * 0.22 : 0.36 + seeded(index, 12) * 0.26;
      const pitch = far ? (seeded(index, 14) - 0.5) * 2.8 : (seeded(index, 14) - 0.5) * 1.4;
      const yaw = far ? (seeded(index, 16) - 0.5) * 3.6 : (seeded(index, 16) - 0.5) * 2;
      const ratio = far ? 1.32 : 1.34;
      const blur = far ? 1.2 : 0.65;
      return '--card-x:' + x + 'px;--card-y:' + y + 'px;--card-w:' + size + 'px;--card-ratio:' + ratio.toFixed(2) + ';--card-blur:' + blur + 'px;--tilt:' + tilt.toFixed(2) + 'deg;--opacity:' + opacity.toFixed(3) + ';--card-scale:' + scale.toFixed(3) + ';--depth-y:' + depthY + 'px;--depth-z:' + depthZ + 'px;--pitch:' + pitch.toFixed(2) + 'deg;--yaw:' + yaw.toFixed(2) + 'deg;--card-z:' + z + ';--card-bright:' + bright.toFixed(2) + ';--card-sat:' + sat.toFixed(2) + ';--card-shadow:' + shadow.toFixed(2) + ';--spark-scale:' + sparkle.toFixed(2);
    };
    const renderAlbums = () => {
      updateLayout();
      setCenteredPan();
      const sea = $('albumSea');
      sea.innerHTML = '';
      state.renderedCards = [];
      if (!state.albums.length) {
        sea.innerHTML = '<div class="empty-sea">没有找到专辑</div>';
        applyPan();
        return;
      }
      const renderedAlbums = state.albums.slice(0, maxRenderedAlbums);
      const placedCards = [];
      renderedAlbums.forEach((album, index) => {
        const card = document.createElement('article');
        card.className = 'album-card';
        card.dataset.albumId = album.id;
        card.dataset.albumTitle = album.title || '';
        card.dataset.albumArtist = album.albumArtist || '';
        card.dataset.layer = 'back';
        card.style.cssText = albumStyle(index);
        const plan = createAlbumPlan(card, index);
        settleAlbumPlan(plan, placedCards);
        placedCards.push(plan);
        state.renderedCards.push(plan);
        card.innerHTML =
          '<button type="button">' +
          '<div class="album-cover">' + (album.artworkUrl ? '<img alt="" loading="lazy" decoding="async" draggable="false" src="' + album.artworkUrl + '">' : '') + '</div>' +
          '<div class="album-copy"><strong></strong><span></span><em class="album-more" aria-hidden="true">...</em><div class="album-mini-controls"><b class="album-track-count"></b><em class="album-prev" aria-hidden="true"></em><i class="album-play-hit" role="button" tabindex="-1"></i><em class="album-next" aria-hidden="true"></em><em class="album-heart" aria-hidden="true"></em></div></div></button>';
        card.querySelector('strong').textContent = album.title || 'Untitled Album';
        card.querySelector('span').textContent = album.albumArtist || album.sourceLabel || '';
        card.querySelector('b').textContent = (album.trackCount || 0) + ' tracks';
        card.querySelector('button').setAttribute('aria-label', '打开 ' + (album.title || 'Untitled Album'));
        card.querySelector('button').title = album.title || 'Untitled Album';
        card.querySelector('img')?.addEventListener('error', (event) => {
          event.currentTarget.remove();
        });
        card.querySelector('.album-play-hit')?.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          clearClickTimer();
          playAlbum(album).catch((error) => toast(error.message));
        });
        card.querySelector('.album-more')?.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          clearClickTimer();
          selectAlbum(album).catch((error) => toast(error.message));
        });
        card.querySelector('button').addEventListener('click', (event) => {
          event.preventDefault();
          if (!state.dragMoved && Date.now() >= state.suppressClickUntil) {
            handleAlbumTap(album, event.clientX || 0, event.clientY || 0);
          }
        });
        card.addEventListener('dblclick', (event) => {
          event.preventDefault();
          event.stopPropagation();
          clearClickTimer();
          if (Date.now() < state.suppressClickUntil || state.playingAlbumId === album.id) {
            return;
          }
          playAlbum(album).catch((error) => toast(error.message));
        });
        sea.appendChild(card);
      });
      relaxAlbumPlans(placedCards);
      relaxAlbumPlans(placedCards);
      settleBackgroundAlbumPlans(placedCards);
      resolveVisibleAlbumPlans(placedCards);
      resolveVisibleAlbumPlans(placedCards);
      placedCards.forEach(applyAlbumPlan);
      syncSelectedAlbum();
      syncNowPlayingAlbum();
      applyPan();
    };
    const loadAlbums = async () => {
      stopMomentum();
      clearClickTimer();
      state.lastTap = null;
      const requestId = state.albumRequestId + 1;
      state.albumRequestId = requestId;
      $('albumCount').textContent = '载入中';
      const params = new URLSearchParams({ page: '1', pageSize: '500', sort: state.query ? 'default' : 'random' });
      if (state.query) params.set('q', state.query);
      const body = await api('/echo-link/v1/library/albums?' + params.toString());
      if (requestId !== state.albumRequestId) {
        return;
      }
      state.albums = body.albums || [];
      state.randomSeed = (state.randomSeed + 17) % 997;
      state.albumTracks.clear();
      state.selectedAlbum = null;
      state.selectedTracks = [];
      $('albumDetail').dataset.open = 'false';
      $('albumCount').textContent = body.totalCount + ' 张专辑';
      renderMural();
      renderAlbums();
    };
    const loadAlbumTracks = async (album) => {
      if (state.albumTracks.has(album.id)) {
        return state.albumTracks.get(album.id);
      }
      const pageSize = 500;
      const tracks = [];
      let page = 1;
      let totalCount = Number.POSITIVE_INFINITY;
      while (tracks.length < totalCount && page <= 8) {
        const body = await api('/echo-link/v1/library/albums/' + encodeURIComponent(album.id) + '/tracks?page=' + page + '&pageSize=' + pageSize);
        const batch = body.tracks || [];
        totalCount = Number.isFinite(body.totalCount) ? body.totalCount : tracks.length + batch.length;
        tracks.push(...batch);
        if (!batch.length || batch.length < pageSize) {
          break;
        }
        page += 1;
      }
      state.albumTracks.set(album.id, tracks);
      return tracks;
    };
    const renderTrackList = (album, tracks) => {
      const list = $('albumTrackList');
      if (!list) {
        return;
      }
      list.innerHTML = '';
      tracks.slice(0, 16).forEach((track, index) => {
        const row = document.createElement('button');
        row.className = 'track-row';
        row.type = 'button';
        row.innerHTML = '<i></i><span></span>';
        row.querySelector('i').textContent = String(index + 1).padStart(2, '0');
        row.querySelector('span').textContent = track.title || ('Track ' + (index + 1));
        row.addEventListener('click', (event) => {
          event.preventDefault();
          playAlbum(album, track.id).catch((error) => toast(error.message));
        });
        row.addEventListener('dblclick', (event) => {
          event.preventDefault();
          playAlbum(album, track.id).catch((error) => toast(error.message));
        });
        list.appendChild(row);
      });
      if (tracks.length > 16) {
        const more = document.createElement('button');
        more.className = 'track-row';
        more.type = 'button';
        more.innerHTML = '<i>···</i><span></span>';
        more.querySelector('span').textContent = tracks.length + ' tracks loaded';
        more.addEventListener('click', (event) => event.preventDefault());
        list.appendChild(more);
      }
    };
    const selectAlbum = async (album) => {
      state.selectedAlbum = album;
      state.selectedTracks = await loadAlbumTracks(album);
      syncSelectedAlbum();
      const detail = $('albumDetail');
      detail.dataset.open = 'true';
      detail.innerHTML =
        '<div class="cover">' + (album.artworkUrl ? '<img alt="" src="' + album.artworkUrl + '">' : '') + '</div>' +
        '<div><small>' + album.trackCount + ' tracks</small><h3></h3><p></p><div class="actions">' +
        '<button class="primary" id="playAlbumBtn" type="button">播放专辑</button>' +
        '<button id="closeAlbumBtn" type="button">收起</button></div></div><div class="track-list" id="albumTrackList"></div>';
      detail.querySelector('h3').textContent = album.title || 'Untitled Album';
      detail.querySelector('p').textContent = album.albumArtist || album.sourceLabel || '';
      detail.querySelector('img')?.addEventListener('error', (event) => {
        event.currentTarget.remove();
      });
      $('playAlbumBtn').addEventListener('click', playSelectedAlbum);
      $('closeAlbumBtn').addEventListener('click', () => { detail.dataset.open = 'false'; });
      renderTrackList(album, state.selectedTracks);
      setCommandBusy(state.commandBusy > 0);
    };
    const playAlbum = async (album, startTrackId = null) => {
      if (state.playingAlbumId === album.id) {
        return;
      }
      clearClickTimer();
      state.playingAlbumId = album.id;
      setAlbumBusy(album.id, true);
      try {
        const tracks = await loadAlbumTracks(album);
        const trackIds = tracks.map((track) => track.id);
        if (!trackIds.length) {
          toast('这张专辑没有可播放曲目');
          return;
        }
        const safeStartTrackId = startTrackId && trackIds.includes(startTrackId) ? startTrackId : trackIds[0];
        const startTrack = tracks.find((track) => track.id === safeStartTrackId) || tracks[0];
        previewNowPlaying(album, startTrack);
        await command({ command: 'queueReplace', trackIds, startTrackId: safeStartTrackId, output: 'pc' });
        state.selectedAlbum = album;
        state.selectedTracks = tracks;
        $('albumDetail').dataset.open = 'false';
        syncSelectedAlbum();
        toast('已切到 ' + (album.title || 'Untitled Album'));
      } finally {
        setAlbumBusy(album.id, false);
        state.playingAlbumId = null;
      }
    };
    const playSelectedAlbum = async () => {
      if (!state.selectedAlbum) {
        return;
      }
      await playAlbum(state.selectedAlbum);
    };
    $('playBtn').addEventListener('click', () => command({ command: 'playPause' }).catch((error) => toast(error.message)));
    $('stopBtn').addEventListener('click', () => command({ command: 'stop' }).catch((error) => toast(error.message)));
    $('nextBtn').addEventListener('click', () => command({ command: 'next' }).catch((error) => toast(error.message)));
    $('prevBtn').addEventListener('click', () => command({ command: 'previous' }).catch((error) => toast(error.message)));
    $('refreshAlbums').addEventListener('click', () => loadAlbums().catch((error) => toast(error.message)));
    $('searchForm').addEventListener('submit', (event) => {
      event.preventDefault();
      state.query = $('searchInput').value.trim();
      loadAlbums().catch((error) => toast(error.message));
    });
    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const tagName = target?.tagName ? target.tagName.toLowerCase() : '';
      const editing = tagName === 'input' || tagName === 'textarea' || target?.isContentEditable;
      if (editing || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        command({ command: 'playPause' }).catch((error) => toast(error.message));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        command({ command: 'previous' }).catch((error) => toast(error.message));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        command({ command: 'next' }).catch((error) => toast(error.message));
      } else if (event.key === 'Enter' && state.selectedAlbum) {
        event.preventDefault();
        playSelectedAlbum().catch((error) => toast(error.message));
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        loadAlbums().catch((error) => toast(error.message));
      } else if (event.key === 'Escape') {
        event.preventDefault();
        clearClickTimer();
        stopMomentum();
        $('albumDetail').dataset.open = 'false';
      }
    });
    $('seaViewport').addEventListener('pointerdown', (event) => {
      stopMomentum();
      clearClickTimer();
      state.drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        lastAt: performance.now(),
        panX: state.panX,
        panY: state.panY,
      };
      state.dragMoved = false;
      state.velocityX = 0;
      state.velocityY = 0;
      setFocusClientPoint(event.clientX, event.clientY);
      $('seaViewport').setPointerCapture(event.pointerId);
      if (stage) {
        stage.dataset.dragging = 'true';
        stage.dataset.moving = 'true';
      }
    });
    $('seaViewport').addEventListener('pointermove', (event) => {
      if (!state.drag || state.drag.pointerId !== event.pointerId) {
        return;
      }
      const dx = event.clientX - state.drag.startX;
      const dy = event.clientY - state.drag.startY;
      const now = performance.now();
      const frameMs = Math.max(8, now - state.drag.lastAt);
      state.velocityX = ((event.clientX - state.drag.lastX) / frameMs) * 16.67;
      state.velocityY = ((event.clientY - state.drag.lastY) / frameMs) * 16.67;
      state.drag.lastX = event.clientX;
      state.drag.lastY = event.clientY;
      state.drag.lastAt = now;
      setFocusClientPoint(event.clientX, event.clientY);
      state.dragMoved = state.dragMoved || Math.abs(dx) + Math.abs(dy) > 6;
      if (state.dragMoved) {
        state.suppressClickUntil = Date.now() + 180;
      }
      const constrained = constrainPan(state.drag.panX + dx, state.drag.panY + dy, 0);
      state.panX = constrained.x;
      state.panY = constrained.y;
      requestPan();
    });
    const finishDrag = (event) => {
      if (!state.drag || state.drag.pointerId !== event.pointerId) {
        return;
      }
      state.drag = null;
      try {
        $('seaViewport').releasePointerCapture?.(event.pointerId);
      } catch {
        // Pointer capture may already be gone after a browser gesture cancellation.
      }
      if (stage) {
        delete stage.dataset.dragging;
      }
      requestPan();
      if (state.dragMoved) {
        state.suppressClickUntil = Date.now() + 180;
        startMomentum();
      } else if (Date.now() >= state.suppressClickUntil) {
        const playHit = playHitFromPoint(event.clientX, event.clientY);
        const album = albumFromPoint(event.clientX, event.clientY);
        if (playHit && album) {
          clearClickTimer();
          playAlbum(album).catch((error) => toast(error.message));
          window.setTimeout(() => { state.dragMoved = false; }, 0);
          if (stage) {
            delete stage.dataset.moving;
          }
          return;
        }
        if (album) {
          handleAlbumTap(album, event.clientX, event.clientY);
        }
      }
      if (!state.dragMoved && stage) {
        delete stage.dataset.moving;
      }
      window.setTimeout(() => { state.dragMoved = false; }, 0);
    };
    $('seaViewport').addEventListener('pointerup', finishDrag);
    $('seaViewport').addEventListener('pointercancel', finishDrag);
    $('seaViewport').addEventListener('click', (event) => {
      if (event.target?.closest?.('.album-card') || state.dragMoved || Date.now() < state.suppressClickUntil) {
        return;
      }
      const album = albumFromPoint(event.clientX, event.clientY);
      if (album) {
        event.preventDefault();
        handleAlbumTap(album, event.clientX, event.clientY);
      }
    });
    $('seaViewport').addEventListener('wheel', (event) => {
      event.preventDefault();
      stopMomentum();
      clearClickTimer();
      const dx = event.shiftKey && Math.abs(event.deltaX) < Math.abs(event.deltaY) ? event.deltaY : event.deltaX;
      const dy = event.shiftKey ? 0 : event.deltaY;
      setFocusClientPoint(event.clientX, event.clientY);
      if (stage) {
        stage.dataset.moving = 'true';
      }
      const constrained = constrainPan(state.panX - dx, state.panY - dy, 0);
      state.panX = constrained.x;
      state.panY = constrained.y;
      requestPan();
      window.clearTimeout(state.wheelIdleTimer);
      state.wheelIdleTimer = window.setTimeout(() => {
        if (stage && !state.drag && !state.momentumFrame) {
          delete stage.dataset.moving;
          requestPan();
        }
      }, 120);
    }, { passive: false });
    $('seaViewport').addEventListener('dblclick', (event) => {
      const card = event.target.closest?.('.album-card');
      if (!card || Date.now() < state.suppressClickUntil) {
        return;
      }
      const album = state.albums.find((item) => item.id === card.dataset.albumId);
      if (album) {
        event.preventDefault();
        clearClickTimer();
        if (state.playingAlbumId !== album.id) {
          playAlbum(album).catch((error) => toast(error.message));
        }
      }
    });
    window.addEventListener('resize', () => {
      stopMomentum();
      setFocusClientPoint(window.innerWidth / 2, window.innerHeight / 2);
      renderMural();
      renderAlbums();
    });
    window.addEventListener('focus', () => {
      void loadSettings();
      void loadStatus();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        void loadSettings();
        void loadStatus();
      }
    });
    loadSettings();
    loadStatus();
    loadAlbums().catch((error) => toast(error.message));
    window.setInterval(() => {
      if (!document.hidden) {
        void loadStatus();
      }
    }, 650);
  </script>
</body>
</html>`;

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxJsonBodyBytes) {
      throw new HttpError(413, 'body_too_large');
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
};

const parseRange = (range: string | undefined, size: number): { start: number; end: number } | null => {
  if (!range) {
    return null;
  }

  const match = range.match(/^bytes=(\d*)-(\d*)$/u);
  if (!match || (!match[1] && !match[2])) {
    return null;
  }

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
};

export class EchoLinkService {
  private server: Server | null = null;
  private enabled = false;
  private error: string | null = null;
  private updatedAt = new Date(0).toISOString();
  private token = randomBytes(32).toString('base64url');
  private readonly mediaTokens = new Map<string, MediaTokenRecord>();
  private readonly artworkTokens = new Map<string, ArtworkTokenRecord>();
  private queueTrackIds: string[] = [];
  private currentQueueTrackId: string | null = null;
  private lastPhoneConnectionAt: string | null = null;
  private lastAuthFailureAt: string | null = null;
  private authFailureCount = 0;
  private lastMediaTokenServed: MediaServeSummary | null = null;
  private readonly recentHttpErrors: HttpErrorEvent[] = [];
  private webBackground: EchoLinkWebBackground = { ...defaultWebBackground };
  private webBackgroundAsset: WebBackgroundAssetRecord | null = null;
  private mdnsState: MdnsState = {
    state: 'disabled',
    serviceName: '_echo-link._tcp.local',
    error: null,
    advertisedAddresses: [],
  };
  private mdnsAdvertisers: Array<Pick<EchoLinkMdnsAdvertiser, 'start' | 'stop'>> = [];
  private readonly audioSession: AudioSessionLike;
  private readonly libraryService: LibraryServiceLike;
  private readonly lyricsService: LyricsServiceLike;
  private readonly dispatchPlaybackAction: (action: 'nextTrack' | 'previousTrack') => void;
  private readonly broadcastPlaybackQueueSession: (session: PersistedPlaybackSessionV1) => void;
  private readonly createMdnsAdvertiser: () => Pick<EchoLinkMdnsAdvertiser, 'start' | 'stop'>;
  private readonly getLanAddresses: () => string[];
  private readonly now: () => number;
  private readonly deviceId: string;
  private readonly deviceName: string;
  private readonly port: number;
  private boundPort: number | null = null;

  constructor(dependencies: EchoLinkServiceDependencies = {}) {
    this.audioSession = dependencies.audioSession ?? getAudioSession();
    this.libraryService = dependencies.libraryService ?? getLibraryService();
    this.lyricsService = dependencies.lyricsService ?? getLyricsService();
    this.dispatchPlaybackAction = dependencies.dispatchPlaybackAction ?? ((action) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send(IpcChannels.AppGlobalShortcutCommand, action);
        }
      }
    });
    this.broadcastPlaybackQueueSession = dependencies.broadcastPlaybackQueueSession ?? ((session) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send(IpcChannels.PlaybackQueueSessionChanged, session);
        }
      }
    });
    this.createMdnsAdvertiser = dependencies.createMdnsAdvertiser ?? (() => new EchoLinkMdnsAdvertiser());
    this.getLanAddresses = dependencies.getLanAddresses ?? listLanAddresses;
    this.now = dependencies.now ?? Date.now;
    this.deviceId = dependencies.deviceId ?? `pc-${randomBytes(8).toString('hex')}`;
    this.deviceName = dependencies.deviceName ?? defaultDeviceName;
    this.port = dependencies.port ?? defaultPort;
  }

  getServerStatus(): EchoLinkServerStatus {
    this.cleanupExpiredTokens();
    const addresses = this.getLanAddresses();
    const host = addresses[0] ?? '127.0.0.1';
    return {
      enabled: this.enabled,
      running: Boolean(this.server),
      port: this.boundPort ?? this.port,
      host,
      addresses,
      pairingUri: this.enabled && this.server ? this.createPairingUri(host) : null,
      webControlUrl: this.enabled && this.server ? this.createWebControlUrl(host) : null,
      token: this.token,
      deviceName: this.deviceName,
      deviceId: this.deviceId,
      webBackground: { ...this.webBackground },
      activeMediaTokens: this.mediaTokens.size,
      activeArtworkTokens: this.artworkTokens.size,
      mdns: {
        ...this.mdnsState,
        advertisedAddresses: [...this.mdnsState.advertisedAddresses],
      },
      diagnostics: {
        selectedLanAddress: host,
        lastPhoneConnectionAt: this.lastPhoneConnectionAt,
        lastAuthFailureAt: this.lastAuthFailureAt,
        authFailureCount: this.authFailureCount,
        lastMediaTokenServed: this.lastMediaTokenServed ? { ...this.lastMediaTokenServed } : null,
        recentHttpErrors: [...this.recentHttpErrors],
      },
      error: this.error,
      updatedAt: this.updatedAt,
    };
  }

  async setEnabled(enabled: boolean): Promise<EchoLinkServerStatus> {
    this.enabled = enabled;
    this.error = null;
    if (!enabled) {
      await this.close();
      this.touch();
      return this.getServerStatus();
    }

    try {
      await this.ensureStarted();
      await this.startMdnsAdvertisements();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.touch();
    return this.getServerStatus();
  }

  setWebBackground(value: unknown): EchoLinkServerStatus {
    const nextBackground = normalizeWebBackground(value);
    const currentAssetUrl = this.webBackgroundAsset ? `${internalWebBackgroundPathPrefix}${this.webBackgroundAsset.token}` : null;
    const usesInternalAsset = internalWebBackgroundUrlPattern.test(nextBackground.url);
    if (usesInternalAsset && nextBackground.url !== currentAssetUrl) {
      throw new HttpError(400, 'background_asset_not_available');
    }
    if (!usesInternalAsset) {
      this.webBackgroundAsset = null;
    }
    this.webBackground = nextBackground;
    this.touch();
    return this.getServerStatus();
  }

  setLocalWebBackgroundImage(filePath: unknown): EchoLinkServerStatus {
    const image = normalizeLocalWebBackgroundImage(filePath);
    const token = randomBytes(24).toString('base64url');
    this.webBackgroundAsset = {
      token,
      filePath: image.filePath,
      mimeType: image.mimeType,
    };
    this.webBackground = {
      type: 'image',
      url: `${internalWebBackgroundPathPrefix}${token}`,
    };
    this.touch();
    return this.getServerStatus();
  }

  async close(): Promise<void> {
    this.mediaTokens.clear();
    this.artworkTokens.clear();
    await this.stopMdnsAdvertisements();
    if (!this.server) {
      this.boundPort = null;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => (error ? reject(error) : resolve()));
    });
    this.server = null;
    this.boundPort = null;
  }

  rotateToken(): EchoLinkServerStatus {
    this.token = randomBytes(32).toString('base64url');
    this.mediaTokens.clear();
    this.artworkTokens.clear();
    this.authFailureCount = 0;
    this.lastAuthFailureAt = null;
    this.touch();
    return this.getServerStatus();
  }

  createPairingUri(host: string): string {
    const entries: Array<[string, string]> = [
      ['host', host],
      ['port', String(this.boundPort ?? this.port)],
      ['token', this.token],
      ['name', this.deviceName],
      ['scheme', 'http'],
    ];
    return `echo://pair?${entries.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`;
  }

  createWebControlUrl(host: string): string {
    const url = new URL(`http://${host}:${this.boundPort ?? this.port}/echo-link/web`);
    url.searchParams.set('token', this.token);
    return url.toString();
  }

  getStatusResponse(baseUrl?: string): EchoLinkStatusResponse {
    const audioStatus = this.audioSession.getStatus();
    this.syncQueueTrackFromAudioStatus(audioStatus);
    const track = this.resolveCurrentTrack(audioStatus);
    return {
      device: {
        id: this.deviceId,
        name: this.deviceName,
      },
      playback: this.createPlayback(audioStatus, track, baseUrl ?? this.defaultBaseUrl()),
    };
  }

  getSettingsResponse(): EchoLinkSettingsResponse {
    return {
      webBackground: { ...this.webBackground },
    };
  }

  getLibraryTracks(page: number, pageSize: number, query: string, baseUrl?: string): EchoLinkLibraryTracksResponse {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(maxLibraryPageSize, Math.max(1, Math.floor(pageSize)));
    const result = this.libraryService.getTracks({
      page: safePage,
      pageSize: safePageSize,
      search: query.trim() || undefined,
      sort: query.trim() ? 'default' : 'titleAsc',
      sourceProvider: 'local',
    });
    const urlBase = baseUrl ?? this.defaultBaseUrl();
    return {
      tracks: result.items.map((track) => this.toTrackPreview(track, urlBase)),
      totalCount: result.total,
    };
  }

  getLibraryAlbums(page: number, pageSize: number, query: string, sort: string, baseUrl?: string): EchoLinkLibraryAlbumsResponse {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(maxLibraryPageSize, Math.max(1, Math.floor(pageSize)));
    const result = this.libraryService.getAlbums({
      page: safePage,
      pageSize: safePageSize,
      search: query.trim() || undefined,
      sort: sort === 'random' ? 'random' : query.trim() ? 'default' : 'titleAsc',
      sourceProvider: 'local',
    });
    const urlBase = baseUrl ?? this.defaultBaseUrl();
    return {
      albums: result.items.map((album) => this.toAlbumPreview(album, urlBase)),
      totalCount: result.total,
    };
  }

  getLibraryAlbumTracks(albumId: string, page: number, pageSize: number, baseUrl?: string): EchoLinkLibraryAlbumTracksResponse {
    const album = this.requireAlbum(albumId);
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(maxLibraryPageSize, Math.max(1, Math.floor(pageSize)));
    const result = this.libraryService.getAlbumTracks(album.id, {
      page: safePage,
      pageSize: safePageSize,
    });
    const urlBase = baseUrl ?? this.defaultBaseUrl();
    return {
      album: this.toAlbumPreview(album, urlBase),
      tracks: result.items.map((track) => this.toTrackPreview(track, urlBase)),
      totalCount: result.total,
    };
  }

  createStream(trackId: string, baseUrl?: string): EchoLinkStreamResponse {
    const track = this.requireTrack(trackId);
    if ((track.mediaType ?? 'local') !== 'local' || !existsSync(track.path)) {
      throw new HttpError(409, 'track_not_streamable_to_phone');
    }
    if (!isAndroidFriendlyAudioPath(track.path)) {
      throw new HttpError(415, 'unsupported_format');
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAtEpochMs = this.now() + streamTokenTtlMs;
    this.mediaTokens.set(token, {
      filePath: track.path,
      mimeType: mimeTypeForAudioPath(track.path),
      expiresAtEpochMs,
    });
    this.cleanupExpiredTokens();
    const urlBase = baseUrl ?? this.defaultBaseUrl();
    return {
      streamUrl: `${urlBase}/echo-link/media/${token}`,
      expiresAtEpochMs,
      track: this.toTrackPreview(track, urlBase),
    };
  }

  async runPlaybackCommand(command: EchoLinkPlaybackCommand, baseUrl?: string): Promise<EchoLinkStatusResponse> {
    switch (command.command) {
      case 'playPause': {
        const status = this.audioSession.getStatus();
        if (status.state === 'playing' || status.state === 'loading') {
          await this.audioSession.pause();
        } else {
          await this.audioSession.play();
        }
        break;
      }
      case 'stop':
        this.audioSession.stop();
        break;
      case 'seekTo':
        await this.audioSession.seek(Math.max(0, Number(command.positionMs) || 0) / 1000);
        break;
      case 'setVolume':
        await this.audioSession.setOutput({ volume: Math.max(0, Math.min(1, Number(command.volume) || 0)) });
        break;
      case 'playTrack':
        this.queueTrackIds = [command.trackId];
        this.currentQueueTrackId = command.trackId;
        await this.playTrackOnPc(command.trackId);
        break;
      case 'handoff':
        this.queueTrackIds = [command.trackId];
        this.currentQueueTrackId = command.trackId;
        await this.playTrackOnPc(command.trackId, command.positionMs);
        break;
      case 'queueReplace': {
        this.replaceQueue(command.trackIds, command.startTrackId);
        const startTrackId = this.currentQueueTrackId;
        if (startTrackId) {
          await this.playTrackOnPc(startTrackId);
        }
        break;
      }
      case 'next':
        if (!(await this.playRelativeQueueTrack(1))) {
          this.dispatchPlaybackAction('nextTrack');
        }
        break;
      case 'previous':
        if (!(await this.playRelativeQueueTrack(-1))) {
          this.dispatchPlaybackAction('previousTrack');
        }
        break;
      default:
        throw new HttpError(400, 'unknown_command');
    }

    return this.getStatusResponse(baseUrl);
  }

  private async ensureStarted(): Promise<void> {
    if (this.server) {
      return;
    }

    const server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.port, '0.0.0.0', () => {
          const address = server.address();
          this.boundPort = address && typeof address !== 'string' ? address.port : this.port;
          server.off('error', reject);
          resolve();
        });
      });
    } catch (error) {
      this.server = null;
      this.boundPort = null;
      server.close();
      throw error;
    }
  }

  private async startMdnsAdvertisements(): Promise<void> {
    await this.stopMdnsAdvertisements(false);
    const addresses = this.getLanAddresses();
    if (!this.server || addresses.length === 0) {
      this.mdnsState = {
        state: 'error',
        serviceName: '_echo-link._tcp.local',
        error: 'no_lan_ipv4_address',
        advertisedAddresses: [],
      };
      return;
    }

    const advertisedAddresses: string[] = [];
    const errors: string[] = [];
    for (const address of addresses) {
      const advertiser = this.createMdnsAdvertiser();
      const advertisement: EchoLinkMdnsAdvertisement = {
        name: this.deviceName,
        deviceId: this.deviceId,
        address,
        port: this.boundPort ?? this.port,
        version: 1,
      };
      try {
        await advertiser.start(advertisement);
        this.mdnsAdvertisers.push(advertiser);
        advertisedAddresses.push(address);
      } catch (error) {
        errors.push(`${address}: ${error instanceof Error ? error.message : String(error)}`);
        await advertiser.stop(false).catch(() => undefined);
      }
    }

    this.mdnsState = {
      state: advertisedAddresses.length > 0 ? 'advertising' : 'error',
      serviceName: '_echo-link._tcp.local',
      error: advertisedAddresses.length > 0 ? null : errors.join('; ') || 'mdns_unavailable',
      advertisedAddresses,
    };
  }

  private async stopMdnsAdvertisements(goodbye = true): Promise<void> {
    const advertisers = this.mdnsAdvertisers;
    this.mdnsAdvertisers = [];
    await Promise.all(advertisers.map((advertiser) => advertiser.stop(goodbye).catch(() => undefined)));
    this.mdnsState = {
      state: 'disabled',
      serviceName: '_echo-link._tcp.local',
      error: null,
      advertisedAddresses: [],
    };
  }

  private touch(): void {
    this.updatedAt = new Date(this.now()).toISOString();
  }

  private defaultBaseUrl(): string {
    return `http://${this.getLanAddresses()[0] ?? '127.0.0.1'}:${this.boundPort ?? this.port}`;
  }

  private baseUrlForRequest(request: IncomingMessage): string {
    const host = safeHeader(request.headers.host) ?? `${this.getLanAddresses()[0] ?? '127.0.0.1'}:${this.boundPort ?? this.port}`;
    return `http://${host}`;
  }

  private cleanupExpiredTokens(): void {
    const now = this.now();
    for (const [token, record] of this.mediaTokens) {
      if (record.expiresAtEpochMs <= now) {
        this.mediaTokens.delete(token);
      }
    }
    for (const [token, record] of this.artworkTokens) {
      if (record.expiresAtEpochMs <= now) {
        this.artworkTokens.delete(token);
      }
    }
  }

  private isAuthorized(request: IncomingMessage): boolean {
    return safeHeader(request.headers.authorization) === `Bearer ${this.token}` &&
      safeHeader(request.headers['x-echo-link-version']) === linkVersion;
  }

  private recordPhoneConnection(): void {
    this.lastPhoneConnectionAt = new Date(this.now()).toISOString();
  }

  private recordAuthFailure(): void {
    this.authFailureCount += 1;
    this.lastAuthFailureAt = new Date(this.now()).toISOString();
  }

  private recordHttpError(path: string, statusCode: number, message: string): void {
    this.recentHttpErrors.unshift({
      at: new Date(this.now()).toISOString(),
      path,
      statusCode,
      message,
    });
    this.recentHttpErrors.splice(12);
  }

  private assertLanRequest(request: IncomingMessage): void {
    const remote = normalizeRemoteAddress(request.socket.remoteAddress);
    if (!isLanAddress(remote)) {
      throw new HttpError(403, 'lan_only');
    }
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      this.assertLanRequest(request);
      const url = new URL(request.url ?? '/', this.baseUrlForRequest(request));
      const path = url.pathname;

      if (path.startsWith('/echo-link/media/')) {
        await this.serveMediaToken(request, response, path.slice('/echo-link/media/'.length));
        return;
      }

      const artworkMatch = path.match(/^\/echo-link\/v1\/artwork\/([^/]+)$/u);
      if ((request.method === 'GET' || request.method === 'HEAD') && artworkMatch) {
        await this.serveArtworkToken(request, response, artworkMatch[1]);
        return;
      }

      const webBackgroundMatch = path.match(/^\/echo-link\/v1\/background\/([^/]+)$/u);
      if (webBackgroundMatch) {
        await this.serveWebBackgroundAsset(request, response, webBackgroundMatch[1]);
        return;
      }

      if (request.method === 'GET' && path === '/echo-link/web') {
        if (url.searchParams.get('token') !== this.token) {
          this.recordAuthFailure();
          writeError(response, 401, 'unauthorized');
          return;
        }
        this.recordPhoneConnection();
        writeHtml(response, createWebControlHtml(this.token));
        return;
      }

      if (!this.isAuthorized(request)) {
        this.recordAuthFailure();
        writeError(response, 401, 'unauthorized');
        return;
      }
      this.recordPhoneConnection();

      if (request.method === 'GET' && path === '/echo-link/v1/status') {
        writeJson(response, 200, this.getStatusResponse(this.baseUrlForRequest(request)));
        return;
      }

      if (request.method === 'GET' && path === '/echo-link/v1/settings') {
        writeJson(response, 200, this.getSettingsResponse());
        return;
      }

      if (request.method === 'POST' && path === '/echo-link/v1/playback/command') {
        const body = await readJsonBody(request);
        writeJson(response, 200, await this.runPlaybackCommand(this.normalizePlaybackCommand(body), this.baseUrlForRequest(request)));
        return;
      }

      if (request.method === 'GET' && path === '/echo-link/v1/library/tracks') {
        const page = Number(url.searchParams.get('page') ?? 1);
        const pageSize = Number(url.searchParams.get('pageSize') ?? 12);
        const query = url.searchParams.get('q') ?? '';
        writeJson(response, 200, this.getLibraryTracks(page, pageSize, query, this.baseUrlForRequest(request)));
        return;
      }

      if (request.method === 'GET' && path === '/echo-link/v1/library/albums') {
        const page = Number(url.searchParams.get('page') ?? 1);
        const pageSize = Number(url.searchParams.get('pageSize') ?? 72);
        const query = url.searchParams.get('q') ?? '';
        const sort = url.searchParams.get('sort') ?? '';
        writeJson(response, 200, this.getLibraryAlbums(page, pageSize, query, sort, this.baseUrlForRequest(request)));
        return;
      }

      const albumTracksMatch = path.match(/^\/echo-link\/v1\/library\/albums\/([^/]+)\/tracks$/u);
      if (request.method === 'GET' && albumTracksMatch) {
        const page = Number(url.searchParams.get('page') ?? 1);
        const pageSize = Number(url.searchParams.get('pageSize') ?? 200);
        writeJson(
          response,
          200,
          this.getLibraryAlbumTracks(decodeURIComponent(albumTracksMatch[1]), page, pageSize, this.baseUrlForRequest(request)),
        );
        return;
      }

      const lyricsMatch =
        path.match(/^\/echo-link\/v1\/library\/tracks\/([^/]+)\/lyrics$/u) ??
        path.match(/^\/echo-link\/v1\/lyrics\/([^/]+)$/u);
      if (request.method === 'GET' && lyricsMatch) {
        writeJson(response, 200, await this.getTrackLyrics(decodeURIComponent(lyricsMatch[1])));
        return;
      }

      const streamMatch = path.match(/^\/echo-link\/v1\/library\/tracks\/([^/]+)\/stream$/u);
      if (request.method === 'POST' && streamMatch) {
        const body = await readJsonBody(request) as Record<string, unknown>;
        if (body.target !== 'phone') {
          throw new HttpError(400, 'target_must_be_phone');
        }
        writeJson(response, 200, this.createStream(decodeURIComponent(streamMatch[1]), this.baseUrlForRequest(request)));
        return;
      }

      this.recordHttpError(path, 404, 'not_found');
      writeError(response, 404, 'not_found');
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      const message = error instanceof Error ? error.message : String(error);
      this.recordHttpError(request.url ?? '', statusCode, message);
      if (!response.headersSent) {
        writeError(response, statusCode, message, message);
      } else {
        response.end();
      }
    }
  }

  private normalizePlaybackCommand(value: unknown): EchoLinkPlaybackCommand {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpError(400, 'command_body_required');
    }
    const input = value as Record<string, unknown>;
    switch (input.command) {
      case 'playPause':
      case 'next':
      case 'previous':
      case 'stop':
        return { command: input.command };
      case 'seekTo':
        return { command: 'seekTo', positionMs: Number(input.positionMs) };
      case 'setVolume':
        return { command: 'setVolume', volume: Number(input.volume) };
      case 'playTrack':
        if (typeof input.trackId !== 'string' || input.output !== 'pc') {
          throw new HttpError(400, 'invalid_play_track_command');
        }
        return { command: 'playTrack', trackId: input.trackId, output: 'pc' };
      case 'handoff':
        if (typeof input.trackId !== 'string' || input.target !== 'pc') {
          throw new HttpError(400, 'invalid_handoff_command');
        }
        return { command: 'handoff', trackId: input.trackId, positionMs: Number(input.positionMs), target: 'pc' };
      case 'queueReplace':
        if (!Array.isArray(input.trackIds) || input.output !== 'pc') {
          throw new HttpError(400, 'invalid_queue_replace_command');
        }
        return {
          command: 'queueReplace',
          trackIds: input.trackIds.filter((trackId): trackId is string => typeof trackId === 'string' && trackId.trim().length > 0),
          startTrackId: typeof input.startTrackId === 'string' ? input.startTrackId : undefined,
          output: 'pc',
        };
      default:
        throw new HttpError(400, 'unknown_command');
    }
  }

  private createPlayback(audioStatus: AudioStatus, track: LibraryTrack | null, baseUrl: string): EchoLinkPlayback {
    return {
      state: stateForAudioStatus(audioStatus),
      track: this.createCurrentTrackPreview(audioStatus, track, baseUrl),
      positionMs: Math.max(0, Math.round((audioStatus.positionSeconds ?? 0) * 1000)),
      durationMs: Math.max(0, Math.round((audioStatus.durationSeconds ?? 0) * 1000)),
      volume: Math.max(0, Math.min(1, Number(audioStatus.volume) || 0)),
      outputMode: this.formatOutputMode(audioStatus),
      updatedAtEpochMs: this.now(),
      queue: this.createQueuePreview(baseUrl),
    };
  }

  private createCurrentTrackPreview(audioStatus: AudioStatus, track: LibraryTrack | null, baseUrl: string): EchoLinkTrackPreview | null {
    const statusPath = comparablePath(audioStatus.currentFilePath);
    const trackPath = comparablePath(track?.path);
    const trackMatchesAudioPath = Boolean(track) && (!statusPath || !trackPath || statusPath === trackPath);
    const fallbackTrack = trackMatchesAudioPath ? track : null;
    const changedFileTitle = trackMatchesAudioPath ? null : fileNameFromPath(audioStatus.currentFilePath);
    const id = firstNonEmpty(audioStatus.currentTrackId, fallbackTrack?.id, audioStatus.currentFilePath);
    const title = firstNonEmpty(
      audioStatus.currentTrackTitle,
      fallbackTrack?.title,
      changedFileTitle,
      fileNameFromPath(fallbackTrack?.path),
      fileNameFromPath(audioStatus.currentFilePath),
    );
    if (!id && !title) {
      return null;
    }
    const artist = firstNonEmpty(audioStatus.currentTrackArtist, audioStatus.currentTrackAlbumArtist, fallbackTrack?.artist, fallbackTrack?.albumArtist);
    const album = firstNonEmpty(audioStatus.currentTrackAlbum, fallbackTrack?.album) ?? '';
    const albumArtist = firstNonEmpty(audioStatus.currentTrackAlbumArtist, audioStatus.currentTrackArtist, fallbackTrack?.albumArtist, fallbackTrack?.artist);
    const statusDurationMs = Math.max(0, Math.round((audioStatus.durationSeconds ?? 0) * 1000));
    return {
      id: id ?? 'current',
      title: title ?? 'Unknown Track',
      artist: artist ?? 'Unknown Artist',
      album,
      albumArtist: albumArtist ?? artist ?? 'Unknown Artist',
      artworkUrl: webSafeArtworkUrl(audioStatus.currentTrackCoverUrl) ?? (fallbackTrack ? this.createArtworkUrl(fallbackTrack.coverId, baseUrl) : null),
      durationMs: statusDurationMs > 0 ? statusDurationMs : Math.max(0, Math.round((fallbackTrack?.duration ?? 0) * 1000)),
      sourceLabel: fallbackTrack ? sourceLabelForTrack(fallbackTrack) : 'Current Playback',
      canPlayOnPhone: fallbackTrack ? canPlayOnPhone(fallbackTrack) : Boolean(audioStatus.currentFilePath && existsSync(audioStatus.currentFilePath)),
      codec: fallbackTrack?.codec ?? null,
      sampleRate: fallbackTrack?.sampleRate ?? null,
      bitDepth: fallbackTrack?.bitDepth ?? null,
      bitrate: fallbackTrack?.bitrate ?? null,
    };
  }

  private formatOutputMode(status: AudioStatus): string {
    switch (status.outputMode) {
      case 'shared':
        return 'WASAPI Shared';
      case 'exclusive':
        return 'WASAPI Exclusive';
      case 'system':
        return 'System';
      default:
        return status.outputMode;
    }
  }

  private resolveCurrentTrack(audioStatus: AudioStatus): LibraryTrack | null {
    if (!audioStatus.currentTrackId) {
      return null;
    }
    try {
      return this.libraryService.getTrack(audioStatus.currentTrackId);
    } catch {
      return null;
    }
  }

  private syncQueueTrackFromAudioStatus(audioStatus: AudioStatus): void {
    const currentTrackId = firstNonEmpty(audioStatus.currentTrackId);
    if (!currentTrackId || this.queueTrackIds.length === 0) {
      return;
    }
    this.currentQueueTrackId = this.queueTrackIds.includes(currentTrackId) ? currentTrackId : null;
  }

  private requireTrack(trackId: string): LibraryTrack {
    const track = this.libraryService.getTrack(trackId);
    if (!track) {
      throw new HttpError(404, 'track_not_found');
    }
    return track;
  }

  private requireAlbum(albumId: string): LibraryAlbum {
    const album = this.libraryService.getAlbum(albumId);
    if (!album) {
      throw new HttpError(404, 'album_not_found');
    }
    return album;
  }

  private toTrackPreview(track: LibraryTrack, baseUrl: string): EchoLinkTrackPreview {
    return {
      id: track.id,
      title: track.title || track.path.split(/[\\/]/u).pop() || 'Unknown Track',
      artist: track.artist || track.albumArtist || 'Unknown Artist',
      album: track.album || '',
      albumArtist: track.albumArtist || track.artist || 'Unknown Artist',
      artworkUrl: this.createArtworkUrl(track.coverId, baseUrl),
      durationMs: Math.max(0, Math.round((track.duration ?? 0) * 1000)),
      sourceLabel: sourceLabelForTrack(track),
      canPlayOnPhone: canPlayOnPhone(track),
      codec: track.codec,
      sampleRate: track.sampleRate,
      bitDepth: track.bitDepth,
      bitrate: track.bitrate,
    };
  }

  private toAlbumPreview(album: LibraryAlbum, baseUrl: string): EchoLinkAlbumPreview {
    return {
      id: album.id,
      title: album.title || 'Untitled Album',
      albumArtist: album.albumArtist || 'Unknown Artist',
      artworkUrl: this.createArtworkUrl(album.coverId, baseUrl),
      trackCount: Math.max(0, Math.round(album.trackCount ?? 0)),
      durationMs: Math.max(0, Math.round((album.duration ?? 0) * 1000)),
      sourceLabel: album.mediaType === 'remote'
        ? album.sourceDisplayName ?? 'Remote Library'
        : album.provider ?? 'Local Library',
      year: album.year,
    };
  }

  private async getTrackLyrics(trackId: string): Promise<{ lyrics: string; sourceLabel: string; kind: TrackLyrics['kind'] }> {
    this.requireTrack(trackId);
    const lyrics = await this.lyricsService.getLyricsForTrack(trackId);
    if (!lyrics) {
      throw new HttpError(404, 'lyrics_not_found');
    }
    if (lyrics.kind === 'instrumental') {
      return { lyrics: '', sourceLabel: 'PC ECHO', kind: lyrics.kind };
    }
    const text = lyricsToAndroidText(lyrics);
    if (!text) {
      throw new HttpError(404, 'lyrics_not_found');
    }
    return { lyrics: text, sourceLabel: 'PC ECHO', kind: lyrics.kind };
  }

  private createQueuePreview(baseUrl: string): EchoLinkPlayback['queue'] | undefined {
    if (this.queueTrackIds.length === 0) {
      return undefined;
    }

    const items = this.queueTrackIds
      .map((trackId) => {
        try {
          return this.libraryService.getTrack(trackId);
        } catch {
          return null;
        }
      })
      .filter((track): track is LibraryTrack => Boolean(track))
      .slice(0, 50)
      .map((track) => this.toTrackPreview(track, baseUrl));

    return {
      currentTrackId: this.currentQueueTrackId,
      items,
    };
  }

  private createArtworkUrl(coverId: string | null, baseUrl: string): string {
    const asset = this.resolveCoverAsset(coverId);
    const token = randomBytes(24).toString('base64url');
    this.artworkTokens.set(token, {
      filePath: asset?.filePath ?? null,
      mimeType: asset?.mimeType ?? 'image/svg+xml',
      expiresAtEpochMs: this.now() + artworkTokenTtlMs,
    });
    this.cleanupExpiredTokens();
    return `${baseUrl}/echo-link/v1/artwork/${token}`;
  }

  private resolveCoverAsset(coverId: string | null): { filePath: string; mimeType: string | null } | null {
    if (!coverId) {
      return null;
    }
    for (const variant of ['large', 'album', 'thumb', 'original'] as CoverVariant[]) {
      const asset = this.libraryService.resolveCoverAsset(coverId, variant);
      if (asset?.filePath && existsSync(asset.filePath)) {
        return asset;
      }
    }
    return null;
  }

  private replaceQueue(trackIds: string[], startTrackId?: string): void {
    const uniqueTrackIds = [...new Set(trackIds.map((trackId) => trackId.trim()).filter(Boolean))];
    if (uniqueTrackIds.length === 0) {
      throw new HttpError(400, 'queue_must_not_be_empty');
    }

    for (const trackId of uniqueTrackIds) {
      this.requireTrack(trackId);
    }
    const nextCurrent = startTrackId && uniqueTrackIds.includes(startTrackId) ? startTrackId : uniqueTrackIds[0] ?? null;
    this.queueTrackIds = uniqueTrackIds.slice(0, 200);
    this.currentQueueTrackId = nextCurrent;
  }

  private async playRelativeQueueTrack(direction: 1 | -1): Promise<boolean> {
    if (!this.currentQueueTrackId || this.queueTrackIds.length === 0) {
      return false;
    }

    const currentIndex = this.queueTrackIds.indexOf(this.currentQueueTrackId);
    const nextTrackId = this.queueTrackIds[currentIndex + direction];
    if (!nextTrackId) {
      return false;
    }

    this.currentQueueTrackId = nextTrackId;
    await this.playTrackOnPc(nextTrackId);
    return true;
  }

  private async playTrackOnPc(trackId: string, positionMs = 0): Promise<void> {
    const track = this.requireTrack(trackId);
    if ((track.mediaType ?? 'local') !== 'local' || !existsSync(track.path)) {
      throw new HttpError(409, 'only_local_tracks_can_play_on_pc_in_phase_1');
    }
    await this.audioSession.playLocalFile({
      filePath: track.path,
      trackId: track.id,
      startSeconds: Math.max(0, Number(positionMs) || 0) / 1000,
      metadata: {
        title: track.title,
        artist: track.artist,
        album: track.album,
        albumArtist: track.albumArtist,
        coverUrl: track.coverThumb,
      },
    });
    this.publishPlaybackQueueSession(positionMs);
  }

  private publishPlaybackQueueSession(positionMs = 0): void {
    const session = this.createPlaybackQueueSession(positionMs);
    if (session) {
      this.broadcastPlaybackQueueSession(session);
    }
  }

  private createPlaybackQueueSession(positionMs = 0): PersistedPlaybackSessionV1 | null {
    const updatedAt = new Date(this.now()).toISOString();
    const source = { type: 'manual' as const, label: 'ECHO Link' };
    const items: PersistedQueueItem[] = [];

    for (const [index, trackId] of this.queueTrackIds.entries()) {
      const track = this.libraryService.getTrack(trackId);
      if (!track) {
        continue;
      }
      items.push({
        queueId: `echo-link-${index + 1}-${track.id}`,
        track,
        source,
        addedAt: updatedAt,
      });
    }

    if (items.length === 0) {
      return null;
    }

    const currentItem = items.find((item) => item.track.id === this.currentQueueTrackId) ?? items[0];
    const positionMsSafe = Math.max(0, Math.round(Number(positionMs) || 0));
    const durationMs = Math.max(0, Math.round((currentItem.track.duration ?? 0) * 1000));

    return {
      version: 1,
      items,
      currentQueueId: currentItem.queueId,
      currentTrackId: currentItem.track.id,
      lastPlayedTrack: currentItem.track,
      history: [],
      mode: {
        isShuffleEnabled: false,
        repeatMode: 'off',
        automixEnabled: false,
        autoFillQueueEnabled: false,
      },
      resume: {
        queueId: currentItem.queueId,
        trackId: currentItem.track.id,
        filePath: currentItem.track.path,
        positionMs: positionMsSafe,
        durationMs,
        state: 'playing',
        updatedAt,
      },
      updatedAt,
      playlistPlayback: null,
    };
  }

  private async serveArtworkToken(request: IncomingMessage, response: ServerResponse, token: string): Promise<void> {
    const record = this.artworkTokens.get(token);
    if (!record || record.expiresAtEpochMs <= this.now()) {
      this.artworkTokens.delete(token);
      throw new HttpError(401, 'artwork_token_expired_or_missing');
    }

    if (!record.filePath || !existsSync(record.filePath)) {
      const body = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="22" fill="#111827"/><circle cx="64" cy="64" r="28" fill="#7dd3fc"/><circle cx="64" cy="64" r="9" fill="#111827"/></svg>',
        'utf8',
      );
      response.writeHead(200, {
        'Cache-Control': 'private, max-age=600',
        'Content-Length': String(body.byteLength),
        'Content-Type': 'image/svg+xml',
      });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }

    const stat = statSync(record.filePath);
    const mimeType = record.mimeType === 'application/octet-stream' ? mimeTypeForImagePath(record.filePath) : record.mimeType;
    response.writeHead(200, {
      'Cache-Control': 'private, max-age=600',
      'Content-Length': String(stat.size),
      'Content-Type': mimeType,
      'Last-Modified': stat.mtime.toUTCString(),
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(record.filePath).pipe(response);
  }

  private async serveWebBackgroundAsset(request: IncomingMessage, response: ServerResponse, token: string): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      writeText(response, 405, 'method_not_allowed');
      return;
    }

    const asset = this.webBackgroundAsset;
    if (!asset || asset.token !== token) {
      throw new HttpError(401, 'background_token_expired_or_missing');
    }

    if (!existsSync(asset.filePath)) {
      throw new HttpError(404, 'background_image_file_missing');
    }
    const fileStat = statSync(asset.filePath);
    if (!fileStat.isFile()) {
      throw new HttpError(404, 'background_image_file_missing');
    }

    response.writeHead(200, {
      'Cache-Control': 'private, max-age=300',
      'Content-Length': String(fileStat.size),
      'Content-Type': asset.mimeType,
      'Last-Modified': fileStat.mtime.toUTCString(),
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(asset.filePath)
      .once('error', (error) => {
        if (!response.destroyed) {
          response.destroy(error);
        }
      })
      .pipe(response);
  }

  private async serveMediaToken(request: IncomingMessage, response: ServerResponse, token: string): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      writeText(response, 405, 'method_not_allowed');
      return;
    }

    this.cleanupExpiredTokens();
    const record = this.mediaTokens.get(token);
    if (!record || record.expiresAtEpochMs <= this.now()) {
      this.mediaTokens.delete(token);
      writeText(response, 401, 'media_token_expired_or_missing');
      return;
    }

    const fileStat = statSync(record.filePath);
    if (!fileStat.isFile()) {
      writeText(response, 404, 'media_file_missing');
      return;
    }

    const size = fileStat.size;
    const rangeHeader = safeHeader(request.headers.range);
    const range = parseRange(rangeHeader, size);
    const baseHeaders: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=0, no-store',
      'Content-Type': record.mimeType,
      'Last-Modified': fileStat.mtime.toUTCString(),
    };

    if (rangeHeader && !range) {
      this.recordHttpError(request.url ?? '', 416, 'invalid_range');
      response.writeHead(416, {
        ...baseHeaders,
        'Content-Length': '0',
        'Content-Range': `bytes */${size}`,
      });
      response.end();
      return;
    }

    if (range) {
      this.lastMediaTokenServed = {
        tokenPrefix: token.slice(0, 8),
        range: rangeHeader ?? null,
        bytes: range.end - range.start + 1,
        servedAt: new Date(this.now()).toISOString(),
      };
      response.writeHead(206, {
        ...baseHeaders,
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      createReadStream(record.filePath, range).pipe(response);
      return;
    }

    response.writeHead(200, {
      ...baseHeaders,
      'Content-Length': String(size),
    });
    this.lastMediaTokenServed = {
      tokenPrefix: token.slice(0, 8),
      range: null,
      bytes: size,
      servedAt: new Date(this.now()).toISOString(),
    };
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(record.filePath)
      .once('error', (error) => {
        if (!response.destroyed) {
          response.destroy(error);
        }
      })
      .pipe(response);
  }
}

let service: EchoLinkService | null = null;

export const getEchoLinkService = (): EchoLinkService => {
  service ??= new EchoLinkService();
  return service;
};

export const disposeEchoLinkService = async (): Promise<void> => {
  await service?.close();
  service = null;
};
