import { execFile, type execFileSync as nodeExecFileSync } from 'node:child_process';
import type { AudioDeviceInfo } from './audioTypes';
import { isNativeSharedOutputPlatform } from '../../shared/utils/audioPlatformCapabilities';
import { resolveHostBinary } from './NativePcmHostProcess';

export type DeviceServiceDependencies = {
  hostBinary?: string | null;
  execFileSync?: typeof nodeExecFileSync;
  execFile?: typeof execFile;
  platform?: NodeJS.Platform | string;
  logger?: (message: string) => void;
};

const parsePositiveInteger = (value: string | undefined): number | null => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseDeviceListLine = (line: string, outputMode: AudioDeviceInfo['outputMode']): AudioDeviceInfo | null => {
  const parts = line.trim().split('\t');

  if (parts.length < 2) {
    return null;
  }

  const index = Number.parseInt(parts[0], 10);
  if (!Number.isInteger(index) || index < 0) {
    return null;
  }

  const device: AudioDeviceInfo = {
    id: `${outputMode}:${index}`,
    index,
    name: parts[1],
    outputMode,
    sampleRate: parsePositiveInteger(parts[2]),
    isDefault: parts[3] === '1',
    sharedDeviceSampleRate: parsePositiveInteger(parts[4]),
  };

  return device;
};

export class DeviceService {
  private readonly execAsync: typeof execFile;
  private readonly execExplicit: boolean;
  private readonly hostBinary: string | null;
  private readonly platform: NodeJS.Platform | string;
  private readonly logger: (message: string) => void;
  private readonly sharedCacheTtlMs = 5000;
  private readonly sharedCache = new Map<string, { at: number; devices: AudioDeviceInfo[] }>();
  private readonly sharedPending = new Map<string, Promise<AudioDeviceInfo[]>>();
  private cacheGeneration = 0;

  constructor(dependencies: DeviceServiceDependencies = {}) {
    this.execAsync = dependencies.execFile ?? execFile;
    this.execExplicit = dependencies.execFile !== undefined;
    this.hostBinary = dependencies.hostBinary ?? null;
    this.platform = dependencies.platform ?? process.platform;
    this.logger = dependencies.logger ?? ((message) => console.warn(message));
  }

  listDevices(): AudioDeviceInfo[] {
    return this.listSharedDevices();
  }

  async listDevicesAsync(): Promise<AudioDeviceInfo[]> {
    return this.listSharedDevicesAsync();
  }

  async refresh(): Promise<AudioDeviceInfo[]> {
    this.invalidateCache();
    return this.listDevicesAsync();
  }

  invalidateCache(): void {
    this.cacheGeneration += 1;
    this.sharedCache.clear();
    this.sharedPending.clear();
  }

  listSharedDevices(): AudioDeviceInfo[] {
    if (!isNativeSharedOutputPlatform(this.platform)) {
      this.logger(`[DeviceService] native output device enumeration is unavailable on ${this.platform}`);
      return [];
    }

    return this.getCachedDevices('shared');
  }

  listSharedDevicesAsync(): Promise<AudioDeviceInfo[]> {
    if (!isNativeSharedOutputPlatform(this.platform)) {
      this.logger(`[DeviceService] native output device enumeration is unavailable on ${this.platform}`);
      return Promise.resolve([]);
    }

    return this.getCachedDevicesAsync('shared');
  }

  private getCachedDevices(outputMode: AudioDeviceInfo['outputMode']): AudioDeviceInfo[] {
    const now = Date.now();
    const cacheKey = this.createCacheKey();
    const cache = this.sharedCache.get(cacheKey);

    if (cache && now - cache.at < this.sharedCacheTtlMs) {
      return [...cache.devices];
    }

    return [];
  }

  private async getCachedDevicesAsync(outputMode: AudioDeviceInfo['outputMode']): Promise<AudioDeviceInfo[]> {
    const now = Date.now();
    const cacheKey = this.createCacheKey();
    const cache = this.sharedCache.get(cacheKey);
    const generation = this.cacheGeneration;

    if (cache && now - cache.at < this.sharedCacheTtlMs) {
      return [...cache.devices];
    }

    const currentPending = this.sharedPending.get(cacheKey);
    if (currentPending) {
      const devices = await currentPending;
      return [...devices];
    }

    const args = ['-list'];
    const pending = this.runDeviceListAsync(args, outputMode)
      .then((devices) => {
        const nextCache = { at: Date.now(), devices };
        if (generation === this.cacheGeneration) {
          this.sharedCache.set(cacheKey, nextCache);
        }
        return devices;
      })
      .finally(() => {
        if (generation === this.cacheGeneration) {
          this.sharedPending.delete(cacheKey);
        }
      });

    this.sharedPending.set(cacheKey, pending);

    const devices = await pending;
    return [...devices];
  }

  private createCacheKey(): string {
    return 'native';
  }

  private runDeviceListAsync(args: string[], outputMode: AudioDeviceInfo['outputMode']): Promise<AudioDeviceInfo[]> {
    const bin = this.hostBinary ?? (!this.execExplicit && this.platform === process.platform ? resolveHostBinary() : null);

    if (!bin) {
      this.logger(`[DeviceService] echo-audio-host binary not found for ${outputMode} device enumeration`);
      return Promise.resolve([]);
    }

    return new Promise((resolve) => {
      this.execAsync(bin, args, { timeout: 5000, encoding: 'utf-8' }, (error, stdout, stderr) => {
        if (error) {
          this.logDeviceListFailure(Object.assign(error, { stderr, stdout }), bin, args, outputMode);
          resolve([]);
          return;
        }

        const devices = this.parseDeviceListOutput(String(stdout), outputMode);
        resolve(devices);
      });
    });
  }

  private parseDeviceListOutput(output: string, outputMode: AudioDeviceInfo['outputMode']): AudioDeviceInfo[] {
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parseDeviceListLine(line, outputMode))
      .filter((device): device is AudioDeviceInfo => device !== null);
  }

  private logDeviceListFailure(
    error: unknown,
    bin: string,
    args: string[],
    outputMode: AudioDeviceInfo['outputMode'],
  ): void {
    const details = error as { status?: unknown; code?: unknown; stderr?: unknown; stdout?: unknown; message?: unknown };
    const stderr = Buffer.isBuffer(details.stderr) ? details.stderr.toString('utf8') : String(details.stderr ?? '').trim();
    const stdout = Buffer.isBuffer(details.stdout) ? details.stdout.toString('utf8') : String(details.stdout ?? '').trim();
    const message = details.message ? String(details.message) : String(error);
    this.logger(
      `[DeviceService] ${outputMode} device enumeration failed; host="${bin}" args="${args.join(' ')}" status=${
        details.status ?? details.code ?? 'unknown'
      }; error="${message}"${stderr ? `; stderr="${stderr}"` : ''}${stdout ? `; stdout="${stdout}"` : ''}`,
    );
  }
}
