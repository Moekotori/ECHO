import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  throw new Error('Windows release signature verification must run on Windows.');
}

const publisherName = process.env.ECHO_WINDOWS_PUBLISHER_NAME?.trim();
if (!publisherName) {
  throw new Error('ECHO_WINDOWS_PUBLISHER_NAME is required to verify a Windows release.');
}

const root = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const releaseArtifacts = [
  join(root, 'dist', `ECHO-NEXT-Setup-${packageJson.version}.exe`),
  join(root, 'dist', `ECHO-NEXT-Portable-${packageJson.version}.exe`),
];
const unpackedDirectory = join(root, 'dist', 'win-unpacked');
const signedPeExtensions = new Set(['.exe', '.dll', '.node']);
const publisherOwnedDllNames = new Set([
  'avcodec-62.dll',
  'avformat-62.dll',
  'avutil-60.dll',
  'swresample-6.dll',
]);

const collectPeFiles = (directory) => {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectPeFiles(path));
    } else if (entry.isFile() && signedPeExtensions.has(extname(entry.name).toLocaleLowerCase())) {
      files.push(path);
    }
  }
  return files;
};

const missingArtifacts = releaseArtifacts.filter((artifactPath) => !existsSync(artifactPath));
if (!existsSync(unpackedDirectory)) {
  missingArtifacts.push(unpackedDirectory);
}
if (missingArtifacts.length > 0) {
  throw new Error(`Windows release artifacts are missing:\n${missingArtifacts.join('\n')}`);
}

const unpackedPeFiles = collectPeFiles(unpackedDirectory);
if (unpackedPeFiles.length === 0) {
  throw new Error(`Windows release contains no PE files under ${unpackedDirectory}.`);
}
const artifacts = [...releaseArtifacts, ...unpackedPeFiles];

const updateConfigPath = join(root, 'dist', 'win-unpacked', 'resources', 'app-update.yml');
const updateConfig = readFileSync(updateConfigPath, 'utf8');
if (!/(?:^|\r?\n)publisherName\s*:/u.test(updateConfig) || !updateConfig.includes(publisherName)) {
  throw new Error(`app-update.yml does not pin the expected publisher: ${publisherName}`);
}

const powershell = `
$ErrorActionPreference = 'Stop'
$paths = $env:ECHO_SIGNATURE_PATHS_JSON | ConvertFrom-Json
$results = foreach ($path in $paths) {
  $signature = Get-AuthenticodeSignature -LiteralPath $path
  [pscustomobject]@{
    Path = $path
    Status = $signature.Status.ToString()
    Subject = if ($null -ne $signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '' }
    PublicKeyOid = if ($null -ne $signature.SignerCertificate) { $signature.SignerCertificate.PublicKey.Oid.Value } else { '' }
    TimestampSubject = if ($null -ne $signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Subject } else { '' }
  }
}
$results | ConvertTo-Json -Compress
`;
const encodedCommand = Buffer.from(powershell, 'utf16le').toString('base64');
const result = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand],
  {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ECHO_SIGNATURE_PATHS_JSON: JSON.stringify(artifacts) },
  },
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  throw new Error(result.stderr.trim() || 'Authenticode verification failed to run.');
}

const parsedSignatures = JSON.parse(result.stdout.trim());
const signatures = Array.isArray(parsedSignatures) ? parsedSignatures : [parsedSignatures];
const normalizedPublisher = publisherName.toLocaleLowerCase();
const requiresPublisherSignature = (path) => {
  if (releaseArtifacts.includes(path)) {
    return true;
  }

  const extension = extname(path).toLocaleLowerCase();
  return (
    extension === '.exe' ||
    extension === '.node' ||
    publisherOwnedDllNames.has(path.split(/[\\/]/u).at(-1)?.toLocaleLowerCase() ?? '')
  );
};
const invalid = signatures.filter((signature) => {
  if (
    signature.Status !== 'Valid' ||
    signature.PublicKeyOid !== '1.2.840.113549.1.1.1' ||
    typeof signature.Subject !== 'string'
  ) {
    return true;
  }

  if (!requiresPublisherSignature(signature.Path)) {
    return false;
  }

  return (
    !signature.Subject.toLocaleLowerCase().includes(normalizedPublisher) ||
    typeof signature.TimestampSubject !== 'string' ||
    signature.TimestampSubject.length === 0
  );
});

if (invalid.length > 0) {
  throw new Error(`Windows release signature verification failed:\n${JSON.stringify(invalid, null, 2)}`);
}

console.log(
  `[verify:win-release-signatures] ${signatures.length} trusted RSA-signed PE artifacts verified; ECHO-owned binaries are timestamped for ${publisherName}.`,
);
