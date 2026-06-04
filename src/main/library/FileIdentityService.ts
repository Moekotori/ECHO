import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
import type { Stats } from 'node:fs';

export type FileIdentitySource = 'win32-file-id' | 'posix-dev-ino' | 'unsupported' | 'error';
export type FileIdentityStatus = 'ok' | 'partial' | 'unsupported' | 'error';

export type FileIdentityObservation = {
  fileIdentity: string | null;
  fileIdentitySource: FileIdentitySource;
  quickHash: string | null;
  quickHashVersion: number;
  identityStatus: FileIdentityStatus;
  identityUpdatedAt: string;
  identityError: string | null;
};

export const QUICK_HASH_VERSION = 1;
const quickHashEdgeBytes = 64 * 1024;

type ReadSlice = (fd: number, buffer: Buffer, offset: number, length: number, position: number) => number;

export type FileIdentityServiceOptions = {
  now?: () => string;
  readSlice?: ReadSlice;
};

const defaultReadSlice: ReadSlice = (fd, buffer, offset, length, position) => readSync(fd, buffer, offset, length, position);

export class FileIdentityService {
  private readonly now: () => string;
  private readonly readSlice: ReadSlice;

  constructor(options: FileIdentityServiceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.readSlice = options.readSlice ?? defaultReadSlice;
  }

  observe(filePath: string): FileIdentityObservation {
    try {
      const stats = statSync(filePath);
      const identity = this.getPlatformIdentity(stats);
      const quickHash = this.computeQuickHash(filePath, stats.size);
      const unsupported = identity.source === 'unsupported';

      return {
        fileIdentity: identity.value,
        fileIdentitySource: identity.source,
        quickHash,
        quickHashVersion: QUICK_HASH_VERSION,
        identityStatus: unsupported ? 'partial' : 'ok',
        identityUpdatedAt: this.now(),
        identityError: unsupported ? 'native file identity unsupported on this platform' : null,
      };
    } catch (error) {
      return {
        fileIdentity: null,
        fileIdentitySource: 'error',
        quickHash: null,
        quickHashVersion: QUICK_HASH_VERSION,
        identityStatus: 'error',
        identityUpdatedAt: this.now(),
        identityError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private getPlatformIdentity(stats: Stats): { value: string | null; source: FileIdentitySource } {
    if (process.platform === 'win32') {
      return { value: null, source: 'unsupported' };
    }

    if (typeof stats.dev === 'number' && typeof stats.ino === 'number' && stats.ino > 0) {
      return { value: `dev:${stats.dev}:ino:${stats.ino}`, source: 'posix-dev-ino' };
    }

    return { value: null, source: 'unsupported' };
  }

  private computeQuickHash(filePath: string, sizeBytes: number): string {
    const fd = openSync(filePath, 'r');

    try {
      const currentSize = fstatSync(fd).size;
      const effectiveSize = Math.max(0, Math.min(sizeBytes, currentSize));
      const headLength = Math.min(quickHashEdgeBytes, effectiveSize);
      const tailStart = Math.max(headLength, effectiveSize - quickHashEdgeBytes);
      const tailLength = Math.max(0, effectiveSize - tailStart);
      const hash = createHash('sha256');

      hash.update(`quick-hash-v${QUICK_HASH_VERSION}:`);
      hash.update(String(effectiveSize));
      hash.update(':');

      if (headLength > 0) {
        hash.update(this.readExact(fd, headLength, 0));
      }

      if (tailLength > 0) {
        hash.update(':tail:');
        hash.update(this.readExact(fd, tailLength, tailStart));
      }

      return hash.digest('hex');
    } finally {
      closeSync(fd);
    }
  }

  private readExact(fd: number, length: number, position: number): Buffer {
    const buffer = Buffer.allocUnsafe(length);
    let offset = 0;

    while (offset < length) {
      const bytesRead = this.readSlice(fd, buffer, offset, length - offset, position + offset);
      if (bytesRead <= 0) {
        break;
      }
      offset += bytesRead;
    }

    return offset === length ? buffer : buffer.subarray(0, offset);
  }
}
