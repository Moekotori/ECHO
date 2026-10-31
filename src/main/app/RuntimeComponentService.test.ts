import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import {
  RuntimeComponentService,
  audioRuntimeComponentFiles,
  resolveInstalledAudioRuntimeFfmpeg,
  resolveInstalledAudioRuntimeHost,
  type RuntimeComponentManifest,
} from './RuntimeComponentService';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'echo-runtime-component-'));
  temporaryDirectories.push(directory);
  return directory;
};

const createComponentPackage = (options: { tamperPayload?: boolean } = {}) => {
  const entries: Record<string, Uint8Array> = {};
  const files = audioRuntimeComponentFiles.map((path, index) => {
    const bytes = path === 'echo-audio-host.exe'
      ? Buffer.from([0x4d, 0x5a, index])
      : Buffer.from(`fixture-${index}-${path}`);
    entries[path] = bytes;
    return {
      path,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength,
    };
  });
  const manifest: RuntimeComponentManifest = {
    schemaVersion: 1,
    componentId: 'audio-win-x64',
    version: '26.7.4',
    platform: 'win32',
    arch: 'x64',
    generatedAt: '2026-07-10T00:00:00.000Z',
    files,
  };
  if (options.tamperPayload) {
    entries['avcodec-62.dll'] = Buffer.from('tampered');
  }
  entries['echo-component.json'] = Buffer.from(JSON.stringify(manifest));

  const directory = createTemporaryDirectory();
  const packagePath = join(directory, 'audio.echo-component');
  writeFileSync(packagePath, zipSync(entries));
  return { packagePath };
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('RuntimeComponentService', () => {
  it('reports the complete bundled base runtime as installed without a user component', async () => {
    const userData = createTemporaryDirectory();
    const bundledDirectory = createTemporaryDirectory();
    for (const path of audioRuntimeComponentFiles) {
      const target = join(bundledDirectory, ...path.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, /\.(?:exe|dll)$/iu.test(path) ? Buffer.from('MZ-fixture') : Buffer.from('fixture'));
    }
    const service = new RuntimeComponentService({
      rootDirectory: () => join(userData, 'runtime-components'),
      bundledDirectory: () => bundledDirectory,
      bundledVersion: () => '26.7.4',
      choosePackage: async () => null,
      openExternal: async () => undefined,
    });

    await expect(service.getAudioComponentStatus()).resolves.toMatchObject({
      installed: true,
      state: 'installed',
      version: '26.7.4',
    });
  });

  it('imports a hash-verified package atomically and resolves its host and ffmpeg paths', async () => {
    const userData = createTemporaryDirectory();
    const { packagePath } = createComponentPackage();
    const openExternal = vi.fn(async () => undefined);
    const service = new RuntimeComponentService({
      rootDirectory: () => join(userData, 'runtime-components'),
      choosePackage: async () => packagePath,
      openExternal,
    });

    const result = await service.importAudioComponent();

    expect(result.outcome).toBe('installed');
    expect(result.status).toMatchObject({ installed: true, state: 'installed', version: '26.7.4' });
    expect(await service.getAudioComponentStatus()).toMatchObject({ installed: true, state: 'installed' });
    expect(readFileSync(resolveInstalledAudioRuntimeHost(userData)!).subarray(0, 2)).toEqual(Buffer.from('MZ'));
    expect(resolveInstalledAudioRuntimeFfmpeg(userData)).toMatch(/tools[\\/]ffmpeg\.exe$/u);

    await service.openAudioComponentDownloadPage();
    expect(openExternal).toHaveBeenCalledWith('https://github.com/moekotori/echo/releases/latest');

    rmSync(join(userData, 'runtime-components', 'audio-win-x64', 'current', 'avcodec-62.dll'), { force: true });
    expect(resolveInstalledAudioRuntimeHost(userData)).toBeNull();
    expect(await service.getAudioComponentStatus()).toMatchObject({ installed: false, state: 'invalid' });
  });

  it('treats closing the picker as a non-destructive cancellation', async () => {
    const userData = createTemporaryDirectory();
    const service = new RuntimeComponentService({
      rootDirectory: () => join(userData, 'runtime-components'),
      choosePackage: async () => null,
      openExternal: async () => undefined,
    });

    await expect(service.importAudioComponent()).resolves.toMatchObject({
      outcome: 'cancelled',
      status: { installed: false, state: 'missing' },
    });
  });

  it('rejects a component whose payload does not match its manifest', async () => {
    const userData = createTemporaryDirectory();
    const { packagePath } = createComponentPackage({ tamperPayload: true });
    const service = new RuntimeComponentService({
      rootDirectory: () => join(userData, 'runtime-components'),
      choosePackage: async () => packagePath,
      openExternal: async () => undefined,
    });

    await expect(service.importAudioComponent()).rejects.toThrow('组件文件校验失败');
    expect(resolveInstalledAudioRuntimeHost(userData)).toBeNull();
  });
});
