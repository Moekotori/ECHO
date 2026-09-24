import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app, dialog, shell } from 'electron';
import { unzipSync } from 'fflate';
import { hasPortableExecutableHeader } from './fileHeader';
import {
  windowsAudioRuntimeComponentId,
  type RuntimeAudioComponentImportResult,
  type RuntimeAudioComponentStatus,
} from '../../shared/types/runtimeComponents';

const componentManifestName = 'echo-component.json';
const componentSignatureName = 'echo-component.sig';
const audioComponentDownloadPageUrl = 'https://github.com/moekotori/echo/releases/latest';
const maxComponentArchiveBytes = 512 * 1024 * 1024;
const maxComponentInstalledBytes = 512 * 1024 * 1024;

export const audioRuntimeComponentFiles = [
  'echo-audio-host.exe',
  'avcodec-62.dll',
  'avformat-62.dll',
  'avutil-60.dll',
  'swresample-6.dll',
  'tools/ffmpeg.exe',
  'tools/ffmpeg-manifest.json',
] as const;

type RuntimeComponentFile = {
  path: string;
  sha256: string;
  size: number;
};

export type RuntimeComponentManifest = {
  schemaVersion: 1;
  componentId: typeof windowsAudioRuntimeComponentId;
  version: string;
  platform: 'win32';
  arch: 'x64';
  generatedAt: string;
  files: RuntimeComponentFile[];
};

type RuntimeComponentServiceDependencies = {
  rootDirectory: () => string;
  choosePackage: () => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
  bundledDirectory?: () => string | null;
  bundledVersion?: () => string | null;
  publicKeyPem?: string;
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
};

export const canonicalizeRuntimeComponentManifest = (manifest: RuntimeComponentManifest): string =>
  stableStringify({
    arch: manifest.arch,
    componentId: manifest.componentId,
    files: [...manifest.files]
      .map((file) => ({ path: file.path, sha256: file.sha256, size: file.size }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    generatedAt: manifest.generatedAt,
    platform: manifest.platform,
    schemaVersion: manifest.schemaVersion,
    version: manifest.version,
  });

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const sha256File = (filePath: string): Promise<string> => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('error', reject);
  stream.on('end', () => resolve(hash.digest('hex')));
});
const normalizeArchivePath = (value: string): string => value.replace(/\\/gu, '/').replace(/^\.\//u, '');
const currentComponentDirectory = (root: string): string => join(root, windowsAudioRuntimeComponentId, 'current');

const isSafeComponentPath = (value: string): boolean =>
  !value.startsWith('/') &&
  !/^[a-z]:/iu.test(value) &&
  !value.split('/').some((part) => part === '..' || part === '');

const parseManifest = (raw: Uint8Array): RuntimeComponentManifest => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw).toString('utf8'));
  } catch {
    throw new Error('组件清单不是有效的 JSON。');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('组件清单格式无效。');
  }

  const manifest = parsed as Partial<RuntimeComponentManifest>;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.componentId !== windowsAudioRuntimeComponentId ||
    manifest.platform !== 'win32' ||
    manifest.arch !== 'x64' ||
    typeof manifest.version !== 'string' ||
    !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u.test(manifest.version) ||
    typeof manifest.generatedAt !== 'string' ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error('组件清单与当前 Windows x64 音频运行时不匹配。');
  }

  const expectedPaths = new Set<string>(audioRuntimeComponentFiles);
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file !== 'object' ||
      typeof file.path !== 'string' ||
      !expectedPaths.has(file.path) ||
      seen.has(file.path) ||
      typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(file.sha256) ||
      !Number.isSafeInteger(file.size) ||
      file.size <= 0
    ) {
      throw new Error('组件文件清单包含无效或重复的文件。');
    }
    seen.add(file.path);
    totalBytes += file.size;
  }

  if (seen.size !== expectedPaths.size || [...expectedPaths].some((path) => !seen.has(path))) {
    throw new Error('组件包缺少播放所需文件。');
  }
  if (totalBytes > maxComponentInstalledBytes) {
    throw new Error('组件解压后超过允许的大小。');
  }

  return manifest as RuntimeComponentManifest;
};

const verifyPayload = (manifest: RuntimeComponentManifest, entries: Record<string, Uint8Array>): void => {
  for (const file of manifest.files) {
    const bytes = entries[file.path];
    if (!bytes || bytes.byteLength !== file.size || sha256(bytes) !== file.sha256) {
      throw new Error(`组件文件校验失败：${file.path}`);
    }
  }
};

const readInstalledManifest = async (directory: string): Promise<RuntimeComponentManifest> => {
  const manifestBytes = await readFile(join(directory, componentManifestName));
  const manifest = parseManifest(manifestBytes);

  for (const file of manifest.files) {
    const filePath = join(directory, ...file.path.split('/'));
    const info = await stat(filePath);
    if (!info.isFile() || info.size !== file.size || await sha256File(filePath) !== file.sha256) {
      throw new Error(`已安装组件文件不完整：${file.path}`);
    }
  }
  return manifest;
};

const readCompleteInstalledManifestSync = (directory: string): RuntimeComponentManifest | null => {
  try {
    const manifest = parseManifest(readFileSync(join(directory, componentManifestName)));
    for (const file of manifest.files) {
      const info = statSync(join(directory, ...file.path.split('/')));
      if (!info.isFile() || info.size !== file.size) {
        return null;
      }
    }
    return manifest;
  } catch {
    return null;
  }
};

const isBundledAudioRuntimeComplete = (directory: string | null | undefined): boolean => {
  if (!directory) {
    return false;
  }
  try {
    return audioRuntimeComponentFiles.every((relativePath) => {
      const filePath = join(directory, ...relativePath.split('/'));
      const info = statSync(filePath);
      if (!info.isFile() || info.size <= 0) {
        return false;
      }
      if (!/\.(?:exe|dll)$/iu.test(relativePath)) {
        return true;
      }
      return hasPortableExecutableHeader(filePath);
    });
  } catch {
    return false;
  }
};

export const getRuntimeAudioComponentRoot = (userDataPath: string): string =>
  join(userDataPath, 'runtime-components');

export const resolveInstalledAudioRuntimeHost = (
  userDataPath: string | null | undefined,
  _legacyPublicKeyPem?: string,
): string | null => {
  if (!userDataPath) {
    return null;
  }
  const directory = currentComponentDirectory(getRuntimeAudioComponentRoot(userDataPath));
  if (!readCompleteInstalledManifestSync(directory)) {
    return null;
  }
  const host = join(directory, 'echo-audio-host.exe');
  return hasPortableExecutableHeader(host) ? host : null;
};

export const resolveInstalledAudioRuntimeFfmpeg = (
  userDataPath: string | null | undefined,
  _legacyPublicKeyPem?: string,
): string | null => {
  if (!userDataPath) {
    return null;
  }
  const directory = currentComponentDirectory(getRuntimeAudioComponentRoot(userDataPath));
  if (!readCompleteInstalledManifestSync(directory)) {
    return null;
  }
  const ffmpeg = join(
    directory,
    'tools',
    'ffmpeg.exe',
  );
  return existsSync(ffmpeg) ? ffmpeg : null;
};

export class RuntimeComponentService {
  constructor(private readonly dependencies: RuntimeComponentServiceDependencies) {}

  async getAudioComponentStatus(): Promise<RuntimeAudioComponentStatus> {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      return this.createStatus('unsupported', null, '当前平台不使用 Windows x64 音频组件。');
    }

    if (isBundledAudioRuntimeComplete(this.dependencies.bundledDirectory?.())) {
      return this.createStatus('installed', this.dependencies.bundledVersion?.() ?? null, null);
    }

    const directory = currentComponentDirectory(this.dependencies.rootDirectory());
    if (!existsSync(directory)) {
      return this.createStatus('missing', null, null);
    }

    try {
      const manifest = await readInstalledManifest(directory);
      return this.createStatus('installed', manifest.version, null);
    } catch (error) {
      return this.createStatus('invalid', null, error instanceof Error ? error.message : String(error));
    }
  }

  async importAudioComponent(): Promise<RuntimeAudioComponentImportResult> {
    const packagePath = await this.dependencies.choosePackage();
    if (!packagePath) {
      return { outcome: 'cancelled', status: await this.getAudioComponentStatus() };
    }

    const archiveInfo = await stat(packagePath);
    if (!archiveInfo.isFile() || archiveInfo.size <= 0 || archiveInfo.size > maxComponentArchiveBytes) {
      throw new Error('组件包大小无效或超过 512 MiB 限制。');
    }

    const allowedPaths = new Set<string>([
      componentManifestName,
      componentSignatureName,
      ...audioRuntimeComponentFiles,
    ]);
    let installedBytes = 0;
    const entries = unzipSync(await readFile(packagePath), {
      filter: (entry) => {
        const path = normalizeArchivePath(entry.name);
        if (!isSafeComponentPath(path) || !allowedPaths.has(path)) {
          throw new Error(`组件包包含不允许的路径：${entry.name}`);
        }
        installedBytes += entry.originalSize;
        if (installedBytes > maxComponentInstalledBytes) {
          throw new Error('组件解压后超过 512 MiB 限制。');
        }
        return true;
      },
    });

    const manifestBytes = entries[componentManifestName];
    if (!manifestBytes) {
      throw new Error('组件包缺少清单。');
    }
    const manifest = parseManifest(manifestBytes);
    verifyPayload(manifest, entries);

    const root = this.dependencies.rootDirectory();
    const componentRoot = join(root, windowsAudioRuntimeComponentId);
    const current = join(componentRoot, 'current');
    const staging = join(componentRoot, `.installing-${process.pid}-${Date.now()}`);
    const backup = join(componentRoot, `.previous-${process.pid}-${Date.now()}`);
    await mkdir(staging, { recursive: true });

    try {
      for (const [path, bytes] of Object.entries(entries)) {
        const target = join(staging, ...path.split('/'));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes);
      }
      await readInstalledManifest(staging);

      if (existsSync(current)) {
        await rename(current, backup);
      }
      try {
        await rename(staging, current);
      } catch (error) {
        if (existsSync(backup) && !existsSync(current)) {
          await rename(backup, current);
        }
        throw error;
      }
      await rm(backup, { recursive: true, force: true });
    } finally {
      await rm(staging, { recursive: true, force: true });
    }

    return { outcome: 'installed', status: this.createStatus('installed', manifest.version, null) };
  }

  async openAudioComponentDownloadPage(): Promise<void> {
    await this.dependencies.openExternal(audioComponentDownloadPageUrl);
  }

  private createStatus(
    state: RuntimeAudioComponentStatus['state'],
    version: string | null,
    error: string | null,
  ): RuntimeAudioComponentStatus {
    return {
      componentId: windowsAudioRuntimeComponentId,
      displayName: 'ECHO Windows 音频组件',
      state,
      installed: state === 'installed',
      version,
      downloadPageUrl: audioComponentDownloadPageUrl,
      estimatedInstalledBytes: 230 * 1024 * 1024,
      error,
    };
  }
}

let runtimeComponentService: RuntimeComponentService | null = null;

export const getRuntimeComponentService = (): RuntimeComponentService => {
  runtimeComponentService ??= new RuntimeComponentService({
    rootDirectory: () => getRuntimeAudioComponentRoot(app.getPath('userData')),
    bundledDirectory: () => process.resourcesPath,
    bundledVersion: () => app.getVersion(),
    choosePackage: async () => {
      const result = await dialog.showOpenDialog({
        title: '选择 ECHO 音频组件包',
        properties: ['openFile'],
        filters: [{ name: 'ECHO Component', extensions: ['echo-component'] }],
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    openExternal: async (url) => {
      await shell.openExternal(url);
    },
  });
  return runtimeComponentService;
};
