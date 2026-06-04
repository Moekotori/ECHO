import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { app } from 'electron';
import type {
  CreateDownloadUrlJobOptions,
  DownloadJob,
  DownloadSearchProvider,
  DownloadSearchProviderError,
  DownloadSearchRequest,
  DownloadSearchResponse,
  DownloadSearchResult,
  DownloadSearchScope,
  DownloadJobStatus,
  DownloadSettings,
  DownloadSourceProvider,
  DownloadToolsStatus,
} from '../../shared/types/downloads';
import type { AccountCredentials, AccountProvider } from '../../shared/types/accounts';
import type { AppSettings } from '../../shared/types/appSettings';
import { streamingProviderNames, type StreamingProviderName } from '../../shared/types/streaming';
import { isSupportedAudioExtension } from '../../shared/constants/audioExtensions';
import { getAccountService } from '../accounts/AccountService';
import { resolveFfmpegToolchain, type FfmpegToolchainInfo } from '../audio/FfmpegToolchain';
import { getLibraryService } from '../library/LibraryService';
import { getNcmConverter } from '../library/NcmConverter';
import { importOsuArchiveAsMp3Queued } from '../library/OsuArchiveImport';
import { writeEmbeddedCoverArt, writeEmbeddedTrackTags } from '../library/TagWriter';
import { getMvService } from '../mv/MvService';
import { getAppSettings } from '../app/appSettings';
import {
  isProtectedMusicDownloadProvider,
  protectedMusicDownloadBlockedMessage,
  type ProtectedMusicDownloadProvider,
  verifyDownloadAuthorizationToken,
} from './DownloadAuthorization';

const defaultSettings: DownloadSettings = {
  audioStrategy: 'best_available',
  importToLibrary: true,
  bindMvAfterImport: true,
  outputDirectory: null,
};

const terminalStatuses = new Set<DownloadJobStatus>(['completed', 'failed', 'cancelled']);
const cancellableStatuses = new Set<DownloadJobStatus>(['queued', 'probing', 'downloading', 'extracting_audio', 'importing', 'binding_mv']);
const progressEmitIntervalMs = 500;
const maxCommandOutputBytes = 1024 * 1024 * 4;
const ytDlpFileName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const outputTemplate = '%(title).180B.%(ext)s';
const browserUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const osuDownloadUserAgent = 'ECHO Next/26.5 osu downloader (https://github.com/moekotori/echo)';
const osuArchiveAccept = 'application/x-osu-beatmap-archive,application/zip,application/octet-stream,*/*';

const searchProvidersForScope = (scope: DownloadSearchScope | undefined): DownloadSearchProvider[] => {
  if (scope === 'youtube' || scope === 'bilibili') {
    return [scope];
  }

  return ['youtube', 'bilibili'];
};

const inferProvider = (url: string): DownloadSourceProvider => {
  const normalized = url.toLowerCase();

  if (normalized.includes('youtube.com') || normalized.includes('youtu.be')) {
    return 'youtube';
  }

  if (normalized.includes('bilibili.com') || normalized.includes('b23.tv')) {
    return 'bilibili';
  }

  if (normalized.includes('soundcloud.com') || normalized.includes('sndcdn.com')) {
    return 'soundcloud';
  }

  if (parseOsuBeatmapsetId(url)) {
    return 'osu';
  }

  return 'unknown';
};

const playbackOnlyDownloadBlockedMessage = 'This streaming platform is playback-only in ECHO Next. Downloading this content is disabled by policy.';

const isPlaybackOnlyStreamingHost = (host: string): boolean => {
  const normalized = host.toLowerCase();
  return (
    normalized === 'spotify.com' ||
    normalized.endsWith('.spotify.com') ||
    normalized === 'scdn.co' ||
    normalized.endsWith('.scdn.co') ||
    normalized === 'spotifycdn.com' ||
    normalized.endsWith('.spotifycdn.com')
  );
};

const parseOsuBeatmapsetId = (value: string): string | null => {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    if (host !== 'osu.ppy.sh' && host !== 'www.osu.ppy.sh') {
      return null;
    }

    const match = url.pathname.match(/^\/(?:beatmapsets|s)\/(\d+)(?:\/|$)/u);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
};

const isPlaybackOnlyDownloadUrl = (value: unknown): boolean => {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.toLowerCase().startsWith('spotify:')) {
    return true;
  }

  try {
    return isPlaybackOnlyStreamingHost(new URL(trimmed).hostname);
  } catch {
    return false;
  }
};

const cloneJob = (job: DownloadJob): DownloadJob => ({ ...job });

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

type RunningCommand = {
  promise: Promise<CommandResult>;
  kill: () => void;
};

type CommandRunner = (command: string, args: string[]) => RunningCommand;
type StreamingCommandRunner = (
  command: string,
  args: string[],
  listeners: {
    onStdout?: (line: string) => void;
    onStderr?: (line: string) => void;
  },
) => RunningCommand;

type ToolResolver = () => string | null;

type YtDlpProbeResult = {
  title?: unknown;
  duration?: unknown;
  thumbnail?: unknown;
  thumbnails?: unknown;
  webpage_url?: unknown;
};

type DownloadJobOptions = Required<Pick<DownloadSettings, 'importToLibrary' | 'bindMvAfterImport'>> & {
  outputDirectory: string;
  requestHeaders: Record<string, string>;
  suggestedTitle: string | null;
  suggestedArtist: string | null;
  suggestedAlbum: string | null;
  suggestedAlbumArtist: string | null;
  suggestedCoverUrl: string | null;
  suggestedCoverData: { data: Uint8Array; mimeType: string } | null;
  webpageUrl: string | null;
  directAudio: boolean;
  directAudioMimeType: string | null;
  directAudioExtension: string | null;
  streamingProvider: StreamingProviderName | null;
  streamingProviderTrackId: string | null;
  streamingStableKey: string | null;
  downloadAuthorizationToken: string | null;
  deferImportToLibrary: boolean;
};

type PersistedDownloadJobOptions = Omit<DownloadJobOptions, 'suggestedCoverData' | 'deferImportToLibrary'> & {
  suggestedCoverData: null;
  deferImportToLibrary?: boolean;
};

type PersistedDownloadState = {
  version: 1;
  jobs: DownloadJob[];
  jobOptions: Record<string, PersistedDownloadJobOptions>;
};

type DownloadServiceDependencies = {
  addLibraryFolder?: (folderPath: string) => unknown;
  importAudioFile?: (
    filePath: string,
    options?: {
      folderPath?: string;
      metadata?: {
        title?: string;
        artist?: string;
        album?: string;
        albumArtist?: string;
      };
      coverUrl?: string | null;
    },
  ) => Promise<{ id: string }>;
  bindMvUrl?: (trackId: string, url: string) => unknown;
  linkDownloadedStreamingTrack?: (input: { provider: StreamingProviderName; providerTrackId: string; stableKey?: string | null; trackId: string }) => unknown;
  streamingCommandRunner?: StreamingCommandRunner;
  fetch?: typeof fetch;
  loadSettings?: () => Partial<DownloadSettings> | null;
  saveSettings?: (settings: DownloadSettings) => void;
  loadJobs?: () => PersistedDownloadState | null;
  saveJobs?: (state: PersistedDownloadState) => void;
  loadAppSettings?: () => Pick<AppSettings, 'downloadsFeatureUnlocked'> | null;
  getAccountCredentials?: (provider: AccountProvider) => AccountCredentials;
  writeEmbeddedCoverArt?: typeof writeEmbeddedCoverArt;
  writeEmbeddedTrackTags?: typeof writeEmbeddedTrackTags;
};

type YtDlpSearchEntry = {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  webpage_url?: unknown;
  uploader?: unknown;
  channel?: unknown;
  duration?: unknown;
  thumbnail?: unknown;
  thumbnails?: unknown;
  view_count?: unknown;
  timestamp?: unknown;
  upload_date?: unknown;
  release_timestamp?: unknown;
};

type YtDlpSearchResult = {
  entries?: unknown;
};

type BilibiliSearchApiEntry = {
  bvid?: unknown;
  aid?: unknown;
  title?: unknown;
  author?: unknown;
  duration?: unknown;
  pic?: unknown;
  arcurl?: unknown;
  play?: unknown;
  pubdate?: unknown;
};

type BilibiliSearchApiResponse = {
  code?: unknown;
  message?: unknown;
  data?: {
    result?: unknown;
  };
};

type OsuDownloadSource = {
  label: string;
  url: string;
  headers: Record<string, string>;
};

const getProcessResourcesPath = (): string | null => {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return typeof resourcesPath === 'string' && resourcesPath.trim() ? resourcesPath : null;
};

const resolveBundledYtDlpPath: ToolResolver = () => {
  const resourcesPath = getProcessResourcesPath();
  const candidates = [
    resourcesPath ? resolve(resourcesPath, 'tools', ytDlpFileName) : null,
    resourcesPath ? resolve(resourcesPath, ytDlpFileName) : null,
    process.platform !== 'win32' ? resolve(process.cwd(), 'electron-app', 'tools-linux', ytDlpFileName) : null,
    resolve(process.cwd(), 'electron-app', 'tools', ytDlpFileName),
    resolve(process.cwd(), 'tools', ytDlpFileName),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
};

const sanitizeSettings = (value: Partial<DownloadSettings> | null | undefined, fallback: DownloadSettings): DownloadSettings => ({
  audioStrategy: 'best_available',
  importToLibrary: typeof value?.importToLibrary === 'boolean' ? value.importToLibrary : fallback.importToLibrary,
  bindMvAfterImport: typeof value?.bindMvAfterImport === 'boolean' ? value.bindMvAfterImport : fallback.bindMvAfterImport,
  outputDirectory:
    typeof value?.outputDirectory === 'string' && value.outputDirectory.trim().length > 0
      ? resolve(value.outputDirectory.trim())
      : value?.outputDirectory === null
        ? null
        : fallback.outputDirectory,
});

const sanitizeTextOption = (value: unknown, maxLength: number): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : null;

const sanitizeRequestHeaders = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = rawName.trim();
    const headerValue = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!name || !headerValue || /[\r\n]/u.test(name) || /[\r\n]/u.test(headerValue) || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(name)) {
      continue;
    }

    headers[name] = headerValue;
  }

  return headers;
};

const sanitizeFilePart = (value: string): string => {
  const cleaned = value
    .replace(/[<>:"/\\|?*]/gu, ' ')
    .split('')
    .map((character) => (character.charCodeAt(0) < 32 ? ' ' : character))
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[. ]+$/u, '');

  return (cleaned || 'Untitled download').slice(0, 160);
};

const sanitizeOutputSubdirectory = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? sanitizeFilePart(value) : null;

const sanitizeExtension = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLocaleLowerCase().replace(/^\./u, '');
  return /^[a-z0-9]{2,5}$/u.test(normalized) ? normalized : null;
};

const extensionFromMimeType = (mimeType: string | null): string | null => {
  const normalized = mimeType?.split(';')[0]?.trim().toLocaleLowerCase();
  switch (normalized) {
    case 'audio/flac':
    case 'audio/x-flac':
      return 'flac';
    case 'audio/mp4':
    case 'audio/x-m4a':
      return 'm4a';
    case 'audio/aac':
      return 'aac';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/opus':
      return 'opus';
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    default:
      return null;
  }
};

const extensionFromUrl = (url: string): string | null => {
  try {
    return sanitizeExtension(new URL(url).pathname.split('/').pop()?.split('.').pop());
  } catch {
    return null;
  }
};

const sanitizeStreamingProvider = (value: unknown): StreamingProviderName | null =>
  typeof value === 'string' && streamingProviderNames.includes(value as StreamingProviderName) ? (value as StreamingProviderName) : null;

const protectedMusicProviderFromUrl = (value: string | null | undefined): ProtectedMusicDownloadProvider | null => {
  if (!value?.trim()) {
    return null;
  }

  const normalized = value.toLocaleLowerCase();
  if (normalized.includes('music.163.com') || normalized.includes('music.126.net')) {
    return 'netease';
  }

  if (
    normalized.includes('y.qq.com') ||
    normalized.includes('qqmusic.qq.com') ||
    normalized.includes('stream.qqmusic.qq.com') ||
    normalized.includes('qqmusic.tc.qq.com') ||
    normalized.includes('gtimg.cn')
  ) {
    return 'qqmusic';
  }

  if (
    normalized.includes('kugou.com') ||
    normalized.includes('kugoucdn.com') ||
    normalized.includes('kgimg.com') ||
    normalized.includes('webfs.') ||
    normalized.includes('fs.open.kugou.com')
  ) {
    return 'kugou';
  }

  return null;
};

const protectedMusicProviderFromDownloadRequest = (
  sourceUrl: string,
  webpageUrl: string | null,
  streamingProvider: StreamingProviderName | null,
): ProtectedMusicDownloadProvider | null => {
  if (isProtectedMusicDownloadProvider(streamingProvider)) {
    return streamingProvider;
  }

  return protectedMusicProviderFromUrl(sourceUrl) ?? protectedMusicProviderFromUrl(webpageUrl);
};

const supportedCoverMimeType = (value: string | null | undefined): string | null => {
  const normalized = value?.split(';')[0]?.trim().toLocaleLowerCase();
  return normalized === 'image/jpeg' || normalized === 'image/png' || normalized === 'image/webp' ? normalized : null;
};

const mimeTypeForCoverUrl = (url: string): string => {
  try {
    const extension = new URL(url).pathname.split('/').pop()?.split('.').pop()?.toLocaleLowerCase();
    if (extension === 'png') {
      return 'image/png';
    }
    if (extension === 'webp') {
      return 'image/webp';
    }
  } catch {
    return 'image/jpeg';
  }

  return 'image/jpeg';
};

const hasHeader = (headers: Record<string, string>, name: string): boolean =>
  Object.keys(headers).some((headerName) => headerName.toLocaleLowerCase() === name.toLocaleLowerCase());

const parseContentRangeTotal = (value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const match = value.match(/\/(\d+)\s*$/u);
  if (!match) {
    return null;
  }

  const total = Number(match[1]);
  return Number.isFinite(total) && total > 0 ? total : null;
};

const getDownloadsSettingsPath = (): string | null => {
  try {
    return join(app.getPath('userData'), 'echo-download-settings.json');
  } catch {
    return null;
  }
};

const getDownloadsJobsPath = (): string | null => {
  try {
    return join(app.getPath('userData'), 'echo-download-jobs.json');
  } catch {
    return null;
  }
};

const loadDownloadSettings = (): Partial<DownloadSettings> | null => {
  const settingsPath = getDownloadsSettingsPath();
  if (!settingsPath || !existsSync(settingsPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(settingsPath, 'utf8')) as Partial<DownloadSettings>;
  } catch {
    return null;
  }
};

const saveDownloadSettings = (settings: DownloadSettings): void => {
  const settingsPath = getDownloadsSettingsPath();
  if (!settingsPath) {
    return;
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
};

const loadPersistedDownloadState = (): PersistedDownloadState | null => {
  const jobsPath = getDownloadsJobsPath();
  if (!jobsPath || !existsSync(jobsPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(jobsPath, 'utf8')) as PersistedDownloadState;
    return parsed?.version === 1 && Array.isArray(parsed.jobs) && parsed.jobOptions && typeof parsed.jobOptions === 'object'
      ? parsed
      : null;
  } catch {
    return null;
  }
};

const savePersistedDownloadState = (state: PersistedDownloadState): void => {
  const jobsPath = getDownloadsJobsPath();
  if (!jobsPath) {
    return;
  }

  mkdirSync(dirname(jobsPath), { recursive: true });
  writeFileSync(jobsPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
};

const runCommand: CommandRunner = (command, args) => runStreamingCommand(command, args, {});

const runStreamingCommand: StreamingCommandRunner = (command, args, listeners) => {
  const child = spawn(command, args, {
    windowsHide: true,
    shell: false,
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutRemainder = '';
  let stderrRemainder = '';

  const appendChunk = (chunks: Buffer[], chunk: Buffer, currentBytes: number): number => {
    if (currentBytes >= maxCommandOutputBytes) {
      return currentBytes;
    }

    const remaining = maxCommandOutputBytes - currentBytes;
    const nextChunk = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
    chunks.push(nextChunk);
    return currentBytes + nextChunk.byteLength;
  };

  const emitLines = (text: string, stream: 'stdout' | 'stderr'): string => {
    const combined = `${stream === 'stdout' ? stdoutRemainder : stderrRemainder}${text}`;
    const parts = combined.split(/\r?\n/u);
    const remainder = parts.pop() ?? '';
    const handler = stream === 'stdout' ? listeners.onStdout : listeners.onStderr;

    for (const line of parts) {
      handler?.(line);
    }

    return remainder;
  };

  const promise = new Promise<CommandResult>((resolveResult) => {
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes = appendChunk(stdoutChunks, chunk, stdoutBytes);
      stdoutRemainder = emitLines(chunk.toString('utf8'), 'stdout');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes = appendChunk(stderrChunks, chunk, stderrBytes);
      stderrRemainder = emitLines(chunk.toString('utf8'), 'stderr');
    });
    child.on('error', (error) => {
      resolveResult({ stdout: '', stderr: error.message, exitCode: -1 });
    });
    child.on('close', (exitCode) => {
      if (stdoutRemainder) {
        listeners.onStdout?.(stdoutRemainder);
      }
      if (stderrRemainder) {
        listeners.onStderr?.(stderrRemainder);
      }
      resolveResult({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode,
      });
    });
  });

  return {
    promise,
    kill: () => {
      if (!child.killed) {
        child.kill();
      }
    },
  };
};

export class DownloadService extends EventEmitter {
  private jobs: DownloadJob[] = [];

  private settings: DownloadSettings = { ...defaultSettings };

  private runningCommands = new Map<string, RunningCommand>();

  private queuedJobIds: string[] = [];

  private activeJobId: string | null = null;

  private lastProgressEmitAt = new Map<string, number>();

  private jobOptions = new Map<string, DownloadJobOptions>();

  private deferredImportJobIds: string[] = [];

  private deferredImportTimer: NodeJS.Timeout | null = null;

  private deferredImportRunning = false;

  constructor(
    private readonly commandRunner: CommandRunner = runCommand,
    private readonly ytDlpPathResolver: ToolResolver = resolveBundledYtDlpPath,
    private readonly dependencies: DownloadServiceDependencies = {},
  ) {
    super();
    this.settings = sanitizeSettings(this.dependencies.loadSettings?.() ?? loadDownloadSettings(), defaultSettings);
    this.restorePersistedJobs();
  }

  getJobs(): DownloadJob[] {
    return this.jobs.map(cloneJob);
  }

  createUrlJob(url: string, options: CreateDownloadUrlJobOptions = {}): DownloadJob {
    const sourceUrl = url.trim();

    if (!sourceUrl) {
      throw new Error('download URL must be a non-empty string');
    }

    if (isPlaybackOnlyDownloadUrl(sourceUrl) || isPlaybackOnlyDownloadUrl(options.webpageUrl)) {
      throw new Error(playbackOnlyDownloadBlockedMessage);
    }

    const requestHeaders = sanitizeRequestHeaders(options.requestHeaders);
    const suggestedTitle = sanitizeTextOption(options.title, 180);
    const suggestedArtist = sanitizeTextOption(options.artist, 180);
    const suggestedAlbum = sanitizeTextOption(options.album, 180);
    const suggestedAlbumArtist = sanitizeTextOption(options.albumArtist, 180);
    const suggestedCoverUrl = sanitizeTextOption(options.coverUrl, 2048);
    const webpageUrl = sanitizeTextOption(options.webpageUrl, 2048);
    const directAudioMimeType = sanitizeTextOption(options.directAudioMimeType, 128);
    const directAudioExtension = sanitizeExtension(options.directAudioExtension);
    const streamingProvider = sanitizeStreamingProvider(options.streamingProvider);
    const streamingProviderTrackId = sanitizeTextOption(options.streamingProviderTrackId, 512);
    const streamingStableKey = sanitizeTextOption(options.streamingStableKey, 768);
    const downloadAuthorizationToken = sanitizeTextOption(options.downloadAuthorizationToken, 4096);
    const protectedMusicProvider = protectedMusicProviderFromDownloadRequest(sourceUrl, webpageUrl, streamingProvider);
    if (
      protectedMusicProvider &&
      !this.isProtectedMusicDownloadAuthorized(downloadAuthorizationToken, {
        provider: protectedMusicProvider,
        providerTrackId: streamingProviderTrackId,
        url: sourceUrl,
      })
    ) {
      throw new Error(protectedMusicDownloadBlockedMessage);
    }

    const baseOutputDirectory = this.settings.outputDirectory;
    if (!baseOutputDirectory) {
      throw new Error('请选择下载文件夹');
    }

    const outputStat = existsSync(baseOutputDirectory) ? statSync(baseOutputDirectory) : null;
    if (!outputStat?.isDirectory()) {
      throw new Error(`涓嬭浇鏂囦欢澶逛笉鍙敤: ${baseOutputDirectory}`);
    }
    this.ensureOutputDirectoryInLibrary(baseOutputDirectory);
    const outputDirectory = this.prepareJobOutputDirectory(baseOutputDirectory, options.outputSubdirectory);

    const provider = inferProvider(sourceUrl);
    const now = new Date().toISOString();
    const job: DownloadJob = {
      id: randomUUID(),
      sourceUrl,
      provider,
      audioStrategy: 'best_available',
      status: 'queued',
      title: suggestedTitle,
      durationSeconds: null,
      thumbnailUrl: suggestedCoverUrl,
      webpageUrl,
      outputPath: null,
      downloadedBytes: null,
      totalBytes: null,
      speedBytesPerSecond: null,
      etaSeconds: null,
      importedTrackId: null,
      progress: 0,
      error: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    this.jobOptions.set(job.id, {
      importToLibrary: options.importToLibrary ?? this.settings.importToLibrary,
      bindMvAfterImport: provider === 'osu' ? false : (options.bindMvAfterImport ?? this.settings.bindMvAfterImport),
      outputDirectory,
      requestHeaders,
      suggestedTitle,
      suggestedArtist,
      suggestedAlbum,
      suggestedAlbumArtist,
      suggestedCoverUrl,
      suggestedCoverData: null,
      webpageUrl,
      directAudio: options.directAudio === true,
      directAudioMimeType,
      directAudioExtension,
      streamingProvider,
      streamingProviderTrackId,
      streamingStableKey,
      downloadAuthorizationToken,
      deferImportToLibrary: options.deferImportToLibrary === true,
    });
    this.jobs = [job, ...this.jobs];
    this.queuedJobIds.push(job.id);
    this.emitJobsNow();
    this.startNextJob();
    return cloneJob(job);
  }

  cancelJob(jobId: string): DownloadJob | null {
    const job = this.jobs.find((item) => item.id === jobId);

    if (!job) {
      return null;
    }

    if (!cancellableStatuses.has(job.status)) {
      return cloneJob(job);
    }

    this.queuedJobIds = this.queuedJobIds.filter((id) => id !== jobId);
    this.clearCommand(jobId);
    this.cleanupPartialFiles(job);
    if (this.activeJobId === jobId) {
      this.activeJobId = null;
    }
    this.updateJob(jobId, {
      status: 'cancelled',
      error: null,
      completedAt: new Date().toISOString(),
    });
    this.startNextJob();
    return cloneJob(this.jobs.find((item) => item.id === jobId)!);
  }

  clearCompleted(): DownloadJob[] {
    for (const job of this.jobs) {
      if (terminalStatuses.has(job.status)) {
        this.clearCommand(job.id);
      }
    }

    const removedJobs = this.jobs.filter((job) => terminalStatuses.has(job.status));
    this.jobs = this.jobs.filter((job) => !terminalStatuses.has(job.status));
    for (const job of removedJobs) {
      this.jobOptions.delete(job.id);
    }
    this.emitJobsNow();
    return this.getJobs();
  }

  getSettings(): DownloadSettings {
    return { ...this.settings };
  }

  setSettings(patch: Partial<DownloadSettings>): DownloadSettings {
    const nextSettings = sanitizeSettings(patch, this.settings);

    if (nextSettings.outputDirectory && (!existsSync(nextSettings.outputDirectory) || !statSync(nextSettings.outputDirectory).isDirectory())) {
      throw new Error(`涓嬭浇鏂囦欢澶逛笉鍙敤: ${nextSettings.outputDirectory}`);
    }

    this.settings = nextSettings;
    this.ensureOutputDirectoryInLibrary(this.settings.outputDirectory);
    (this.dependencies.saveSettings ?? saveDownloadSettings)(this.settings);
    return this.getSettings();
  }

  async checkTools(): Promise<DownloadToolsStatus> {
    const ffmpegToolchain = resolveFfmpegToolchain();
    const ffmpegPath = ffmpegToolchain.path;
    const ytDlpPath = this.ytDlpPathResolver();
    let ytDlpVersion: string | null = null;

    if (ytDlpPath && existsSync(ytDlpPath)) {
      const result = await this.commandRunner(ytDlpPath, ['--version']).promise;
      if (result.exitCode === 0) {
        ytDlpVersion = result.stdout.trim().split(/\s+/u)[0] || null;
      }
    }

    return {
      ytDlpAvailable: Boolean(ytDlpVersion),
      ffmpegAvailable: ffmpegToolchain.healthy,
      ytDlpVersion,
      ytDlpPath,
      ffmpegPath,
    };
  }

  async search(request: string | DownloadSearchRequest): Promise<DownloadSearchResponse> {
    const query = (typeof request === 'string' ? request : request.query).trim();
    if (!query) {
      throw new Error('search query must be a non-empty string');
    }

    const rawLimit = typeof request === 'string' ? undefined : request.limitPerProvider;
    const limitPerProvider = Number.isFinite(rawLimit) ? Math.max(1, Math.min(20, Math.floor(Number(rawLimit)))) : 10;
    const ytDlpPath = this.ytDlpPathResolver();
    if (!ytDlpPath || !existsSync(ytDlpPath)) {
      throw new Error('yt-dlp is not installed with the application');
    }

    const providers = searchProvidersForScope(typeof request === 'string' ? undefined : request.provider);
    const settled = await Promise.all(
      providers.map(async (provider) => {
        try {
          return {
            provider,
            results: await this.searchProvider(ytDlpPath, provider, query, limitPerProvider),
            error: null,
          };
        } catch (error) {
          return {
            provider,
            results: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    return {
      results: settled.flatMap((item) => item.results),
      errors: settled
        .filter((item) => item.error !== null)
        .map((item) => ({ provider: item.provider, error: item.error ?? 'search failed' }) satisfies DownloadSearchProviderError),
    };
  }

  dispose(): void {
    for (const command of this.runningCommands.values()) {
      command.kill();
    }
    this.runningCommands.clear();
    this.queuedJobIds = [];
    this.activeJobId = null;
  }

  private async searchProvider(
    ytDlpPath: string,
    provider: DownloadSearchProvider,
    query: string,
    limitPerProvider: number,
  ): Promise<DownloadSearchResult[]> {
    const searchUrl = `${provider === 'youtube' ? 'ytsearch' : 'bilisearch'}${limitPerProvider}:${query}`;
    const tempCookiePath = this.writeCookieFile(provider);
    const authArgs = this.accountArgs(provider, tempCookiePath);

    try {
      const result = await this.runSearchCommand(ytDlpPath, searchUrl, limitPerProvider, authArgs);
      if (result.exitCode === 0) {
        const results = this.parseSearchResults(provider, result.stdout).slice(0, limitPerProvider);
        if (results.length > 0 || provider !== 'bilibili') {
          return results;
        }

        return this.searchBilibiliApi(query, limitPerProvider);
      }

      if (authArgs.length > 0) {
        const fallbackResult = await this.runSearchCommand(ytDlpPath, searchUrl, limitPerProvider, []);
        if (fallbackResult.exitCode === 0) {
          return this.parseSearchResults(provider, fallbackResult.stdout).slice(0, limitPerProvider);
        }
      }

      if (provider === 'bilibili') {
        const apiResults = await this.searchBilibiliApi(query, limitPerProvider);
        if (apiResults.length > 0) {
          return apiResults;
        }
      }

      throw new Error(this.formatSearchError(provider, result));
    } finally {
      if (tempCookiePath) {
        this.deleteTempFile(tempCookiePath);
      }
    }
  }

  private runSearchCommand(ytDlpPath: string, searchUrl: string, limitPerProvider: number, accountArgs: string[]): Promise<CommandResult> {
    return this.commandRunner(ytDlpPath, [
      '--simulate',
      '--flat-playlist',
      '--dump-single-json',
      '--playlist-end',
      String(limitPerProvider),
      ...accountArgs,
      searchUrl,
    ]).promise;
  }

  private accountArgs(provider: DownloadSearchProvider, tempCookiePath: string | null): string[] {
    if (tempCookiePath) {
      return ['--cookies', tempCookiePath];
    }

    if (provider !== 'youtube') {
      return [];
    }

    const credentials = this.getCredentials('youtube');
    const browser = credentials.browser;
    return browser && browser !== 'none' ? ['--cookies-from-browser', browser] : [];
  }

  private writeCookieFile(provider: DownloadSearchProvider): string | null {
    const credentials = this.getCredentials(provider);
    const cookie = credentials.cookie?.trim();
    if (!cookie) {
      return null;
    }

    const cookieFilePath = join(tmpdir(), `echo-download-${provider}-${randomUUID()}.cookies.txt`);
    writeFileSync(cookieFilePath, this.toNetscapeCookieFile(provider, cookie), 'utf8');
    return cookieFilePath;
  }

  private getCredentials(provider: AccountProvider): AccountCredentials {
    return this.dependencies.getAccountCredentials?.(provider) ?? getAccountService().getCredentials(provider);
  }

  private toNetscapeCookieFile(provider: DownloadSearchProvider, cookieHeader: string): string {
    const domain = provider === 'youtube' ? '.youtube.com' : '.bilibili.com';
    const lines = ['# Netscape HTTP Cookie File'];
    for (const part of cookieHeader.split(';')) {
      const [rawName, ...rawValueParts] = part.trim().split('=');
      const name = rawName?.trim();
      const value = rawValueParts.join('=').trim();
      if (!name || !value) {
        continue;
      }

      lines.push([domain, 'TRUE', '/', 'TRUE', '0', name, value].join('\t'));
    }

    return `${lines.join('\n')}\n`;
  }

  private deleteTempFile(filePath: string): void {
    try {
      unlinkSync(filePath);
    } catch {
      // Best-effort cleanup for temporary cookie files.
    }
  }

  private formatSearchError(provider: DownloadSearchProvider, result: CommandResult): string {
    const rawMessage = result.stderr.trim() || result.stdout.trim() || `${provider} search failed`;
    const singleLineMessage = rawMessage.replace(/\s+/gu, ' ').trim();
    if (/could not copy .*cookie database/iu.test(singleLineMessage)) {
      return 'Unable to read browser cookies; retried search without login state.';
    }

    return singleLineMessage.length > 220 ? `${singleLineMessage.slice(0, 217)}...` : singleLineMessage;
  }

  private async searchBilibiliApi(query: string, limitPerProvider: number): Promise<DownloadSearchResult[]> {
    const fetchRunner = this.dependencies.fetch ?? globalThis.fetch;
    if (!fetchRunner) {
      return [];
    }

    const url = new URL('https://api.bilibili.com/x/web-interface/search/type');
    url.searchParams.set('search_type', 'video');
    url.searchParams.set('keyword', query);
    url.searchParams.set('page', '1');
    url.searchParams.set('page_size', String(limitPerProvider));

    const cookie = this.getCredentials('bilibili').cookie?.trim();
    try {
      const response = await fetchRunner(url.toString(), {
        headers: {
          accept: 'application/json, text/plain, */*',
          referer: 'https://www.bilibili.com/',
          origin: 'https://www.bilibili.com',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          ...(cookie ? { cookie } : {}),
        },
      });
      if (!response.ok) {
        return [];
      }

      const payload = (await response.json()) as BilibiliSearchApiResponse;
      if (payload.code !== 0 || !payload.data || !Array.isArray(payload.data.result)) {
        return [];
      }

      return payload.data.result
        .map((entry) => this.mapBilibiliApiEntry(entry))
        .filter((entry): entry is DownloadSearchResult => Boolean(entry))
        .slice(0, limitPerProvider);
    } catch {
      return [];
    }
  }

  private mapBilibiliApiEntry(entry: unknown): DownloadSearchResult | null {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const item = entry as BilibiliSearchApiEntry;
    const bvid = this.cleanText(item.bvid);
    const aid = this.cleanPositiveNumber(item.aid);
    const id = bvid ?? (aid ? `av${aid}` : null);
    const title = this.cleanSearchText(item.title);
    const webpageUrl = this.normalizeBilibiliUrl(item.arcurl, id);
    if (!id || !title || !webpageUrl) {
      return null;
    }

    const pubdate = this.cleanPositiveNumber(item.pubdate);
    return {
      id,
      provider: 'bilibili',
      title,
      uploader: this.cleanSearchText(item.author),
      durationSeconds: this.parseBilibiliDuration(item.duration),
      thumbnailUrl: this.normalizeBilibiliImageUrl(item.pic),
      webpageUrl,
      viewCount: this.cleanPositiveNumber(item.play),
      publishedAt: pubdate ? new Date(pubdate * 1000).toISOString() : null,
    };
  }

  private cleanSearchText(value: unknown): string | null {
    const text = this.cleanText(value);
    if (!text) {
      return null;
    }

    return text
      .replace(/<[^>]*>/gu, '')
      .replace(/&quot;/gu, '"')
      .replace(/&#39;/gu, "'")
      .replace(/&amp;/gu, '&')
      .trim();
  }

  private parseBilibiliDuration(value: unknown): number | null {
    if (typeof value === 'number') {
      return this.cleanPositiveNumber(value);
    }

    const text = this.cleanText(value);
    if (!text) {
      return null;
    }

    const parts = text.split(':').map((part) => Number(part));
    if (parts.length === 2 && parts.every(Number.isFinite)) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    return null;
  }

  private normalizeBilibiliUrl(value: unknown, id: string | null): string | null {
    const directUrl = this.cleanText(value);
    if (directUrl?.startsWith('//')) {
      return `https:${directUrl}`;
    }
    if (directUrl?.startsWith('http://') || directUrl?.startsWith('https://')) {
      return directUrl;
    }

    return id ? `https://www.bilibili.com/video/${encodeURIComponent(id)}` : null;
  }

  private normalizeBilibiliImageUrl(value: unknown): string | null {
    const rawUrl = this.cleanText(value);
    const url = rawUrl?.startsWith('//') ? `https:${rawUrl}` : rawUrl;
    if (!url) {
      return null;
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:') {
        parsed.protocol = 'https:';
      }
      if (parsed.protocol === 'https:' && /(^|\.)hdslb\.com$/u.test(parsed.hostname)) {
        return `echo-image://remote/${encodeURIComponent(parsed.toString())}?referer=${encodeURIComponent('https://www.bilibili.com/')}`;
      }

      return parsed.toString();
    } catch {
      return url;
    }
  }

  private normalizeDownloadThumbnailUrl(provider: DownloadSourceProvider, value: string | null): string | null {
    return provider === 'bilibili' ? this.normalizeBilibiliImageUrl(value) : value;
  }

  private parseSearchResults(provider: DownloadSearchProvider, stdout: string): DownloadSearchResult[] {
    const parsed = JSON.parse(stdout) as YtDlpSearchResult;
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];

    return entries
      .map((entry) => this.mapSearchEntry(provider, entry))
      .filter((entry): entry is DownloadSearchResult => Boolean(entry));
  }

  private mapSearchEntry(provider: DownloadSearchProvider, entry: unknown): DownloadSearchResult | null {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const item = entry as YtDlpSearchEntry;
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : null;
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : null;
    const webpageUrl = this.normalizeSearchResultUrl(provider, item.webpage_url, item.url, id);
    if (!id || !title || !webpageUrl) {
      return null;
    }

    return {
      id,
      provider,
      title,
      uploader: this.cleanText(item.uploader) ?? this.cleanText(item.channel),
      durationSeconds: this.cleanPositiveNumber(item.duration),
      thumbnailUrl: provider === 'bilibili' ? this.normalizeBilibiliImageUrl(this.thumbnailFromEntry(item)) : this.thumbnailFromEntry(item),
      webpageUrl,
      viewCount: this.cleanPositiveNumber(item.view_count),
      publishedAt: this.dateFromSearchEntry(item),
    };
  }

  private normalizeSearchResultUrl(provider: DownloadSearchProvider, webpageUrl: unknown, url: unknown, id: string | null): string | null {
    const directUrl = this.cleanText(webpageUrl) ?? this.cleanText(url);
    if (directUrl?.startsWith('http://') || directUrl?.startsWith('https://')) {
      return directUrl;
    }

    if (!id) {
      return null;
    }

    return provider === 'youtube' ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : `https://www.bilibili.com/video/${encodeURIComponent(id)}`;
  }

  private thumbnailFromEntry(entry: YtDlpSearchEntry): string | null {
    const direct = this.cleanText(entry.thumbnail);
    if (direct) {
      return direct;
    }

    if (!Array.isArray(entry.thumbnails)) {
      return null;
    }

    const thumbnails = entry.thumbnails.filter((thumbnail): thumbnail is { url: string } =>
      Boolean(thumbnail && typeof thumbnail === 'object' && typeof (thumbnail as { url?: unknown }).url === 'string'),
    );
    return thumbnails.at(-1)?.url ?? null;
  }

  private dateFromSearchEntry(entry: YtDlpSearchEntry): string | null {
    const timestamp = this.cleanPositiveNumber(entry.timestamp) ?? this.cleanPositiveNumber(entry.release_timestamp);
    if (timestamp) {
      return new Date(timestamp * 1000).toISOString();
    }

    const uploadDate = this.cleanText(entry.upload_date);
    if (!uploadDate || !/^\d{8}$/u.test(uploadDate)) {
      return null;
    }

    return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`;
  }

  private cleanText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private cleanPositiveNumber(value: unknown): number | null {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
  }

  private startNextJob(): void {
    if (this.activeJobId) {
      return;
    }

    const nextJobId = this.queuedJobIds.shift();
    if (!nextJobId) {
      return;
    }

    const job = this.jobs.find((item) => item.id === nextJobId);
    if (!job || terminalStatuses.has(job.status)) {
      this.startNextJob();
      return;
    }

    this.activeJobId = nextJobId;
    void this.runJob(nextJobId).finally(() => {
      if (this.activeJobId === nextJobId) {
        this.activeJobId = null;
      }
      this.startNextJob();
    });
  }

  private restorePersistedJobs(): void {
    const state = this.dependencies.loadJobs?.() ?? loadPersistedDownloadState();
    if (!state) {
      return;
    }

    const now = new Date().toISOString();
    const restoredJobs: DownloadJob[] = [];
    for (const rawJob of state.jobs) {
      if (!rawJob || typeof rawJob.id !== 'string' || typeof rawJob.sourceUrl !== 'string') {
        continue;
      }

      const isTerminal = terminalStatuses.has(rawJob.status);
      const options = state.jobOptions[rawJob.id];
      const canResume = isTerminal || Boolean(options?.outputDirectory);
      const job: DownloadJob = {
        ...rawJob,
        status: isTerminal ? rawJob.status : canResume ? 'queued' : 'failed',
        progress: isTerminal ? rawJob.progress : canResume ? Math.min(95, Math.max(0, rawJob.progress ?? 0)) : 100,
        error: isTerminal ? rawJob.error : canResume ? null : 'Download resume data is incomplete. Add the track to downloads again.',
        updatedAt: now,
        completedAt: isTerminal ? rawJob.completedAt : canResume ? null : now,
      };
      restoredJobs.push(job);

      if (options?.outputDirectory) {
        this.jobOptions.set(rawJob.id, {
          ...options,
          requestHeaders: sanitizeRequestHeaders(options.requestHeaders),
          suggestedCoverData: null,
          deferImportToLibrary: options.deferImportToLibrary === true,
        });
      }
    }

    this.jobs = restoredJobs;
    this.queuedJobIds = restoredJobs
      .filter((job) => !terminalStatuses.has(job.status) && this.jobOptions.has(job.id))
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .map((job) => job.id);

    this.persistJobs();
    if (this.queuedJobIds.length > 0) {
      queueMicrotask(() => this.startNextJob());
    }
    for (const job of restoredJobs) {
      const options = this.jobOptions.get(job.id);
      if (job.status === 'completed' && !job.importedTrackId && options?.importToLibrary && options.deferImportToLibrary) {
        this.queueDeferredImport(job.id, 10_000);
      }
    }
  }

  private queueDeferredImport(jobId: string, delayMs = 2500): void {
    if (!this.deferredImportJobIds.includes(jobId)) {
      this.deferredImportJobIds.push(jobId);
    }
    this.scheduleDeferredImport(delayMs);
  }

  private scheduleDeferredImport(delayMs = 2500): void {
    if (this.deferredImportTimer || this.deferredImportRunning) {
      return;
    }

    this.deferredImportTimer = setTimeout(() => {
      void this.runDeferredImportQueue();
    }, delayMs);
    this.deferredImportTimer.unref?.();
  }

  private async shouldDelayDeferredImportForPlayback(): Promise<boolean> {
    try {
      const { getAudioSession } = await import('../audio/AudioSession');
      const state = getAudioSession().getStatus().state;
      return state === 'loading' || state === 'playing';
    } catch {
      return false;
    }
  }

  private async runDeferredImportQueue(): Promise<void> {
    this.deferredImportTimer = null;
    if (this.deferredImportRunning || this.deferredImportJobIds.length === 0) {
      return;
    }

    if (await this.shouldDelayDeferredImportForPlayback()) {
      this.scheduleDeferredImport(15_000);
      return;
    }

    const jobId = this.deferredImportJobIds.shift();
    if (!jobId) {
      return;
    }

    this.deferredImportRunning = true;
    try {
      await this.importAndBind(jobId);
      this.updateJob(jobId, {
        status: 'completed',
        progress: 100,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      const job = this.jobs.find((item) => item.id === jobId);
      if (job && job.status === 'completed' && !job.importedTrackId) {
        this.updateJob(jobId, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      this.deferredImportRunning = false;
      if (this.deferredImportJobIds.length > 0) {
        this.scheduleDeferredImport(1500);
      }
    }
  }

  private async runJob(jobId: string): Promise<void> {
    try {
      const job = this.requireJob(jobId);
      const options = this.jobOptions.get(jobId);
      this.assertProtectedMusicDownloadAuthorized(job, options);
      if (job.provider !== 'osu' && !options?.directAudio) {
        await this.probe(jobId);
      }
      await this.download(jobId);
      await this.writeDownloadedEmbeddedTags(jobId);
      if (options?.importToLibrary && options.deferImportToLibrary) {
        this.queueDeferredImport(jobId);
      } else {
        await this.importAndBind(jobId);
      }
      this.updateJob(jobId, {
        status: 'completed',
        progress: 100,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      const job = this.jobs.find((item) => item.id === jobId);
      if (!job || terminalStatuses.has(job.status)) {
        return;
      }

      this.cleanupPartialFiles(job);
      this.updateJob(jobId, {
        status: 'failed',
        progress: 100,
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      });
    }
  }

  private assertProtectedMusicDownloadAuthorized(job: DownloadJob, options: DownloadJobOptions | undefined): void {
    const protectedMusicProvider = protectedMusicProviderFromDownloadRequest(
      job.sourceUrl,
      options?.webpageUrl ?? job.webpageUrl,
      options?.streamingProvider ?? null,
    );
    if (!protectedMusicProvider) {
      return;
    }

    if (
      !this.isProtectedMusicDownloadAuthorized(options?.downloadAuthorizationToken, {
        provider: protectedMusicProvider,
        providerTrackId: options?.streamingProviderTrackId,
        url: job.sourceUrl,
      })
    ) {
      throw new Error(protectedMusicDownloadBlockedMessage);
    }
  }

  private isProtectedMusicDownloadAuthorized(
    token: string | null | undefined,
    input: {
      provider: ProtectedMusicDownloadProvider;
      providerTrackId: string | null | undefined;
      url: string;
    },
  ): boolean {
    if (verifyDownloadAuthorizationToken(token, input)) {
      return true;
    }

    return this.canBypassProtectedMusicAuthorizationForDevelopment();
  }

  private canBypassProtectedMusicAuthorizationForDevelopment(): boolean {
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      return false;
    }

    try {
      return (this.dependencies.loadAppSettings?.() ?? getAppSettings()).downloadsFeatureUnlocked === true;
    } catch {
      return false;
    }
  }

  private async probe(jobId: string): Promise<void> {
    this.updateJob(jobId, { status: 'probing', progress: 0 });

    const ytDlpPath = this.ytDlpPathResolver();
    if (!ytDlpPath || !existsSync(ytDlpPath)) {
      throw new Error('yt-dlp is not installed with the application');
    }

    const job = this.requireJob(jobId);
    const options = this.jobOptions.get(jobId);
    const command = this.commandRunner(ytDlpPath, [
      ...this.headerArgs(this.ytDlpRequestHeaders(job, options?.requestHeaders ?? {})),
      '--dump-json',
      '--no-playlist',
      job.sourceUrl,
    ]);
    this.runningCommands.set(jobId, command);
    const result = await command.promise;
    if (this.runningCommands.get(jobId) !== command) {
      return;
    }

    this.runningCommands.delete(jobId);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || 'yt-dlp probe failed');
    }

    const metadata = this.parseProbeResult(result.stdout);
    const metadataTitle = metadata.title && metadata.title !== 'Untitled download' ? metadata.title : (options?.suggestedTitle ?? metadata.title);
    const metadataThumbnailUrl = this.normalizeDownloadThumbnailUrl(job.provider, metadata.thumbnailUrl);
    const thumbnailUrl = options?.suggestedCoverUrl ?? metadataThumbnailUrl ?? job.thumbnailUrl;
    if (options && !options.suggestedCoverUrl && metadataThumbnailUrl) {
      this.jobOptions.set(jobId, {
        ...options,
        suggestedCoverUrl: metadataThumbnailUrl,
      });
    }
    this.updateJob(jobId, {
      title: metadataTitle ?? job.title,
      durationSeconds: metadata.durationSeconds,
      thumbnailUrl,
      webpageUrl: options?.webpageUrl ?? metadata.webpageUrl,
    });
  }

  private async download(jobId: string): Promise<void> {
    const job = this.requireJob(jobId);
    const options = this.jobOptions.get(jobId);
    if (options?.directAudio) {
      await this.downloadDirectAudio(jobId, options);
      return;
    }
    if (job.provider === 'osu') {
      await this.downloadOsuBeatmapAudio(jobId);
      return;
    }

    const ytDlpPath = this.ytDlpPathResolver();
    const ffmpegToolchain = this.getFfmpegToolchain();
    const ffmpegPath = ffmpegToolchain.path;
    const outputDirectory = this.getJobOutputDirectory(jobId);

    if (!ytDlpPath || !existsSync(ytDlpPath)) {
      throw new Error('yt-dlp is not installed with the application');
    }

    if (!ffmpegToolchain.healthy) {
      throw new Error('ffmpeg is not available');
    }

    if (!outputDirectory) {
      throw new Error('请选择下载文件夹');
    }

    const args = [
      '--newline',
      '--no-playlist',
      '--no-mtime',
      '--continue',
      ...this.headerArgs(this.ytDlpRequestHeaders(job, this.jobOptions.get(jobId)?.requestHeaders ?? {})),
      '-f',
      'bestaudio/best',
      '--extract-audio',
      '--audio-quality',
      '0',
      ...(ffmpegToolchain.source === 'system' ? [] : ['--ffmpeg-location', dirname(ffmpegPath)]),
      '--paths',
      outputDirectory,
      '-o',
      outputTemplate,
      '--print',
      'after_move:filepath',
      job.sourceUrl,
    ];
    let printedOutputPath: string | null = null;
    const startedAtMs = Date.now();
    const runner = this.dependencies.streamingCommandRunner ?? runStreamingCommand;
    const command = runner(ytDlpPath, args, {
      onStdout: (line) => {
        const maybePath = this.parseOutputPath(line, outputDirectory);
        if (maybePath) {
          printedOutputPath = maybePath;
          this.updateJob(jobId, { outputPath: printedOutputPath });
          return;
        }
        this.handleDownloadLine(jobId, line);
      },
      onStderr: (line) => this.handleDownloadLine(jobId, line),
    });
    this.runningCommands.set(jobId, command);
    this.updateJob(jobId, { status: 'downloading', progress: Math.max(job.progress, 1) });
    const result = await command.promise;
    if (this.runningCommands.get(jobId) !== command) {
      return;
    }

    this.runningCommands.delete(jobId);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || 'yt-dlp download failed');
    }

    const outputPath = printedOutputPath ?? this.findNewestAudioFile(outputDirectory, startedAtMs);
    if (!outputPath) {
      throw new Error('Download finished but no audio file was produced');
    }
    const decodedOutputPath = await getNcmConverter().convertIfNeeded(outputPath);

    this.updateJob(jobId, {
      status: 'extracting_audio',
      outputPath: decodedOutputPath,
      progress: 96,
      downloadedBytes: this.safeFileSize(decodedOutputPath),
    });
  }

  private async downloadOsuBeatmapAudio(jobId: string): Promise<void> {
    const job = this.requireJob(jobId);
    const outputDirectory = this.getJobOutputDirectory(jobId);
    const fetchRunner = this.dependencies.fetch ?? globalThis.fetch;
    const beatmapsetId = parseOsuBeatmapsetId(job.sourceUrl);

    if (!outputDirectory) {
      throw new Error('请选择下载文件夹');
    }
    if (!fetchRunner) {
      throw new Error('fetch is not available for osu! downloads');
    }
    if (!beatmapsetId) {
      throw new Error('osu! download URL must be a beatmapset link');
    }

    const archivePath = this.uniqueOutputPath(outputDirectory, `osu-${beatmapsetId}.osz`);
    const errors: string[] = [];
    this.updateJob(jobId, {
      title: job.title ?? `osu! beatmapset ${beatmapsetId}`,
      outputPath: archivePath,
      status: 'downloading',
      progress: Math.max(job.progress, 1),
    });

    for (const source of this.osuDownloadSources(beatmapsetId)) {
      try {
        const response = await fetchRunner(source.url, { headers: source.headers });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        if (!this.isOsuArchiveResponse(response)) {
          throw new Error(`unexpected response type ${response.headers.get('content-type') ?? 'unknown'}`);
        }

        this.updateJob(jobId, {
          webpageUrl: job.webpageUrl ?? job.sourceUrl,
          outputPath: archivePath,
        });
        await this.writeResponseBodyToFile(jobId, response, archivePath);
        const extracted = await importOsuArchiveAsMp3Queued({
          archivePath,
          outputDirectory,
          beatmapsetId,
          writeEmbeddedTags: false,
        });
        const displayTitle = [extracted.tags.artist, extracted.tags.title].filter(Boolean).join(' - ') || extracted.tags.title || `osu! beatmapset ${beatmapsetId}`;
        const options = this.jobOptions.get(jobId);
        if (options) {
          this.jobOptions.set(jobId, {
            ...options,
            suggestedTitle: extracted.tags.title,
            suggestedArtist: extracted.tags.artist,
            suggestedAlbum: extracted.tags.album,
            suggestedAlbumArtist: extracted.tags.albumArtist,
            suggestedCoverData: extracted.coverData,
            webpageUrl: job.webpageUrl ?? job.sourceUrl,
          });
        }

        this.deleteTempFile(archivePath);
        this.updateJob(jobId, {
          title: displayTitle,
          status: 'extracting_audio',
          outputPath: extracted.outputPath,
          progress: 96,
          downloadedBytes: this.safeFileSize(extracted.outputPath),
          totalBytes: null,
          speedBytesPerSecond: null,
          etaSeconds: null,
        });
        return;
      } catch (error) {
        this.deleteTempFile(archivePath);
        errors.push(`${source.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error(`osu! beatmap download failed: ${errors.join(' | ')}`);
  }

  private osuDownloadSources(beatmapsetId: string): OsuDownloadSource[] {
    const osuCookie = this.getCredentials('osu').cookie?.trim();
    const officialHeaders: Record<string, string> = {
      Accept: osuArchiveAccept,
      Referer: 'https://osu.ppy.sh/',
      'User-Agent': browserUserAgent,
    };
    if (osuCookie) {
      officialHeaders.Cookie = osuCookie;
    }

    const mirrorHeaders: Record<string, string> = {
      Accept: osuArchiveAccept,
      Referer: 'https://sayobot.cn/',
      'User-Agent': osuDownloadUserAgent,
    };

    return [
      {
        label: 'osu! official',
        url: `https://osu.ppy.sh/beatmapsets/${encodeURIComponent(beatmapsetId)}/download?noVideo=1`,
        headers: officialHeaders,
      },
      {
        label: 'Sayobot',
        url: `https://dl.sayobot.cn/beatmaps/download/novideo/${encodeURIComponent(beatmapsetId)}`,
        headers: mirrorHeaders,
      },
      {
        label: 'Catboy',
        url: `https://catboy.best/d/${encodeURIComponent(beatmapsetId)}`,
        headers: mirrorHeaders,
      },
      {
        label: 'NeriNyan',
        url: `https://api.nerinyan.moe/d/${encodeURIComponent(beatmapsetId)}`,
        headers: mirrorHeaders,
      },
    ];
  }

  private isOsuArchiveResponse(response: Response): boolean {
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    const disposition = response.headers.get('content-disposition')?.toLowerCase() ?? '';
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      return false;
    }

    return (
      contentType.length === 0 ||
      contentType.includes('application/x-osu-beatmap-archive') ||
      contentType.includes('application/zip') ||
      contentType.includes('application/octet-stream') ||
      disposition.includes('.osz') ||
      disposition.includes('.zip')
    );
  }

  private async downloadDirectAudio(jobId: string, options: DownloadJobOptions): Promise<void> {
    const job = this.requireJob(jobId);
    const outputDirectory = this.getJobOutputDirectory(jobId);
    const fetchRunner = this.dependencies.fetch ?? globalThis.fetch;
    const requestHeaders = this.directAudioRequestHeaders(job, options);

    if (!outputDirectory) {
      throw new Error('请选择下载文件夹');
    }

    if (!fetchRunner) {
      throw new Error('fetch is not available for direct audio downloads');
    }

    this.updateJob(jobId, { status: 'downloading', progress: Math.max(job.progress, 1) });
    let outputPath = job.outputPath && existsSync(dirname(job.outputPath)) ? job.outputPath : null;
    let existingBytes = outputPath && existsSync(outputPath) ? (this.safeFileSize(outputPath) ?? 0) : 0;
    const resumableHeaders = { ...requestHeaders };
    if (outputPath && existingBytes > 0 && !hasHeader(resumableHeaders, 'Range')) {
      resumableHeaders.Range = `bytes=${existingBytes}-`;
    }

    const response = await fetchRunner(job.sourceUrl, { headers: resumableHeaders });
    if (!response.ok) {
      throw new Error(`Direct audio download failed: HTTP ${response.status}`);
    }
    const shouldAppend = Boolean(outputPath && existingBytes > 0 && response.status === 206);
    if (!shouldAppend) {
      existingBytes = 0;
    }

    const contentType = response.headers.get('content-type');
    const extension =
      options.directAudioExtension ?? extensionFromMimeType(options.directAudioMimeType) ?? extensionFromMimeType(contentType) ?? extensionFromUrl(job.sourceUrl) ?? 'mp3';
    const outputName = [options.suggestedArtist, options.suggestedTitle ?? job.title].filter(Boolean).join(' - ') || 'Streaming audio';
    outputPath ??= this.uniqueOutputPath(outputDirectory, `${sanitizeFilePart(outputName)}.${extension}`);
    const contentLength = Number(response.headers.get('content-length'));
    const totalBytes =
      parseContentRangeTotal(response.headers.get('content-range')) ??
      (Number.isFinite(contentLength) && contentLength > 0 ? contentLength + existingBytes : null);
    this.updateJob(jobId, {
      outputPath,
      downloadedBytes: existingBytes > 0 ? existingBytes : null,
      totalBytes: totalBytes && totalBytes > 0 ? totalBytes : null,
    });

    await this.writeResponseBodyToFile(jobId, response, outputPath, {
      append: shouldAppend,
      initialBytes: existingBytes,
      totalBytesOverride: totalBytes,
    });
    const decodedOutputPath = await getNcmConverter().convertIfNeeded(outputPath);
    this.updateJob(jobId, {
      status: 'extracting_audio',
      outputPath: decodedOutputPath,
      progress: 96,
      downloadedBytes: this.safeFileSize(decodedOutputPath),
    });
  }

  private async writeDownloadedEmbeddedTags(jobId: string): Promise<void> {
    const job = this.requireJob(jobId);
    const options = this.jobOptions.get(jobId);

    if (!job.outputPath || !options) {
      return;
    }

    const hasMetadata =
      Boolean(options.suggestedTitle) ||
      Boolean(options.suggestedArtist) ||
      Boolean(options.suggestedAlbum) ||
      Boolean(options.suggestedAlbumArtist);
    const coverUrl = options.suggestedCoverUrl ?? job.thumbnailUrl;
    const hasCover = Boolean(options.suggestedCoverData) || Boolean(coverUrl);
    if (!hasMetadata && !hasCover) {
      return;
    }

    const coverData = options.suggestedCoverData ?? (coverUrl ? await this.readDownloadCoverImage(coverUrl).catch(() => null) : null);

    try {
      if (!hasMetadata) {
        if (!coverData) {
          return;
        }

        const writeCover = this.dependencies.writeEmbeddedCoverArt ?? writeEmbeddedCoverArt;
        await writeCover({
          filePath: job.outputPath,
          coverData,
        });
        return;
      }

      const writeTags = this.dependencies.writeEmbeddedTrackTags ?? writeEmbeddedTrackTags;
      await writeTags({
        filePath: job.outputPath,
        coverData,
        tags: {
          title: options.suggestedTitle ?? job.title ?? 'Streaming audio',
          artist: options.suggestedArtist ?? 'Unknown Artist',
          album: options.suggestedAlbum ?? 'Unknown Album',
          albumArtist: options.suggestedAlbumArtist ?? options.suggestedArtist ?? 'Unknown Artist',
          trackNo: null,
          discNo: null,
          year: null,
          genre: null,
        },
      });
    } catch (error) {
      this.updateJob(jobId, {
        error: `Embedded tag write failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private async readDownloadCoverImage(url: string): Promise<{ data: Uint8Array; mimeType: string }> {
    const fetchRunner = this.dependencies.fetch ?? globalThis.fetch;
    if (!fetchRunner) {
      throw new Error('fetch is not available for cover downloads');
    }

    let coverUrl = url;
    let referer = 'https://www.bilibili.com/';
    if (url.startsWith('echo-image://remote/')) {
      const proxied = new URL(url);
      coverUrl = decodeURIComponent(proxied.pathname.replace(/^\/+/u, ''));
      referer = proxied.searchParams.get('referer') ?? referer;
    }

    const response = await fetchRunner(coverUrl, {
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*',
        Referer: referer,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });
    if (!response.ok) {
      throw new Error(`Cover download failed: HTTP ${response.status}`);
    }

    const mimeType = supportedCoverMimeType(response.headers.get('content-type')) ?? mimeTypeForCoverUrl(coverUrl);
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      mimeType,
    };
  }

  private async writeResponseBodyToFile(
    jobId: string,
    response: Response,
    outputPath: string,
    options: { append?: boolean; initialBytes?: number; totalBytesOverride?: number | null } = {},
  ): Promise<void> {
    const writer = createWriteStream(outputPath, { flags: options.append ? 'a' : 'w' });
    let downloadedBytes = options.initialBytes ?? 0;
    const totalBytes = options.totalBytesOverride ?? Number(response.headers.get('content-length'));
    const safeTotalBytes = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : null;

    try {
      if (!response.body) {
        const buffer = Buffer.from(await response.arrayBuffer());
        writer.write(buffer);
        downloadedBytes += buffer.byteLength;
        this.updateJob(
          jobId,
          {
            status: 'downloading',
            progress: safeTotalBytes ? Math.min(95, Math.max(1, (downloadedBytes / safeTotalBytes) * 95)) : Math.max(1, this.requireJob(jobId).progress),
            downloadedBytes,
            totalBytes: safeTotalBytes,
          },
          false,
        );
      } else {
        const reader = response.body.getReader();
        try {
          let reading = true;
          while (reading) {
            const { done, value } = await reader.read();
            if (done) {
              reading = false;
              break;
            }

            const chunk = Buffer.from(value);
            downloadedBytes += chunk.byteLength;
            if (!writer.write(chunk)) {
              await new Promise<void>((resolveDrain, rejectDrain) => {
                writer.once('drain', resolveDrain);
                writer.once('error', rejectDrain);
              });
            }

            this.updateJob(
              jobId,
              {
                status: 'downloading',
                progress: safeTotalBytes ? Math.min(95, Math.max(1, (downloadedBytes / safeTotalBytes) * 95)) : Math.max(1, this.requireJob(jobId).progress),
                downloadedBytes,
                totalBytes: safeTotalBytes,
              },
              false,
            );
          }
        } finally {
          reader.releaseLock();
        }
      }
    } catch (error) {
      writer.destroy();
      throw error;
    }

    await new Promise<void>((resolveFinish, rejectFinish) => {
      writer.once('finish', resolveFinish);
      writer.once('error', rejectFinish);
      writer.end();
    });
  }

  private directAudioRequestHeaders(job: DownloadJob, options: DownloadJobOptions): Record<string, string> {
    const headers = { ...options.requestHeaders };
    const url = `${job.webpageUrl ?? ''} ${job.sourceUrl}`.toLocaleLowerCase();
    const provider: Extract<AccountProvider, 'netease' | 'qqmusic' | 'kugou' | 'soundcloud'> | null =
      url.includes('music.163.com') || url.includes('music.126.net')
        ? 'netease'
        : url.includes('y.qq.com') || url.includes('qqmusic.qq.com') || url.includes('gtimg.cn')
          ? 'qqmusic'
          : url.includes('kugou.com') || url.includes('kugoucdn.com') || url.includes('kgimg.com')
            ? 'kugou'
            : url.includes('soundcloud.com') || url.includes('sndcdn.com') || url.includes('soundcloud.cloud')
              ? 'soundcloud'
              : null;

    if (!hasHeader(headers, 'User-Agent')) {
      headers['User-Agent'] =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    }

    if (provider === 'netease') {
      if (!hasHeader(headers, 'Referer')) {
        headers.Referer = 'https://music.163.com/';
      }
      if (!hasHeader(headers, 'Origin')) {
        headers.Origin = 'https://music.163.com';
      }
    } else if (provider === 'qqmusic') {
      if (!hasHeader(headers, 'Referer')) {
        headers.Referer = 'https://y.qq.com/';
      }
      if (!hasHeader(headers, 'Origin')) {
        headers.Origin = 'https://y.qq.com';
      }
    } else if (provider === 'kugou') {
      if (!hasHeader(headers, 'Referer')) {
        headers.Referer = 'https://www.kugou.com/';
      }
      if (!hasHeader(headers, 'Origin')) {
        headers.Origin = 'https://www.kugou.com';
      }
    } else if (provider === 'soundcloud') {
      if (!hasHeader(headers, 'Referer')) {
        headers.Referer = 'https://soundcloud.com/';
      }
    }

    if (provider && !hasHeader(headers, 'Cookie')) {
      const cookie = this.getCredentials(provider).cookie?.trim();
      if (cookie) {
        headers.Cookie = cookie;
      }
    }

    return headers;
  }

  private ytDlpRequestHeaders(job: DownloadJob, requestHeaders: Record<string, string>): Record<string, string> {
    const headers = { ...requestHeaders };
    if (job.provider !== 'soundcloud') {
      return headers;
    }

    if (!hasHeader(headers, 'User-Agent')) {
      headers['User-Agent'] = browserUserAgent;
    }
    if (!hasHeader(headers, 'Referer')) {
      headers.Referer = 'https://soundcloud.com/';
    }
    if (!hasHeader(headers, 'Cookie')) {
      const cookie = this.getCredentials('soundcloud').cookie?.trim();
      if (cookie) {
        headers.Cookie = cookie;
      }
    }

    return headers;
  }

  private async importAndBind(jobId: string, optionsOverride: { emitProgress?: boolean } = {}): Promise<void> {
    const emitProgress = optionsOverride.emitProgress !== false;
    const job = this.jobs.find((item) => item.id === jobId);
    if (!job) {
      throw new Error(`Unknown download job ${jobId}`);
    }
    if (terminalStatuses.has(job.status) && (job.status !== 'completed' || job.importedTrackId)) {
      throw new Error(`Download job ${jobId} is no longer active`);
    }
    const options = this.jobOptions.get(jobId) ?? {
      importToLibrary: this.settings.importToLibrary,
      bindMvAfterImport: this.settings.bindMvAfterImport,
      outputDirectory: this.settings.outputDirectory ?? (job.outputPath ? dirname(job.outputPath) : ''),
      requestHeaders: {},
      suggestedTitle: null,
      suggestedArtist: null,
      suggestedAlbum: null,
      suggestedAlbumArtist: null,
      suggestedCoverUrl: null,
      suggestedCoverData: null,
      webpageUrl: null,
      directAudio: false,
      directAudioMimeType: null,
      directAudioExtension: null,
      streamingProvider: null,
      streamingProviderTrackId: null,
      streamingStableKey: null,
      downloadAuthorizationToken: null,
    };

    if (!options.importToLibrary) {
      return;
    }

    if (!job.outputPath) {
      throw new Error('Download output path is unavailable for import');
    }

    if (emitProgress) {
      this.updateJob(jobId, { status: 'importing', progress: 98 });
    }
    const importFolderPath = options.outputDirectory || dirname(job.outputPath);
    this.ensureOutputDirectoryInLibrary(importFolderPath);
    const importAudioFile = this.dependencies.importAudioFile ?? ((filePath, importOptions) => getLibraryService().importAudioFile(filePath, importOptions));
    const hasSuggestedMetadata =
      Boolean(options.suggestedTitle) ||
      Boolean(options.suggestedArtist) ||
      Boolean(options.suggestedAlbum) ||
      Boolean(options.suggestedAlbumArtist);
    const coverUrl = options.suggestedCoverUrl ?? job.thumbnailUrl;
    const track = await importAudioFile(job.outputPath, {
      folderPath: importFolderPath,
      metadata: hasSuggestedMetadata
        ? {
            title: options.suggestedTitle ?? undefined,
            artist: options.suggestedArtist ?? undefined,
            album: options.suggestedAlbum ?? undefined,
            albumArtist: options.suggestedAlbumArtist ?? options.suggestedArtist ?? undefined,
          }
        : undefined,
      coverUrl: coverUrl ?? undefined,
    });
    this.updateJob(jobId, { importedTrackId: track.id });
    if (options.streamingProvider && options.streamingProviderTrackId) {
      const linkDownloadedStreamingTrack =
        this.dependencies.linkDownloadedStreamingTrack ??
        ((input) => getLibraryService().linkDownloadedStreamingTrack(input));
      linkDownloadedStreamingTrack({
        provider: options.streamingProvider,
        providerTrackId: options.streamingProviderTrackId,
        stableKey: options.streamingStableKey,
        trackId: track.id,
      });
    }

    if (!options.bindMvAfterImport) {
      return;
    }

    if (emitProgress) {
      this.updateJob(jobId, { status: 'binding_mv', progress: 99 });
    }
    const bindMvUrl = this.dependencies.bindMvUrl ?? ((trackId, url) => getMvService().bindUrl(trackId, url));
    try {
      bindMvUrl(track.id, job.webpageUrl ?? job.sourceUrl);
    } catch {
      // MV binding is an optional follow-up; a bad source URL must not undo a successful audio import.
    }
  }

  private handleDownloadLine(jobId: string, line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    if (trimmed.startsWith('[ExtractAudio]') || trimmed.includes('Extracting audio')) {
      this.updateJob(jobId, { status: 'extracting_audio', progress: Math.max(this.requireJob(jobId).progress, 95) });
      return;
    }

    const progress = this.parseDownloadProgress(trimmed);
    if (!progress) {
      return;
    }

    this.updateJob(
      jobId,
      {
        status: 'downloading',
        progress: progress.percent,
        downloadedBytes: progress.downloadedBytes,
        totalBytes: progress.totalBytes,
        speedBytesPerSecond: progress.speedBytesPerSecond,
        etaSeconds: progress.etaSeconds,
      },
      false,
    );
  }

  private headerArgs(headers: Record<string, string>): string[] {
    return Object.entries(headers).flatMap(([name, value]) => ['--add-header', `${name}: ${value}`]);
  }

  private updateJob(jobId: string, patch: Partial<DownloadJob>, immediate = true): void {
    this.jobs = this.jobs.map((job) =>
      job.id === jobId
        ? {
            ...job,
            ...patch,
            progress: Math.max(0, Math.min(100, patch.progress ?? job.progress)),
            updatedAt: new Date().toISOString(),
          }
        : job,
    );

    if (immediate || terminalStatuses.has(patch.status as DownloadJobStatus)) {
      this.emitJobsNow();
      return;
    }

    const now = Date.now();
    const lastEmitAt = this.lastProgressEmitAt.get(jobId) ?? 0;
    if (now - lastEmitAt >= progressEmitIntervalMs) {
      this.lastProgressEmitAt.set(jobId, now);
      this.emitJobsNow();
    }
  }

  private emitJobsNow(): void {
    this.persistJobs();
    this.emit('jobs-updated', this.getJobs());
  }

  private persistJobs(): void {
    const jobOptions: Record<string, PersistedDownloadJobOptions> = {};
    for (const [jobId, options] of this.jobOptions.entries()) {
      jobOptions[jobId] = {
        ...options,
        suggestedCoverData: null,
      };
    }

    try {
      (this.dependencies.saveJobs ?? savePersistedDownloadState)({
        version: 1,
        jobs: this.getJobs(),
        jobOptions,
      });
    } catch {
      // Download progress must keep flowing even if the small resume-state file is temporarily unavailable.
    }
  }

  private clearCommand(jobId: string): void {
    const command = this.runningCommands.get(jobId);

    if (command) {
      command.kill();
      this.runningCommands.delete(jobId);
    }
  }

  private requireJob(jobId: string): DownloadJob {
    const job = this.jobs.find((item) => item.id === jobId);

    if (!job) {
      throw new Error(`Unknown download job ${jobId}`);
    }

    if (terminalStatuses.has(job.status)) {
      throw new Error(`Download job ${jobId} is no longer active`);
    }

    return job;
  }

  private getJobOutputDirectory(jobId: string): string | null {
    return this.jobOptions.get(jobId)?.outputDirectory ?? this.settings.outputDirectory;
  }

  private parseProbeResult(stdout: string): Pick<DownloadJob, 'title' | 'durationSeconds' | 'thumbnailUrl' | 'webpageUrl'> {
    try {
      const parsed = JSON.parse(stdout) as YtDlpProbeResult;
      const duration = Number(parsed.duration);

      return {
        title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : 'Untitled download',
        durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
        thumbnailUrl: this.thumbnailFromEntry(parsed as YtDlpSearchEntry),
        webpageUrl: typeof parsed.webpage_url === 'string' && parsed.webpage_url.trim() ? parsed.webpage_url.trim() : null,
      };
    } catch {
      return {
        title: 'Untitled download',
        durationSeconds: null,
        thumbnailUrl: null,
        webpageUrl: null,
      };
    }
  }

  private parseDownloadProgress(line: string): {
    percent: number;
    downloadedBytes: number | null;
    totalBytes: number | null;
    speedBytesPerSecond: number | null;
    etaSeconds: number | null;
  } | null {
    const percentMatch = line.match(/\[download\]\s+([0-9.]+)%/u);
    if (!percentMatch) {
      return null;
    }

    const downloadedMatch = line.match(/\[download\]\s+([0-9.]+\s*[A-Za-z]+)\s+of\s+~?[0-9.]+\s*[A-Za-z]+/u);
    const totalMatch = line.match(/\bof\s+~?([0-9.]+\s*[A-Za-z]+)\b/u);
    const prefixMatch = line.match(/%\s+of\s+~?([0-9.]+\s*[A-Za-z]+)\s+at/u);
    const speedMatch = line.match(/\bat\s+([0-9.]+\s*[A-Za-z]+\/s)/u);
    const etaMatch = line.match(/\bETA\s+([0-9:]+)/u);
    const percent = Number(percentMatch[1]);

    const totalBytes = this.parseByteText(totalMatch?.[1] ?? prefixMatch?.[1] ?? null);
    const downloadedBytes = this.parseByteText(downloadedMatch?.[1] ?? null) ?? (totalBytes ? Math.round((totalBytes * percent) / 100) : null);

    return {
      percent: Number.isFinite(percent) ? percent : 0,
      downloadedBytes,
      totalBytes,
      speedBytesPerSecond: this.parseByteText(speedMatch?.[1]?.replace(/\/s$/u, '') ?? null),
      etaSeconds: this.parseEta(etaMatch?.[1] ?? null),
    };
  }

  private parseByteText(value: string | null): number | null {
    if (!value) {
      return null;
    }

    const match = value.trim().match(/^([0-9.]+)\s*([KMGTPE]?i?B)$/iu);
    if (!match) {
      return null;
    }

    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) {
      return null;
    }

    const unit = match[2].toLowerCase();
    const factor =
      unit === 'kb'
        ? 1000
        : unit === 'mb'
          ? 1000 ** 2
          : unit === 'gb'
            ? 1000 ** 3
            : unit === 'kib'
              ? 1024
              : unit === 'mib'
                ? 1024 ** 2
                : unit === 'gib'
                  ? 1024 ** 3
                  : 1;

    return Math.round(amount * factor);
  }

  private parseEta(value: string | null): number | null {
    if (!value) {
      return null;
    }

    const parts = value.split(':').map((part) => Number(part));
    if (parts.some((part) => !Number.isFinite(part))) {
      return null;
    }

    return parts.reduce((total, part) => total * 60 + part, 0);
  }

  private parseOutputPath(line: string, outputDirectory: string): string | null {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }

    const candidate = resolve(trimmed);
    const relativePath = relative(resolve(outputDirectory), candidate);
    if (relativePath.startsWith('..') || relativePath === '' || candidate.endsWith('.part')) {
      return null;
    }

    return existsSync(candidate) && this.isSupportedAudioPath(candidate) ? candidate : null;
  }

  private findNewestAudioFile(outputDirectory: string, startedAtMs: number): string | null {
    const entries = readdirSync(outputDirectory)
      .map((entry) => resolve(outputDirectory, entry))
      .filter((entryPath) => {
        try {
          const entryStat = statSync(entryPath);
          return entryStat.isFile() && entryStat.mtimeMs >= startedAtMs - 1000 && this.isSupportedAudioPath(entryPath);
        } catch {
          return false;
        }
      })
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

    return entries[0] ?? null;
  }

  private uniqueOutputPath(outputDirectory: string, fileName: string): string {
    const parsed = fileName.match(/^(.*?)(\.[^.]+)$/u);
    const baseName = parsed?.[1] ?? fileName;
    const extension = parsed?.[2] ?? '';
    let candidate = resolve(outputDirectory, fileName);
    let suffix = 2;

    while (existsSync(candidate)) {
      candidate = resolve(outputDirectory, `${baseName} (${suffix})${extension}`);
      suffix += 1;
    }

    return candidate;
  }

  private isSupportedAudioPath(filePath: string): boolean {
    return isSupportedAudioExtension(filePath);
  }

  private ensureOutputDirectoryInLibrary(outputDirectory: string | null): void {
    if (!outputDirectory) {
      return;
    }

    try {
      const normalizedPath = resolve(outputDirectory);
      if (!existsSync(normalizedPath) || !statSync(normalizedPath).isDirectory()) {
        return;
      }

      const addLibraryFolder = this.dependencies.addLibraryFolder ?? ((folderPath: string) => getLibraryService().addFolder(folderPath));
      addLibraryFolder(normalizedPath);
    } catch {
      // Downloading should not fail just because the library index is temporarily unavailable.
    }
  }

  private prepareJobOutputDirectory(baseOutputDirectory: string, outputSubdirectory: unknown): string {
    const folderName = sanitizeOutputSubdirectory(outputSubdirectory);
    if (!folderName) {
      return baseOutputDirectory;
    }

    const normalizedBase = resolve(baseOutputDirectory);
    const outputDirectory = resolve(normalizedBase, folderName);
    const relativePath = relative(normalizedBase, outputDirectory);
    if (relativePath === '..' || relativePath.startsWith('..\\') || relativePath.startsWith('../') || relativePath === '') {
      throw new Error(`Invalid download subfolder: ${folderName}`);
    }

    mkdirSync(outputDirectory, { recursive: true });
    if (!statSync(outputDirectory).isDirectory()) {
      throw new Error(`Download subfolder is not available: ${outputDirectory}`);
    }

    return outputDirectory;
  }

  private safeFileSize(filePath: string): number | null {
    try {
      return statSync(filePath).size;
    } catch {
      return null;
    }
  }

  private cleanupPartialFiles(job: DownloadJob): void {
    const outputDirectory = this.jobOptions.get(job.id)?.outputDirectory ?? this.settings.outputDirectory;
    if (!outputDirectory || !existsSync(outputDirectory)) {
      return;
    }

    const jobIdMatch = job.outputPath?.match(/\[([^\]]+)\]\.[^.]+$/u)?.[1] ?? null;
    const createdAtMs = Date.parse(job.createdAt);
    for (const entry of readdirSync(outputDirectory)) {
      const entryPath = join(outputDirectory, entry);
      const entryStat = statSync(entryPath);
      const isRecentPartial =
        Number.isFinite(createdAtMs) &&
        entryStat.isFile() &&
        entryStat.mtimeMs >= createdAtMs - 1000 &&
        (entry.endsWith('.part') || entry.endsWith('.ytdl'));
      const isJobOutput =
        Boolean(job.outputPath) && resolve(entryPath) === resolve(job.outputPath ?? '') && Number.isFinite(createdAtMs) && entryStat.mtimeMs >= createdAtMs - 1000;
      const shouldDelete = isJobOutput || isRecentPartial || (jobIdMatch ? entry.includes(`[${jobIdMatch}]`) && !this.isSupportedAudioPath(entryPath) : false);
      if (shouldDelete) {
        rmSync(entryPath, { force: true, recursive: true, maxRetries: 3, retryDelay: 50 });
      }
    }
  }

  private getFfmpegToolchain(): FfmpegToolchainInfo {
    return resolveFfmpegToolchain();
  }
}

let downloadService: DownloadService | null = null;

export const getDownloadService = (): DownloadService => {
  downloadService ??= new DownloadService();
  return downloadService;
};
