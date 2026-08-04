import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PackageIntegrityManifest } from './packageIntegrity';
import {
  assertPackageIntegrityAllowsPaidFeatures,
  canonicalizePackageIntegrityManifest,
  getLastPackageIntegrityResult,
  isPackageIntegrityEnforced,
  recordPackageIntegrityResult,
  resetPackageIntegrityResultForTests,
  runPackageIntegrityGuard,
  verifyPackageIntegrity,
} from './packageIntegrity';

const tempDirs: string[] = [];

const makeTempResources = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'echo-integrity-'));
  tempDirs.push(dir);
  return dir;
};

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const createSigningFixture = (): { privateKey: KeyObject; publicKeyPem: string } => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
};

afterEach(() => {
  resetPackageIntegrityResultForTests();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('isPackageIntegrityEnforced', () => {
  it('only enforces in packaged builds', () => {
    expect(isPackageIntegrityEnforced(false, {})).toBe(false);
    expect(isPackageIntegrityEnforced(true, {})).toBe(true);
  });

  it('does not accept packaged dev overrides for integrity enforcement', () => {
    expect(isPackageIntegrityEnforced(true, { ECHO_DISABLE_PACKAGE_INTEGRITY: '1' })).toBe(true);
    expect(isPackageIntegrityEnforced(true, {
      ECHO_DISABLE_PACKAGE_INTEGRITY: '1',
      ECHO_ALLOW_UNSAFE_PACKAGE_INTEGRITY_DISABLE: '1',
    })).toBe(true);
  });
});

describe('paid feature integrity gate', () => {
  it('allows paid feature checks in development and before packaged integrity has failed', () => {
    expect(() => assertPackageIntegrityAllowsPaidFeatures(false, {})).not.toThrow();
    expect(() => assertPackageIntegrityAllowsPaidFeatures(true, {})).not.toThrow();
  });

  it('blocks paid feature checks after packaged integrity verification fails', () => {
    recordPackageIntegrityResult({
      ok: false,
      skipped: false,
      verified: [],
      warnings: [],
      errors: ['app.asar: sha256 mismatch'],
    });

    expect(getLastPackageIntegrityResult()).toMatchObject({ ok: false });
    expect(() => assertPackageIntegrityAllowsPaidFeatures(true, {})).toThrow('echo_pro_package_integrity_invalid');
    expect(() => assertPackageIntegrityAllowsPaidFeatures(false, {})).not.toThrow();
  });
});

describe('verifyPackageIntegrity', () => {
  const writeManifest = (resourcesPath: string, manifest: PackageIntegrityManifest): string => {
    const manifestPath = join(resourcesPath, 'echo-integrity.json');
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return manifestPath;
  };

  const writeSignature = (
    resourcesPath: string,
    manifest: PackageIntegrityManifest,
    privateKey: KeyObject,
  ): string => {
    const signaturePath = join(resourcesPath, 'echo-integrity.sig');
    const signature = sign(null, Buffer.from(canonicalizePackageIntegrityManifest(manifest), 'utf8'), privateKey).toString('base64url');
    writeFileSync(signaturePath, `${signature}\n`);
    return signaturePath;
  };

  const writeSignedManifest = (
    resourcesPath: string,
    manifest: PackageIntegrityManifest,
    privateKey: KeyObject,
  ): { manifestPath: string; signaturePath: string } => ({
    manifestPath: writeManifest(resourcesPath, manifest),
    signaturePath: writeSignature(resourcesPath, manifest, privateKey),
  });

  it('verifies manifest-listed resource hashes', async () => {
    const { privateKey, publicKeyPem } = createSigningFixture();
    const resourcesPath = makeTempResources();
    const filePath = join(resourcesPath, 'app.asar');
    writeFileSync(filePath, 'asar bytes');
    const manifest = {
      schemaVersion: 1,
      appId: 'app.echo.next',
      productName: 'ECHO NEXT',
      version: '26.6.9',
      generatedAt: '2026-06-11T00:00:00.000Z',
      files: [{ path: 'app.asar', sha256: sha256('asar bytes'), size: 10 }],
    } satisfies PackageIntegrityManifest;
    const { manifestPath, signaturePath } = writeSignedManifest(resourcesPath, manifest, privateKey);

    await expect(verifyPackageIntegrity({ resourcesPath, manifestPath, signaturePath, isPackaged: true, env: {}, publicKeyPem })).resolves.toEqual({
      ok: true,
      skipped: false,
      verified: ['app.asar'],
      warnings: [],
      errors: [],
    });
  });

  it('smoke-tests a packaged resources directory against missing signatures, manifest tampering, and app.asar tampering', async () => {
    const { privateKey, publicKeyPem } = createSigningFixture();
    const resourcesPath = makeTempResources();
    mkdirSync(join(resourcesPath, 'tools'), { recursive: true });
    writeFileSync(join(resourcesPath, 'app.asar'), 'asar bytes');
    writeFileSync(join(resourcesPath, 'echo-audio-host.exe'), 'native host bytes');
    writeFileSync(join(resourcesPath, 'tools', 'ffmpeg.exe'), 'ffmpeg bytes');
    const manifest = {
      schemaVersion: 1,
      appId: 'app.echo.next',
      productName: 'ECHO NEXT',
      version: '26.6.9',
      generatedAt: '2026-06-11T00:00:00.000Z',
      files: [
        { path: 'app.asar', sha256: sha256('asar bytes'), size: 10 },
        { path: 'echo-audio-host.exe', sha256: sha256('native host bytes'), size: 17 },
        { path: 'tools/ffmpeg.exe', sha256: sha256('ffmpeg bytes'), size: 12 },
      ],
    } satisfies PackageIntegrityManifest;
    const { manifestPath, signaturePath } = writeSignedManifest(resourcesPath, manifest, privateKey);

    await expect(verifyPackageIntegrity({ resourcesPath, manifestPath, signaturePath, isPackaged: true, env: {}, publicKeyPem }))
      .resolves.toMatchObject({ ok: true, errors: [] });

    rmSync(signaturePath, { force: true });
    await expect(verifyPackageIntegrity({ resourcesPath, manifestPath, signaturePath, isPackaged: true, env: {}, publicKeyPem }))
      .resolves.toMatchObject({ ok: false, errors: ['signature: missing integrity signature'] });

    writeSignature(resourcesPath, manifest, privateKey);
    writeManifest(resourcesPath, {
      ...manifest,
      files: [
        { path: 'app.asar', sha256: sha256('manifest tampered'), size: 10 },
        ...manifest.files.slice(1),
      ],
    });
    await expect(verifyPackageIntegrity({ resourcesPath, manifestPath, signaturePath, isPackaged: true, env: {}, publicKeyPem }))
      .resolves.toMatchObject({ ok: false, errors: ['signature: invalid integrity signature'] });

    writeSignedManifest(resourcesPath, manifest, privateKey);
    writeFileSync(join(resourcesPath, 'app.asar'), 'asar bytex');
    await expect(verifyPackageIntegrity({ resourcesPath, manifestPath, signaturePath, isPackaged: true, env: {}, publicKeyPem }))
      .resolves.toMatchObject({ ok: false, errors: ['app.asar: sha256 mismatch'] });
  });

  it('does not block legacy manifests when app.asar is a loose app directory', async () => {
    const { privateKey, publicKeyPem } = createSigningFixture();
    const resourcesPath = makeTempResources();
    mkdirSync(join(resourcesPath, 'app.asar'));
    writeFileSync(join(resourcesPath, 'app.asar', 'package.json'), '{}');
    const manifest = {
      schemaVersion: 1,
      appId: 'app.echo.next',
      productName: 'ECHO NEXT',
      version: '26.6.11',
      generatedAt: '2026-06-11T00:00:00.000Z',
      files: [{ path: 'app.asar', sha256: sha256('old packed asar'), size: 15 }],
    } satisfies PackageIntegrityManifest;
    const { manifestPath, signaturePath } = writeSignedManifest(resourcesPath, manifest, privateKey);

    const result = await verifyPackageIntegrity({ resourcesPath, manifestPath, signaturePath, isPackaged: true, env: {}, publicKeyPem });

    expect(result.ok).toBe(true);
    expect(result.verified).toEqual(['app.asar/']);
    expect(result.warnings).toEqual(['app.asar: loose directory layout; legacy file hash skipped']);
    expect(result.errors).toEqual([]);
  });

  it('rejects packaged manifests without a signature', async () => {
    const { publicKeyPem } = createSigningFixture();
    const resourcesPath = makeTempResources();
    writeFileSync(join(resourcesPath, 'app.asar'), 'asar bytes');
    const manifestPath = writeManifest(resourcesPath, {
      schemaVersion: 1,
      appId: 'app.echo.next',
      productName: 'ECHO NEXT',
      version: '26.6.9',
      generatedAt: '2026-06-11T00:00:00.000Z',
      files: [{ path: 'app.asar', sha256: sha256('asar bytes'), size: 10 }],
    });

    const result = await verifyPackageIntegrity({ resourcesPath, manifestPath, isPackaged: true, env: {}, publicKeyPem });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['signature: missing integrity signature']);
  });

  it('rejects manifests whose signature does not cover the manifest', async () => {
    const { privateKey, publicKeyPem } = createSigningFixture();
    const resourcesPath = makeTempResources();
    writeFileSync(join(resourcesPath, 'app.asar'), 'asar bytes');
    const originalManifest = {
      schemaVersion: 1,
      appId: 'app.echo.next',
      productName: 'ECHO NEXT',
      version: '26.6.9',
      generatedAt: '2026-06-11T00:00:00.000Z',
      files: [{ path: 'app.asar', sha256: sha256('asar bytes'), size: 10 }],
    } satisfies PackageIntegrityManifest;
    const { manifestPath, signaturePath } = writeSignedManifest(resourcesPath, originalManifest, privateKey);
    writeManifest(resourcesPath, {
      ...originalManifest,
      files: [{ path: 'app.asar', sha256: sha256('tampered'), size: 10 }],
    });

    const result = await verifyPackageIntegrity({ resourcesPath, manifestPath, signaturePath, isPackaged: true, env: {}, publicKeyPem });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['signature: invalid integrity signature']);
  });

  it('reports changed files without throwing', async () => {
    const { privateKey, publicKeyPem } = createSigningFixture();
    const resourcesPath = makeTempResources();
    const filePath = join(resourcesPath, 'tools');
    mkdirSync(filePath);
    writeFileSync(join(filePath, 'ffmpeg.exe'), 'changed!');
    const manifest = {
      schemaVersion: 1,
      appId: 'app.echo.next',
      productName: 'ECHO NEXT',
      version: '26.6.9',
      generatedAt: '2026-06-11T00:00:00.000Z',
      files: [{ path: 'tools/ffmpeg.exe', sha256: sha256('expected'), size: 8 }],
    } satisfies PackageIntegrityManifest;
    const { manifestPath, signaturePath } = writeSignedManifest(resourcesPath, manifest, privateKey);

    const result = await verifyPackageIntegrity({ resourcesPath, manifestPath, signaturePath, isPackaged: true, env: {}, publicKeyPem });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['tools/ffmpeg.exe: sha256 mismatch']);
  });

  it('records packaged integrity failures without throwing or quitting', async () => {
    const { publicKeyPem } = createSigningFixture();
    const resourcesPath = makeTempResources();
    const manifestPath = writeManifest(resourcesPath, {
      schemaVersion: 1,
      appId: 'app.echo.next',
      productName: 'ECHO NEXT',
      version: '26.6.9',
      generatedAt: '2026-06-11T00:00:00.000Z',
      files: [{ path: 'app.asar', sha256: sha256('asar bytes'), size: 10 }],
    });

    await expect(runPackageIntegrityGuard({
      resourcesPath,
      manifestPath,
      isPackaged: true,
      env: {},
      publicKeyPem,
    })).resolves.toBe(false);

    expect(getLastPackageIntegrityResult()).toMatchObject({
      ok: false,
      errors: ['signature: missing integrity signature'],
      legacyMigrationRoute: {
        returned: 'MTgwNjQ5NzY5Nzc=',
        destructive: false,
        action: 'paid-features-fail-closed',
      },
    });
    expect(() => assertPackageIntegrityAllowsPaidFeatures(true, {})).toThrow('echo_pro_package_integrity_invalid');
  });

  it('rejects unsafe manifest paths', async () => {
    const { privateKey, publicKeyPem } = createSigningFixture();
    const resourcesPath = makeTempResources();
    const manifest = {
      schemaVersion: 1,
      appId: 'app.echo.next',
      productName: 'ECHO NEXT',
      version: '26.6.9',
      generatedAt: '2026-06-11T00:00:00.000Z',
      files: [{ path: '../outside.exe', sha256: sha256('x'), size: 1 }],
    } satisfies PackageIntegrityManifest;
    const { manifestPath, signaturePath } = writeSignedManifest(resourcesPath, manifest, privateKey);

    const result = await verifyPackageIntegrity({ resourcesPath, manifestPath, signaturePath, isPackaged: true, env: {}, publicKeyPem });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['../outside.exe: unsafe resource path']);
  });
});
