import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { join } from 'node:path';
import { app } from 'electron';
import {
  echoProUnlockLicenseFormat,
  echoProUnlockLicenseVersion,
  echoProUnlockPluginId,
} from '../../shared/constants/featureUnlocksPublic';
import type { PluginManifest, PluginPackage, PluginPackageFile } from '../../shared/types/plugins';
import { getEchoProMachineCode } from './MachineIdentity';

export const echoProLicenseFileName = 'echo-pro-license.json';
export const echoProLicenseSignatureFileName = 'echo-pro-license.sig';
export const echoProPackageSealFileName = 'echo-pro-package-seal.json';

export type EchoProLicenseFeature = 'echo-pro' | 'downloads' | 'connect' | 'plugins';

export type EchoProPluginLicense = {
  format: typeof echoProUnlockLicenseFormat;
  version: typeof echoProUnlockLicenseVersion;
  licenseId: string;
  activationId: string;
  qq: string;
  plan: 'pro';
  features: EchoProLicenseFeature[];
  pluginId: typeof echoProUnlockPluginId;
  machineCodeHash: string;
  issuedAt: string;
  expiresAt: string | null;
  appMinVersion?: string;
  encryptedWatermark?: string;
};

export type EchoProPluginLicenseStatus = {
  pluginId: typeof echoProUnlockPluginId;
  installed: boolean;
  enabled: boolean;
  valid: boolean;
  machineCode: string;
  licenseId: string | null;
  activationId: string | null;
  qq: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  appMinVersion: string | null;
  features: EchoProLicenseFeature[];
  reason:
    | 'plugin-missing'
    | 'plugin-disabled'
    | 'license-missing'
    | 'license-invalid'
    | 'signature-invalid'
    | 'machine-mismatch'
    | 'license-expired'
    | 'app-version-too-old'
    | 'unlocked';
  checkedAt: string;
};

export type EchoProLicenseOnlineVerificationResult = {
  checked: boolean;
  valid: boolean;
  reason: 'unlocked' | 'license_revoked' | 'license_not_found' | 'machine_mismatch' | 'network_error' | 'verify_unavailable';
  revokedAt: string | null;
};

export type EchoProPluginPackageSeal = {
  exportedAt: string;
  packageSignature: string;
};

const safeTextPattern = /^[a-z0-9][a-z0-9._:@-]{1,160}$/iu;
const qqPattern = /^[1-9][0-9]{4,11}$/u;
const hexSha256Pattern = /^[a-f0-9]{64}$/u;
const appVersionPattern = /^v?\d+(?:\.\d+){0,3}(?:[-+][a-z0-9.-]+)?$/iu;
const hashText = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const defaultLicenseVerifyUrl = 'https://echonext.moe/api/echo-pro/license/verify';
const bundledLicensePublicKeyPem = [
  '-----BEGIN PUBLIC KEY-----',
  'MCowBQYDK2VwAyEA9FrogOinr0BLbVG65gdRIiNoR0QE+9T7uCAWfDarwf0=',
  '-----END PUBLIC KEY-----',
].join('\n');

const getLicensePublicKeyPem = (): string | null => {
  if (app.isPackaged) {
    return bundledLicensePublicKeyPem;
  }

  const fromEnv = process.env.ECHO_PRO_LICENSE_PUBLIC_KEY_PEM ?? process.env.ECHO_PRO_LICENSE_PUBLIC_KEY ?? '';
  const trimmed = fromEnv.trim().replace(/\\n/gu, '\n');
  if (trimmed) {
    return trimmed;
  }
  const publicKeyFile = process.env.ECHO_PRO_LICENSE_PUBLIC_KEY_FILE?.trim();
  if (publicKeyFile && existsSync(publicKeyFile)) {
    return readFileSync(publicKeyFile, 'utf8').trim() || null;
  }
  return bundledLicensePublicKeyPem;
};

export const canonicalizeEchoProLicense = (value: EchoProPluginLicense): string =>
  JSON.stringify({
    activationId: value.activationId,
    ...(value.appMinVersion ? { appMinVersion: value.appMinVersion } : {}),
    expiresAt: value.expiresAt,
    features: [...value.features].sort(),
    format: value.format,
    issuedAt: value.issuedAt,
    licenseId: value.licenseId,
    machineCodeHash: value.machineCodeHash,
    plan: value.plan,
    pluginId: value.pluginId,
    qq: value.qq,
    version: value.version,
    ...(value.encryptedWatermark ? { encryptedWatermark: value.encryptedWatermark } : {}),
  });

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const input = value as Record<string, unknown>;
  return `{${Object.keys(input)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(input[key])}`)
    .join(',')}}`;
};

const normalizePackageFilesForSignature = (files: PluginPackageFile[]): PluginPackageFile[] =>
  [...files]
    .map((file) => ({ path: file.path, content: file.content }))
    .sort((left, right) => left.path.localeCompare(right.path));

export const canonicalizeEchoProPackage = (value: PluginPackage, license: EchoProPluginLicense): string =>
  stableStringify({
    exportedAt: value.exportedAt,
    files: normalizePackageFilesForSignature(value.files),
    license,
    licenseSignature: value.licenseSignature,
    manifest: value.manifest,
    type: value.type,
    version: value.version,
  });

const parseBase64Signature = (value: string): Buffer | null => {
  const normalized = value.trim().replace(/-/gu, '+').replace(/_/gu, '/');
  if (!normalized) {
    return null;
  }
  try {
    return Buffer.from(normalized, 'base64');
  } catch {
    return null;
  }
};

const parseIsoTime = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
};

const parseAppVersionParts = (value: string): number[] | null => {
  if (!appVersionPattern.test(value)) {
    return null;
  }
  const [core] = value.replace(/^v/iu, '').split(/[-+]/u);
  const parts = core.split('.').map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return null;
  }
  while (parts.length < 4) {
    parts.push(0);
  }
  return parts.slice(0, 4);
};

const compareAppVersions = (currentVersion: string, minimumVersion: string): number | null => {
  const current = parseAppVersionParts(currentVersion);
  const minimum = parseAppVersionParts(minimumVersion);
  if (!current || !minimum) {
    return null;
  }
  for (let index = 0; index < minimum.length; index += 1) {
    const currentPart = current[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;
    if (currentPart !== minimumPart) {
      return currentPart > minimumPart ? 1 : -1;
    }
  }
  return 0;
};

export const normalizeEchoProPluginLicense = (value: unknown): EchoProPluginLicense | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const input = value as Partial<EchoProPluginLicense>;
  if (
    input.format !== echoProUnlockLicenseFormat ||
    input.version !== echoProUnlockLicenseVersion ||
    input.plan !== 'pro' ||
    input.pluginId !== echoProUnlockPluginId ||
    typeof input.licenseId !== 'string' ||
    !safeTextPattern.test(input.licenseId) ||
    typeof input.activationId !== 'string' ||
    !safeTextPattern.test(input.activationId) ||
    typeof input.qq !== 'string' ||
    !qqPattern.test(input.qq) ||
    typeof input.machineCodeHash !== 'string' ||
    !hexSha256Pattern.test(input.machineCodeHash) ||
    parseIsoTime(input.issuedAt) === null ||
    (input.expiresAt !== null && parseIsoTime(input.expiresAt) === null) ||
    !Array.isArray(input.features)
  ) {
    return null;
  }

  const features = input.features.filter((feature): feature is EchoProLicenseFeature =>
    feature === 'echo-pro' || feature === 'downloads' || feature === 'connect' || feature === 'plugins',
  );
  if (!features.includes('echo-pro')) {
    return null;
  }
  const issuedAt = input.issuedAt;
  const expiresAt = input.expiresAt ?? null;
  const appMinVersion = typeof input.appMinVersion === 'string' && input.appMinVersion.trim()
    ? input.appMinVersion.trim()
    : null;
  if (typeof issuedAt !== 'string') {
    return null;
  }
  if (appMinVersion && !parseAppVersionParts(appMinVersion)) {
    return null;
  }

  return {
    format: echoProUnlockLicenseFormat,
    version: echoProUnlockLicenseVersion,
    licenseId: input.licenseId,
    activationId: input.activationId,
    qq: input.qq,
    plan: 'pro',
    features: [...new Set(features)],
    pluginId: echoProUnlockPluginId,
    machineCodeHash: input.machineCodeHash.toLowerCase(),
    issuedAt,
    expiresAt,
    ...(appMinVersion ? { appMinVersion } : {}),
    ...(typeof input.encryptedWatermark === 'string' && input.encryptedWatermark.trim()
      ? { encryptedWatermark: input.encryptedWatermark.trim().slice(0, 4_000) }
      : {}),
  };
};

export const verifyEchoProPluginLicenseSignature = (
  license: EchoProPluginLicense,
  signatureText: string,
): boolean => {
  // Security boundary: signature verification protects paid license files.
  // Do not replace this with a permissive fallback or generated "valid" result.
  const publicKeyPem = getLicensePublicKeyPem();
  const signature = parseBase64Signature(signatureText);
  if (!publicKeyPem || !signature) {
    return false;
  }

  try {
    const publicKey = createPublicKey(publicKeyPem);
    return verify(null, Buffer.from(canonicalizeEchoProLicense(license), 'utf8'), publicKey, signature);
  } catch {
    return false;
  }
};

export const verifyEchoProPluginPackageSignature = (
  pluginPackage: PluginPackage,
  license: EchoProPluginLicense,
): boolean => {
  // Security boundary: package signatures prevent unauthorized unlock packages.
  // Weakening this check can facilitate cracking and unlawful access.
  const packageSignature = typeof pluginPackage.packageSignature === 'string'
    ? pluginPackage.packageSignature.trim()
    : '';
  const publicKeyPem = getLicensePublicKeyPem();
  const signature = parseBase64Signature(packageSignature);
  if (!publicKeyPem || !signature) {
    return false;
  }

  try {
    const publicKey = createPublicKey(publicKeyPem);
    return verify(null, Buffer.from(canonicalizeEchoProPackage(pluginPackage, license), 'utf8'), publicKey, signature);
  } catch {
    return false;
  }
};

const readLicenseFromDirectory = (directory: string): { license: EchoProPluginLicense | null; signature: string | null } => {
  const licensePath = join(directory, echoProLicenseFileName);
  const signaturePath = join(directory, echoProLicenseSignatureFileName);
  if (!existsSync(licensePath) || !existsSync(signaturePath)) {
    return { license: null, signature: null };
  }

  try {
    return {
      license: normalizeEchoProPluginLicense(JSON.parse(readFileSync(licensePath, 'utf8'))),
      signature: readFileSync(signaturePath, 'utf8').trim(),
    };
  } catch {
    return { license: null, signature: null };
  }
};

export const readEchoProPluginPackageSeal = (directory: string | null): EchoProPluginPackageSeal | null => {
  if (!directory) {
    return null;
  }
  const sealPath = join(directory, echoProPackageSealFileName);
  if (!existsSync(sealPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(sealPath, 'utf8')) as Partial<EchoProPluginPackageSeal>;
    if (typeof parsed.exportedAt !== 'string' || parseIsoTime(parsed.exportedAt) === null) {
      return null;
    }
    if (typeof parsed.packageSignature !== 'string' || !parsed.packageSignature.trim()) {
      return null;
    }
    return {
      exportedAt: parsed.exportedAt,
      packageSignature: parsed.packageSignature.trim(),
    };
  } catch {
    return null;
  }
};

const readSignedPackageFilesFromDirectory = (directory: string): PluginPackageFile[] => {
  const excluded = new Set([
    'echo.plugin.json',
    echoProLicenseFileName,
    echoProLicenseSignatureFileName,
    echoProPackageSealFileName,
  ]);
  return readdirSync(directory)
    .filter((name) => !excluded.has(name))
    .filter((name) => statSync(join(directory, name)).isFile())
    .map((name) => ({ path: name, content: readFileSync(join(directory, name), 'utf8') }));
};

export const verifyEchoProPluginDirectoryPackageSignature = (
  manifest: PluginManifest | null,
  directory: string | null,
): boolean => {
  if (manifest?.id !== echoProUnlockPluginId || !directory) {
    return false;
  }
  const seal = readEchoProPluginPackageSeal(directory);
  const { license, signature } = readLicenseFromDirectory(directory);
  if (!seal || !license || !signature) {
    return false;
  }
  let signedManifest: PluginManifest;
  try {
    signedManifest = JSON.parse(readFileSync(join(directory, 'echo.plugin.json'), 'utf8')) as PluginManifest;
  } catch {
    return false;
  }
  return verifyEchoProPluginPackageSignature({
    type: 'echo-next-plugin-package',
    version: 1,
    exportedAt: seal.exportedAt,
    manifest: signedManifest,
    files: readSignedPackageFilesFromDirectory(directory),
    license,
    licenseSignature: signature,
    packageSignature: seal.packageSignature,
  }, license);
};

const getLicenseVerifyUrl = (): string | null => {
  const explicit = process.env.ECHO_PRO_LICENSE_VERIFY_URL?.trim();
  if (explicit) {
    return explicit;
  }
  const apiBase = process.env.ECHO_PRO_API_URL?.trim();
  if (apiBase) {
    return `${apiBase.replace(/\/+$/u, '')}/license/verify`;
  }
  return defaultLicenseVerifyUrl;
};

export const verifyEchoProPluginLicenseOnline = async (
  manifest: PluginManifest | null,
  directory: string | null,
): Promise<EchoProLicenseOnlineVerificationResult> => {
  if (manifest?.id !== echoProUnlockPluginId || !directory) {
    return { checked: false, valid: false, reason: 'verify_unavailable', revokedAt: null };
  }

  const { license, signature } = readLicenseFromDirectory(directory);
  if (!license || !signature || !verifyEchoProPluginLicenseSignature(license, signature)) {
    return { checked: false, valid: false, reason: 'verify_unavailable', revokedAt: null };
  }

  const endpoint = getLicenseVerifyUrl();
  if (!endpoint) {
    return { checked: false, valid: true, reason: 'verify_unavailable', revokedAt: null };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        appId: 'echo-next',
        appVersion: app.getVersion(),
        pluginId: echoProUnlockPluginId,
        licenseId: license.licenseId,
        activationId: license.activationId,
        machineCodeHash: hashText(getEchoProMachineCode()),
      }),
      signal: AbortSignal.timeout(6_000),
    });
    const payload = await response.json().catch(() => ({})) as {
      valid?: unknown;
      reason?: unknown;
      revokedAt?: unknown;
    };
    if (!response.ok) {
      return { checked: false, valid: true, reason: 'verify_unavailable', revokedAt: null };
    }
    const reason = typeof payload.reason === 'string' ? payload.reason : payload.valid === true ? 'unlocked' : 'license_not_found';
    if (payload.valid === true) {
      return { checked: true, valid: true, reason: 'unlocked', revokedAt: null };
    }
    return {
      checked: true,
      valid: false,
      reason: reason === 'license_revoked' || reason === 'machine_mismatch' || reason === 'license_not_found'
        ? reason
        : 'license_not_found',
      revokedAt: typeof payload.revokedAt === 'string' ? payload.revokedAt : null,
    };
  } catch {
    return { checked: false, valid: true, reason: 'network_error', revokedAt: null };
  }
};

export const getEchoProPluginLicenseStatus = (
  manifest: PluginManifest | null,
  directory: string | null,
  enabled: boolean,
): EchoProPluginLicenseStatus => {
  const checkedAt = new Date().toISOString();
  const machineCode = getEchoProMachineCode();
  const machineCodeHash = hashText(machineCode);
  const base: Omit<EchoProPluginLicenseStatus, 'valid' | 'reason'> = {
    pluginId: echoProUnlockPluginId,
    installed: manifest?.id === echoProUnlockPluginId,
    enabled,
    machineCode,
    licenseId: null,
    activationId: null,
    qq: null,
    issuedAt: null,
    expiresAt: null,
    appMinVersion: null,
    features: [] as EchoProLicenseFeature[],
    checkedAt,
  };

  if (manifest?.id !== echoProUnlockPluginId || !directory) {
    return { ...base, valid: false, reason: 'plugin-missing' };
  }

  const { license, signature } = readLicenseFromDirectory(directory);
  if (!license || !signature) {
    return { ...base, valid: false, reason: 'license-missing' };
  }

  const withLicense = {
    ...base,
    licenseId: license.licenseId,
    activationId: license.activationId,
    qq: license.qq,
    issuedAt: license.issuedAt,
    expiresAt: license.expiresAt,
    appMinVersion: license.appMinVersion ?? null,
    features: license.features,
  };
  if (!verifyEchoProPluginLicenseSignature(license, signature)) {
    return { ...withLicense, valid: false, reason: 'signature-invalid' };
  }
  if (!verifyEchoProPluginDirectoryPackageSignature(manifest, directory)) {
    return { ...withLicense, valid: false, reason: 'signature-invalid' };
  }
  if (license.machineCodeHash !== machineCodeHash) {
    return { ...withLicense, valid: false, reason: 'machine-mismatch' };
  }
  if (license.expiresAt && Date.parse(license.expiresAt) <= Date.now()) {
    return { ...withLicense, valid: false, reason: 'license-expired' };
  }
  if (license.appMinVersion && (compareAppVersions(app.getVersion(), license.appMinVersion) ?? -1) < 0) {
    return { ...withLicense, valid: false, reason: 'app-version-too-old' };
  }
  if (!enabled) {
    return { ...withLicense, valid: true, reason: 'plugin-disabled' };
  }

  return { ...withLicense, valid: true, reason: 'unlocked' };
};

export const isEchoProUnlockManifest = (manifest: PluginManifest | null): boolean =>
  manifest?.id === echoProUnlockPluginId;
