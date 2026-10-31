import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import {
  getEchoProSignedLicenseStatus,
  normalizeEchoProPluginLicense,
  readEchoProLicenseFromDirectory,
  verifyEchoProSignedLicenseOnline,
  type EchoProLicenseOnlineVerificationResult,
  type EchoProPluginLicense,
  type EchoProPluginLicenseStatus,
} from './EchoProLicensePlugin';

const entitlementFileName = 'echo-pro-entitlement.json';
const onlineFreshMs = 12 * 60 * 60 * 1000;
const offlineGraceMs = 7 * 24 * 60 * 60 * 1000;
const onlineRetryMs = 60 * 60 * 1000;

type EchoProNativeLicenseSource = 'direct-activation' | 'legacy-plugin-migration';

type EchoProNativeLicenseEnvelope = {
  version: 1;
  license: EchoProPluginLicense;
  signature: string;
  source: EchoProNativeLicenseSource;
  installedAt: string;
  lastOnlineVerifiedAt: string;
  offlineUntil: string;
  lastOnlineAttemptAt: string | null;
  revokedReason: EchoProLicenseOnlineVerificationResult['reason'] | null;
  revokedAt: string | null;
};

const timestamp = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export class EchoProNativeLicenseStore {
  private readonly filePath: string;

  constructor(private readonly directory = join(app.getPath('userData'), 'entitlements')) {
    this.filePath = join(directory, entitlementFileName);
  }

  private readEnvelope(): EchoProNativeLicenseEnvelope | null {
    if (!existsSync(this.filePath)) return null;
    try {
      const value = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown;
      if (!isRecord(value) || value.version !== 1) return null;
      const license = normalizeEchoProPluginLicense(value.license);
      const signature = typeof value.signature === 'string' ? value.signature.trim() : '';
      const source = value.source === 'legacy-plugin-migration'
        ? 'legacy-plugin-migration'
        : value.source === 'direct-activation'
          ? 'direct-activation'
          : null;
      if (
        !license ||
        !signature ||
        !source ||
        typeof value.installedAt !== 'string' ||
        typeof value.lastOnlineVerifiedAt !== 'string' ||
        typeof value.offlineUntil !== 'string'
      ) {
        return null;
      }
      return {
        version: 1,
        license,
        signature,
        source,
        installedAt: value.installedAt,
        lastOnlineVerifiedAt: value.lastOnlineVerifiedAt,
        offlineUntil: value.offlineUntil,
        lastOnlineAttemptAt: typeof value.lastOnlineAttemptAt === 'string' ? value.lastOnlineAttemptAt : null,
        revokedReason: typeof value.revokedReason === 'string'
          ? value.revokedReason as EchoProLicenseOnlineVerificationResult['reason']
          : null,
        revokedAt: typeof value.revokedAt === 'string' ? value.revokedAt : null,
      };
    } catch {
      return null;
    }
  }

  private writeEnvelope(envelope: EchoProNativeLicenseEnvelope): void {
    mkdirSync(this.directory, { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(tempPath, this.filePath);
  }

  getStatus(): EchoProPluginLicenseStatus {
    const envelope = this.readEnvelope();
    const status = getEchoProSignedLicenseStatus(envelope?.license ?? null, envelope?.signature ?? null, true);
    if (!envelope || !status.valid) return status;
    if (envelope.revokedReason && envelope.revokedReason !== 'unlocked') {
      return { ...status, valid: false, reason: 'license-revoked' };
    }
    const offlineUntil = timestamp(envelope.offlineUntil);
    if (offlineUntil === null || offlineUntil <= Date.now()) {
      return { ...status, valid: false, reason: 'online-verification-required' };
    }
    return status;
  }

  hasStoredLicense(): boolean {
    return this.readEnvelope() !== null;
  }

  install(
    licenseValue: unknown,
    signatureValue: unknown,
    source: EchoProNativeLicenseSource = 'direct-activation',
  ): EchoProPluginLicenseStatus {
    const license = normalizeEchoProPluginLicense(licenseValue);
    const signature = typeof signatureValue === 'string' ? signatureValue.trim() : '';
    const status = getEchoProSignedLicenseStatus(license, signature, true);
    if (!license || !signature || !status.valid) {
      throw new Error(`echo_pro_native_license_invalid:${status.reason}`);
    }
    const now = new Date();
    this.writeEnvelope({
      version: 1,
      license,
      signature,
      source,
      installedAt: now.toISOString(),
      lastOnlineVerifiedAt: now.toISOString(),
      offlineUntil: new Date(now.getTime() + offlineGraceMs).toISOString(),
      lastOnlineAttemptAt: null,
      revokedReason: null,
      revokedAt: null,
    });
    return this.getStatus();
  }

  migrateFromPlugin(directory: string): boolean {
    // A stale plugin must never overwrite an existing native record, especially
    // after an online revocation has been persisted.
    if (this.readEnvelope()) return false;
    const { license, signature } = readEchoProLicenseFromDirectory(directory);
    const status = getEchoProSignedLicenseStatus(license, signature, true);
    if (!license || !signature || !status.valid) return false;
    this.install(license, signature, 'legacy-plugin-migration');
    return true;
  }

  clear(expectedLicenseId?: string): boolean {
    const envelope = this.readEnvelope();
    if (!envelope || (expectedLicenseId && envelope.license.licenseId !== expectedLicenseId)) {
      return false;
    }
    rmSync(this.filePath, { force: true });
    return true;
  }

  async ensureOnlineFresh(): Promise<EchoProPluginLicenseStatus> {
    const envelope = this.readEnvelope();
    if (!envelope) return this.getStatus();
    const localStatus = getEchoProSignedLicenseStatus(envelope.license, envelope.signature, true);
    if (!localStatus.valid) return localStatus;

    const now = Date.now();
    const lastVerifiedAt = timestamp(envelope.lastOnlineVerifiedAt) ?? 0;
    const offlineUntil = timestamp(envelope.offlineUntil) ?? 0;
    const lastAttemptAt = timestamp(envelope.lastOnlineAttemptAt) ?? 0;
    if (
      envelope.revokedReason === null &&
      offlineUntil > now &&
      now - lastVerifiedAt <= onlineFreshMs
    ) {
      return this.getStatus();
    }
    if (offlineUntil > now && now - lastAttemptAt <= onlineRetryMs) {
      return this.getStatus();
    }

    envelope.lastOnlineAttemptAt = new Date(now).toISOString();
    const result = await verifyEchoProSignedLicenseOnline(envelope.license, envelope.signature);
    if (result.checked && result.valid) {
      envelope.lastOnlineVerifiedAt = new Date(now).toISOString();
      envelope.offlineUntil = new Date(now + offlineGraceMs).toISOString();
      envelope.revokedReason = null;
      envelope.revokedAt = null;
    } else if (result.checked && !result.valid) {
      envelope.revokedReason = result.reason;
      envelope.revokedAt = result.revokedAt;
    }
    this.writeEnvelope(envelope);
    return this.getStatus();
  }
}

let nativeLicenseStore: EchoProNativeLicenseStore | null = null;

export const getEchoProNativeLicenseStore = (): EchoProNativeLicenseStore => {
  nativeLicenseStore ??= new EchoProNativeLicenseStore();
  return nativeLicenseStore;
};
