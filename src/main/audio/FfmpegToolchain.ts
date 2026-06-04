import { existsSync as nodeExistsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync as nodeExecFileSync } from 'node:child_process';

export type FfmpegToolchainSource = 'explicit' | 'bundled' | 'dev-bundled' | 'system';

export type FfmpegToolchainInfo = {
  path: string;
  source: FfmpegToolchainSource;
  version: string | null;
  healthy: boolean;
  soxrAvailable: boolean;
  aresampleAvailable: boolean;
  buildConfiguration: string | null;
  manifestVersion: string | null;
  error: string | null;
};

export type FfmpegToolchainDependencies = {
  ffmpegPath?: string | null;
  env?: NodeJS.ProcessEnv;
  systemFfmpegPath?: string | null;
  resourcesPath?: string | null;
  platform?: NodeJS.Platform;
  cwd?: string;
  existsSync?: (path: string) => boolean;
  execFileSync?: typeof nodeExecFileSync;
  logger?: (message: string) => void;
  requireHealthy?: boolean;
};

type FfmpegCandidate = {
  path: string;
  source: FfmpegToolchainSource;
  mustExist: boolean;
};

type FfmpegManifest = {
  version?: unknown;
};

const toolchainCache = new Map<string, FfmpegToolchainInfo>();

const normalizePath = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

export const normalizeAsarUnpackedPath = (path: string): string =>
  path.includes('app.asar') && !path.includes('app.asar.unpacked')
    ? path.replace('app.asar', 'app.asar.unpacked')
    : path;

const getResourcesPath = (dependencies: FfmpegToolchainDependencies): string | null => {
  const explicit = normalizePath(dependencies.resourcesPath);
  if (explicit) {
    return explicit;
  }

  const processResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return normalizePath(processResourcesPath);
};

const readManifestVersion = (ffmpegPath: string): string | null => {
  try {
    const manifestPath = join(dirname(ffmpegPath), 'ffmpeg-manifest.json');
    if (!nodeExistsSync(manifestPath)) {
      return null;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as FfmpegManifest;
    return typeof manifest.version === 'string' && manifest.version.trim() ? manifest.version.trim() : null;
  } catch {
    return null;
  }
};

const collectCandidates = (dependencies: FfmpegToolchainDependencies = {}): FfmpegCandidate[] => {
  const env = dependencies.env ?? process.env;
  const resourcesPath = getResourcesPath(dependencies);
  const cwd = dependencies.cwd ?? process.cwd();
  const platform = dependencies.platform ?? process.platform;
  const executableName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const systemPath = normalizePath(dependencies.systemFfmpegPath) ?? 'ffmpeg';
  const candidates: Array<FfmpegCandidate | null> = [
    normalizePath(dependencies.ffmpegPath)
      ? { path: normalizeAsarUnpackedPath(normalizePath(dependencies.ffmpegPath) as string), source: 'explicit', mustExist: false }
      : null,
    normalizePath(env.ECHO_FFMPEG_PATH)
      ? { path: normalizeAsarUnpackedPath(normalizePath(env.ECHO_FFMPEG_PATH) as string), source: 'explicit', mustExist: false }
      : null,
    resourcesPath
      ? { path: resolve(resourcesPath, 'tools', executableName), source: 'bundled', mustExist: true }
      : null,
    platform !== 'win32'
      ? { path: resolve(cwd, 'electron-app', 'tools-linux', executableName), source: 'dev-bundled', mustExist: true }
      : null,
    { path: resolve(cwd, 'electron-app', 'tools', executableName), source: 'dev-bundled', mustExist: true },
    { path: systemPath, source: 'system', mustExist: false },
  ];

  const seen = new Set<string>();
  return candidates.filter((candidate): candidate is FfmpegCandidate => {
    if (!candidate || seen.has(candidate.path)) {
      return false;
    }

    seen.add(candidate.path);
    return true;
  });
};

const parseVersion = (output: string): string | null => {
  const firstLine = output.split(/\r?\n/u).find((line) => line.trim().length > 0) ?? '';
  const match = firstLine.match(/^ffmpeg version\s+([^\s]+)/iu);
  return match?.[1] ?? null;
};

const parseBuildConfiguration = (output: string): string | null => {
  const match = output.match(/configuration:\s*(.+)/iu);
  return match?.[1]?.trim() ?? null;
};

const hasAresampleFilter = (output: string): boolean => /(^|\n)\s*\.{2,3}\s+aresample\s+/iu.test(output);

const inspectCandidate = (
  candidate: FfmpegCandidate,
  dependencies: FfmpegToolchainDependencies,
): FfmpegToolchainInfo => {
  const cacheKey = `${candidate.source}:${candidate.path}`;
  const cached = toolchainCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const execFileSync = dependencies.execFileSync ?? nodeExecFileSync;
  try {
    const versionOutput = execFileSync(candidate.path, ['-hide_banner', '-version'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    }) as string;
    const filtersOutput = execFileSync(candidate.path, ['-hide_banner', '-filters'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    }) as string;
    const buildConfiguration = parseBuildConfiguration(versionOutput);
    const info: FfmpegToolchainInfo = {
      path: candidate.path,
      source: candidate.source,
      version: parseVersion(versionOutput),
      healthy: true,
      soxrAvailable: Boolean(buildConfiguration?.includes('--enable-libsoxr')) && hasAresampleFilter(filtersOutput),
      aresampleAvailable: hasAresampleFilter(filtersOutput),
      buildConfiguration,
      manifestVersion: readManifestVersion(candidate.path),
      error: null,
    };
    toolchainCache.set(cacheKey, info);
    return info;
  } catch (error) {
    const info: FfmpegToolchainInfo = {
      path: candidate.path,
      source: candidate.source,
      version: null,
      healthy: false,
      soxrAvailable: false,
      aresampleAvailable: false,
      buildConfiguration: null,
      manifestVersion: readManifestVersion(candidate.path),
      error: error instanceof Error ? error.message : String(error),
    };
    toolchainCache.set(cacheKey, info);
    return info;
  }
};

export const resolveFfmpegToolchain = (dependencies: FfmpegToolchainDependencies = {}): FfmpegToolchainInfo => {
  const existsSync = dependencies.existsSync ?? nodeExistsSync;
  const requireHealthy = dependencies.requireHealthy !== false;
  const candidates = collectCandidates(dependencies);
  let firstUnhealthy: FfmpegToolchainInfo | null = null;

  for (const candidate of candidates) {
    if (candidate.mustExist && !existsSync(candidate.path)) {
      continue;
    }

    if (!requireHealthy) {
      return {
        path: candidate.path,
        source: candidate.source,
        version: null,
        healthy: true,
        soxrAvailable: false,
        aresampleAvailable: false,
        buildConfiguration: null,
        manifestVersion: readManifestVersion(candidate.path),
        error: null,
      };
    }

    const info = inspectCandidate(candidate, dependencies);
    if (info.healthy) {
      return info;
    }

    firstUnhealthy ??= info;
  }

  return firstUnhealthy ?? {
    path: 'ffmpeg',
    source: 'system',
    version: null,
    healthy: false,
    soxrAvailable: false,
    aresampleAvailable: false,
    buildConfiguration: null,
    manifestVersion: null,
    error: 'ffmpeg_missing',
  };
};

export const resolveFfmpegToolchainPath = (dependencies: FfmpegToolchainDependencies = {}): string =>
  resolveFfmpegToolchain({ ...dependencies, requireHealthy: dependencies.requireHealthy ?? false }).path;

export const clearFfmpegToolchainCache = (): void => {
  toolchainCache.clear();
};
