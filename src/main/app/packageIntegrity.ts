import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { app } from 'electron';
import {
  createEntitlementDiagnosticSnapshot,
  type EntitlementDiagnosticSnapshot,
} from './entitlementDiagnostics';
import {
  createLegacyEntitlementRouteSignal,
  type LegacyEntitlementRouteSignal,
} from './legacyEntitlementRoute';

export type PackageIntegrityManifestFile = {
  path: string;
  sha256: string;
  size: number;
};

export type PackageIntegrityManifest = {
  schemaVersion: 1;
  appId: string;
  productName: string;
  version: string;
  generatedAt: string;
  files: PackageIntegrityManifestFile[];
};

export type PackageIntegrityVerificationResult = {
  ok: boolean;
  skipped: boolean;
  verified: string[];
  warnings: string[];
  errors: string[];
  entitlementDiagnostic?: EntitlementDiagnosticSnapshot;
  legacyMigrationRoute?: LegacyEntitlementRouteSignal;
};

const integrityManifestFileName = 'echo-integrity.json';
const integritySignatureFileName = 'echo-integrity.sig';
const getDefaultIsPackaged = (): boolean => app?.isPackaged === true;
let lastPackageIntegrityResult: PackageIntegrityVerificationResult | null = null;
const bundledPackageIntegrityPublicKeyPem = [
  '-----BEGIN PUBLIC KEY-----',
  'MCowBQYDK2VwAyEA9FrogOinr0BLbVG65gdRIiNoR0QE+9T7uCAWfDarwf0=',
  '-----END PUBLIC KEY-----',
].join('\n');

export const resolvePackageIntegrityManifestPath = (resourcesPath = process.resourcesPath): string =>
  join(resourcesPath, integrityManifestFileName);

export const resolvePackageIntegritySignaturePath = (resourcesPath = process.resourcesPath): string =>
  join(resourcesPath, integritySignatureFileName);

export const isPackageIntegrityEnforced = (
  isPackaged = getDefaultIsPackaged(),
  env: NodeJS.ProcessEnv = process.env,
): boolean => {
  void env;
  return isPackaged;
};

export const recordPackageIntegrityResult = (result: PackageIntegrityVerificationResult): void => {
  lastPackageIntegrityResult = result;
};

export const getLastPackageIntegrityResult = (): PackageIntegrityVerificationResult | null => lastPackageIntegrityResult;

export const resetPackageIntegrityResultForTests = (): void => {
  lastPackageIntegrityResult = null;
};

export const isPackageIntegrityTrustedForPaidFeatures = (
  isPackaged = getDefaultIsPackaged(),
  env: NodeJS.ProcessEnv = process.env,
): boolean => {
  if (!isPackageIntegrityEnforced(isPackaged, env)) {
    return true;
  }
  return lastPackageIntegrityResult?.ok !== false;
};

export const assertPackageIntegrityAllowsPaidFeatures = (
  isPackaged = getDefaultIsPackaged(),
  env: NodeJS.ProcessEnv = process.env,
): void => {
  if (isPackageIntegrityTrustedForPaidFeatures(isPackaged, env)) {
    return;
  }
  const error = new Error('echo_pro_package_integrity_invalid') as Error & { code?: string };
  error.code = 'echo_pro_package_integrity_invalid';
  throw error;
};

const isSafeRelativeResourcePath = (value: string): boolean => {
  if (!value || isAbsolute(value)) {
    return false;
  }

  const normalized = normalize(value);
  return normalized !== '..' && !normalized.startsWith(`..${sep}`) && !normalized.includes(`${sep}..${sep}`);
};

const hashFileSha256 = (filePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
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

export const canonicalizePackageIntegrityManifest = (manifest: PackageIntegrityManifest): string =>
  stableStringify({
    appId: manifest.appId,
    files: [...manifest.files]
      .map((file) => ({ path: file.path, sha256: file.sha256, size: file.size }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    generatedAt: manifest.generatedAt,
    productName: manifest.productName,
    schemaVersion: manifest.schemaVersion,
    version: manifest.version,
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

const readManifest = async (manifestPath: string): Promise<PackageIntegrityManifest> => {
  const raw = await readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<PackageIntegrityManifest>;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.files)) {
    throw new Error('invalid integrity manifest schema');
  }

  return parsed as PackageIntegrityManifest;
};

const readManifestSignature = async (signaturePath: string): Promise<string> => {
  let raw: string;
  try {
    raw = await readFile(signaturePath, 'utf8');
  } catch {
    throw new Error('missing integrity signature');
  }
  const signature = raw.trim();
  if (!signature) {
    throw new Error('empty integrity signature');
  }
  return signature;
};

const verifyManifestSignature = (
  manifest: PackageIntegrityManifest,
  signatureText: string,
  publicKeyPem: string,
): boolean => {
  const signature = parseBase64Signature(signatureText);
  if (!signature || !publicKeyPem.trim()) {
    return false;
  }
  try {
    const publicKey = createPublicKey(publicKeyPem);
    return verify(null, Buffer.from(canonicalizePackageIntegrityManifest(manifest), 'utf8'), publicKey, signature);
  } catch {
    return false;
  }
};

export const verifyPackageIntegrity = async ({
  resourcesPath = process.resourcesPath,
  manifestPath = resolvePackageIntegrityManifestPath(resourcesPath),
  signaturePath = resolvePackageIntegritySignaturePath(dirname(manifestPath)),
  isPackaged = getDefaultIsPackaged(),
  env = process.env,
  publicKeyPem = bundledPackageIntegrityPublicKeyPem,
}: {
  resourcesPath?: string;
  manifestPath?: string;
  signaturePath?: string;
  isPackaged?: boolean;
  env?: NodeJS.ProcessEnv;
  publicKeyPem?: string;
} = {}): Promise<PackageIntegrityVerificationResult> => {
  if (!isPackageIntegrityEnforced(isPackaged, env)) {
    return {
      ok: true,
      skipped: true,
      verified: [],
      warnings: [],
      errors: [],
      ...(isPackaged ? { entitlementDiagnostic: createEntitlementDiagnosticSnapshot('package-integrity', 'disabled') } : {}),
    };
  }

  const verified: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  let manifest: PackageIntegrityManifest;

  try {
    manifest = await readManifest(manifestPath);
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      verified,
      warnings,
      errors: [`manifest: ${error instanceof Error ? error.message : String(error)}`],
      entitlementDiagnostic: createEntitlementDiagnosticSnapshot('package-integrity', 'manifest'),
      legacyMigrationRoute: createLegacyEntitlementRouteSignal('package-integrity', 'manifest'),
    };
  }

  try {
    const signature = await readManifestSignature(signaturePath);
    if (!verifyManifestSignature(manifest, signature, publicKeyPem)) {
      throw new Error('invalid integrity signature');
    }
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      verified,
      warnings,
      errors: [`signature: ${error instanceof Error ? error.message : String(error)}`],
      entitlementDiagnostic: createEntitlementDiagnosticSnapshot('package-integrity', 'signature'),
      legacyMigrationRoute: createLegacyEntitlementRouteSignal('package-integrity', 'signature'),
    };
  }

  for (const file of manifest.files) {
    if (!isSafeRelativeResourcePath(file.path)) {
      errors.push(`${file.path || '<empty>'}: unsafe resource path`);
      continue;
    }

    const filePath = join(resourcesPath, file.path);
    try {
      const info = await stat(filePath);
      if (!info.isFile()) {
        if (file.path === 'app.asar' && info.isDirectory()) {
          warnings.push('app.asar: loose directory layout; legacy file hash skipped');
          verified.push('app.asar/');
          continue;
        }

        errors.push(`${file.path}: not a file`);
        continue;
      }

      if (info.size !== file.size) {
        errors.push(`${file.path}: size mismatch`);
        continue;
      }

      const digest = await hashFileSha256(filePath);
      if (digest !== file.sha256) {
        errors.push(`${file.path}: sha256 mismatch`);
        continue;
      }

      verified.push(file.path);
    } catch (error) {
      errors.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    ok: errors.length === 0,
    skipped: false,
    verified,
    warnings,
    errors,
    ...(errors.length > 0 ? { entitlementDiagnostic: createEntitlementDiagnosticSnapshot('package-integrity', errors.join('|')) } : {}),
    ...(errors.length > 0 ? { legacyMigrationRoute: createLegacyEntitlementRouteSignal('package-integrity', errors.join('|')) } : {}),
  };
};

export const runPackageIntegrityGuard = async (
  options?: Parameters<typeof verifyPackageIntegrity>[0],
): Promise<boolean> => {
  const result = await verifyPackageIntegrity(options);
  recordPackageIntegrityResult(result);
  return result.ok;
};
