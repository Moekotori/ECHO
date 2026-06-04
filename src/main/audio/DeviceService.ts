import { execFile, type execFileSync as nodeExecFileSync } from 'node:child_process';
import type { AudioDeviceInfo } from './audioTypes';
import { isAdvancedNativeOutputPlatform, isNativeSharedOutputPlatform } from '../../shared/utils/audioPlatformCapabilities';
import { resolveHostBinary } from './NativeOutputBridge';

export type DeviceServiceDependencies = {
  hostBinary?: string | null;
  execFileSync?: typeof nodeExecFileSync;
  execFile?: typeof execFile;
  platform?: NodeJS.Platform | string;
  logger?: (message: string) => void;
};

export type DeviceListOptions = {
  useJuceOutput?: boolean;
};

export type AsioControlPanelOptions = {
  deviceIndex?: number;
  deviceName?: string;
};

const parsePositiveInteger = (value: string | undefined): number | null => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseNonNegativeInteger = (value: string | undefined): number | undefined => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
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

  if (outputMode === 'asio') {
    const asioOutputChannels = parsePositiveInteger(parts[5]);
    const asioOutputChannelStart = parseNonNegativeInteger(parts[6]);
    const asioChannelNames = parts[7]?.trim()
      ? parts[7].split('|').map((name) => name.trim()).filter(Boolean)
      : undefined;

    if (asioOutputChannels !== null) {
      device.asioOutputChannels = asioOutputChannels;
    }
    if (asioOutputChannelStart !== undefined) {
      device.asioOutputChannelStart = asioOutputChannelStart;
    }
    if (asioChannelNames && asioChannelNames.length > 0) {
      device.asioChannelNames = asioChannelNames;
    }
  }

  return device;
};

export class DeviceService {
  private readonly execAsync: typeof execFile;
  private readonly hostBinary: string | null;
  private readonly platform: NodeJS.Platform | string;
  private readonly logger: (message: string) => void;
  private readonly sharedCacheTtlMs = 5000;
  private readonly asioCacheTtlMs = 60_000;
  private readonly sharedCache = new Map<string, { at: number; devices: AudioDeviceInfo[] }>();
  private readonly asioCache = new Map<string, { at: number; devices: AudioDeviceInfo[] }>();
  private readonly sharedPending = new Map<string, Promise<AudioDeviceInfo[]>>();
  private readonly asioPending = new Map<string, Promise<AudioDeviceInfo[]>>();
  private cacheGeneration = 0;

  constructor(dependencies: DeviceServiceDependencies = {}) {
    this.execAsync = dependencies.execFile ?? execFile;
    this.hostBinary = dependencies.hostBinary ?? null;
    this.platform = dependencies.platform ?? process.platform;
    this.logger = dependencies.logger ?? ((message) => console.warn(message));
  }

  listDevices(options: DeviceListOptions = {}): AudioDeviceInfo[] {
    return [...this.listSharedDevices(options), ...this.listAsioDevices(options)];
  }

  async listDevicesAsync(options: DeviceListOptions = {}): Promise<AudioDeviceInfo[]> {
    const [sharedDevices, asioDevices] = await Promise.all([
      this.listSharedDevicesAsync(options),
      this.listAsioDevicesAsync(options),
    ]);
    return [...sharedDevices, ...asioDevices];
  }

  async refresh(options: DeviceListOptions = {}): Promise<AudioDeviceInfo[]> {
    this.invalidateCache();
    return this.listDevicesAsync(options);
  }

  invalidateCache(): void {
    this.cacheGeneration += 1;
    this.sharedCache.clear();
    this.asioCache.clear();
    this.sharedPending.clear();
    this.asioPending.clear();
  }

  async openAsioControlPanel(options: AsioControlPanelOptions = {}): Promise<void> {
    if (!isAdvancedNativeOutputPlatform(this.platform)) {
      throw new Error(`ASIO control panel is unavailable on ${this.platform}`);
    }

    const args = ['-asio-control-panel'];
    const deviceIndex = Number(options.deviceIndex);
    if (Number.isInteger(deviceIndex) && deviceIndex >= 0) {
      args.push('-device-index', String(deviceIndex));
    }
    if (typeof options.deviceName === 'string' && options.deviceName.trim()) {
      args.push('-device', options.deviceName.trim());
    }

    await this.runHostCommandAsync(args, 'asio');
  }

  listSharedDevices(options: DeviceListOptions = {}): AudioDeviceInfo[] {
    if (!isNativeSharedOutputPlatform(this.platform)) {
      this.logger(`[DeviceService] native output device enumeration is unavailable on ${this.platform}`);
      return [];
    }

    return this.getCachedDevices('shared', options);
  }

  listSharedDevicesAsync(options: DeviceListOptions = {}): Promise<AudioDeviceInfo[]> {
    if (!isNativeSharedOutputPlatform(this.platform)) {
      this.logger(`[DeviceService] native output device enumeration is unavailable on ${this.platform}`);
      return Promise.resolve([]);
    }

    return this.getCachedDevicesAsync('shared', options);
  }

  listAsioDevices(options: DeviceListOptions = {}): AudioDeviceInfo[] {
    if (!isAdvancedNativeOutputPlatform(this.platform)) {
      return [];
    }

    return this.getCachedDevices('asio', options);
  }

  listAsioDevicesAsync(options: DeviceListOptions = {}): Promise<AudioDeviceInfo[]> {
    if (!isAdvancedNativeOutputPlatform(this.platform)) {
      return Promise.resolve([]);
    }

    return this.getCachedDevicesAsync('asio', options);
  }

  private getCachedDevices(outputMode: AudioDeviceInfo['outputMode'], options: DeviceListOptions): AudioDeviceInfo[] {
    const now = Date.now();
    const cacheKey = this.createCacheKey(options);
    const cacheMap = outputMode === 'asio' ? this.asioCache : this.sharedCache;
    const cache = cacheMap.get(cacheKey) ?? null;
    const cacheTtlMs = outputMode === 'asio' ? this.asioCacheTtlMs : this.sharedCacheTtlMs;

    if (cache && now - cache.at < cacheTtlMs) {
      return [...cache.devices];
    }

    return [];
  }

  private async getCachedDevicesAsync(outputMode: AudioDeviceInfo['outputMode'], options: DeviceListOptions): Promise<AudioDeviceInfo[]> {
    const now = Date.now();
    const cacheKey = this.createCacheKey(options);
    const cacheMap = outputMode === 'asio' ? this.asioCache : this.sharedCache;
    const pendingMap = outputMode === 'asio' ? this.asioPending : this.sharedPending;
    const cache = cacheMap.get(cacheKey) ?? null;
    const cacheTtlMs = outputMode === 'asio' ? this.asioCacheTtlMs : this.sharedCacheTtlMs;
    const generation = this.cacheGeneration;

    if (cache && now - cache.at < cacheTtlMs) {
      return [...cache.devices];
    }

    const currentPending = pendingMap.get(cacheKey) ?? null;
    if (currentPending) {
      const devices = await currentPending;
      return [...devices];
    }

    const args = this.createListArgs(outputMode, options);
    const pending = this.runDeviceListAsync(args, outputMode)
      .then((devices) => {
        const nextCache = { at: Date.now(), devices };
        if (generation === this.cacheGeneration) {
          cacheMap.set(cacheKey, nextCache);
        }
        return devices;
      })
      .finally(() => {
        if (generation === this.cacheGeneration) {
          pendingMap.delete(cacheKey);
        }
      });

    pendingMap.set(cacheKey, pending);

    const devices = await pending;
    return [...devices];
  }

  private createCacheKey(options: DeviceListOptions): string {
    return options.useJuceOutput === true ? 'juce' : 'native';
  }

  private createListArgs(outputMode: AudioDeviceInfo['outputMode'], options: DeviceListOptions): string[] {
    const args = outputMode === 'asio' ? ['-list', '-asio'] : ['-list'];

    if (options.useJuceOutput === true) {
      args.push('-juce-output');
    }

    return args;
  }

  private runDeviceListAsync(args: string[], outputMode: AudioDeviceInfo['outputMode']): Promise<AudioDeviceInfo[]> {
    const bin = this.hostBinary ?? (this.platform === process.platform ? resolveHostBinary() : null);

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

        if (outputMode === 'asio' && devices.length === 0) {
          this.logger(`[DeviceService] ASIO device enumeration returned no devices; host="${bin}" args="${args.join(' ')}"`);
        }

        resolve(devices);
      });
    });
  }

  private runHostCommandAsync(args: string[], outputMode: AudioDeviceInfo['outputMode']): Promise<void> {
    const bin = this.hostBinary ?? (this.platform === process.platform ? resolveHostBinary() : null);

    if (!bin) {
      throw new Error(`echo-audio-host binary not found for ${outputMode} command`);
    }

    return new Promise((resolve, reject) => {
      this.execAsync(bin, args, { timeout: 10_000, encoding: 'utf-8' }, (error, stdout, stderr) => {
        if (error) {
          this.logDeviceListFailure(Object.assign(error, { stderr, stdout }), bin, args, outputMode);
          reject(error);
          return;
        }

        resolve();
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
