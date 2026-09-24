import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const requiredRuntimeFiles = [
  'msvcp140.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll',
];

const root = fileURLToPath(new URL('..', import.meta.url));
const stagingDirectory = join(root, 'electron-app', 'build', 'vc-runtime');

const isDirectory = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const containsRequiredRuntime = (directory) =>
  isDirectory(directory) && requiredRuntimeFiles.every((fileName) => existsSync(join(directory, fileName)));

const compareVersionDirectories = (left, right) =>
  right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' });

const appendVersionedCandidates = (candidates, baseDirectory) => {
  if (!isDirectory(baseDirectory)) {
    return;
  }

  for (const versionEntry of readdirSync(baseDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersionDirectories)) {
    candidates.push(
      join(baseDirectory, versionEntry, 'x64', 'Microsoft.VC143.CRT'),
      join(baseDirectory, versionEntry, 'x64', 'Microsoft.VC142.CRT'),
    );
  }
};

const findVisualStudioInstallation = () => {
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  if (!programFilesX86) {
    return null;
  }

  const vswhere = join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!existsSync(vswhere)) {
    return null;
  }

  const result = spawnSync(
    vswhere,
    [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath',
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim() || null;
};

const findRuntimeDirectory = () => {
  const candidates = [];
  const configuredDirectory = process.env.ECHO_WINDOWS_VC_RUNTIME_DIR?.trim();
  if (configuredDirectory) {
    if (!containsRequiredRuntime(configuredDirectory)) {
      throw new Error(
        `ECHO_WINDOWS_VC_RUNTIME_DIR does not contain the required x64 runtime DLLs: ${configuredDirectory}`,
      );
    }
    return configuredDirectory;
  }

  const toolsRedistDirectory = process.env.VCToolsRedistDir?.trim();
  if (toolsRedistDirectory) {
    candidates.push(
      toolsRedistDirectory,
      join(toolsRedistDirectory, 'x64', 'Microsoft.VC143.CRT'),
      join(toolsRedistDirectory, 'x64', 'Microsoft.VC142.CRT'),
    );
    appendVersionedCandidates(candidates, toolsRedistDirectory);
  }

  const visualStudioInstallation = findVisualStudioInstallation();
  if (visualStudioInstallation) {
    const redistRoot = join(visualStudioInstallation, 'VC', 'Redist', 'MSVC');
    appendVersionedCandidates(candidates, redistRoot);
  }

  return candidates.find(containsRequiredRuntime) ?? null;
};

const verifyMicrosoftSignatures = (paths) => {
  const powershell = `
$ErrorActionPreference = 'Stop'
$paths = $env:ECHO_VC_RUNTIME_PATHS_JSON | ConvertFrom-Json
$results = foreach ($path in $paths) {
  $signature = Get-AuthenticodeSignature -LiteralPath $path
  [pscustomobject]@{
    Path = $path
    Status = $signature.Status.ToString()
    Subject = if ($null -ne $signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '' }
    PublicKeyOid = if ($null -ne $signature.SignerCertificate) { $signature.SignerCertificate.PublicKey.Oid.Value } else { '' }
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
      env: { ...process.env, ECHO_VC_RUNTIME_PATHS_JSON: JSON.stringify(paths) },
      windowsHide: true,
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Failed to verify Microsoft VC++ Runtime signatures.');
  }

  const parsed = JSON.parse(result.stdout.trim());
  const signatures = Array.isArray(parsed) ? parsed : [parsed];
  const invalid = signatures.filter(
    (signature) =>
      signature.Status !== 'Valid' ||
      typeof signature.Subject !== 'string' ||
      !signature.Subject.toLocaleLowerCase().includes('microsoft corporation') ||
      signature.PublicKeyOid !== '1.2.840.113549.1.1.1',
  );
  if (invalid.length > 0) {
    throw new Error(`Refusing to package untrusted VC++ Runtime files:\n${JSON.stringify(invalid, null, 2)}`);
  }
};

if (process.platform !== 'win32') {
  throw new Error('Windows VC++ Runtime preparation must run on Windows.');
}

const runtimeDirectory = findRuntimeDirectory();
if (!runtimeDirectory) {
  throw new Error(
    [
      'Microsoft VC++ 2015-2022 x64 Runtime files were not found.',
      'Install the Visual Studio C++ build tools or set ECHO_WINDOWS_VC_RUNTIME_DIR to Microsoft.VC143.CRT.',
    ].join('\n'),
  );
}

const runtimePaths = requiredRuntimeFiles.map((fileName) => join(runtimeDirectory, fileName));
verifyMicrosoftSignatures(runtimePaths);

rmSync(stagingDirectory, { recursive: true, force: true });
mkdirSync(stagingDirectory, { recursive: true });

let totalBytes = 0;
for (const sourcePath of runtimePaths) {
  const destinationPath = join(stagingDirectory, basename(sourcePath));
  copyFileSync(sourcePath, destinationPath);
  totalBytes += statSync(destinationPath).size;
}

console.log(
  `[prepare:win-vc-runtime] staged ${requiredRuntimeFiles.length} trusted x64 runtime DLLs (${(
    totalBytes /
    1024 /
    1024
  ).toFixed(2)} MB) from ${runtimeDirectory}`,
);
