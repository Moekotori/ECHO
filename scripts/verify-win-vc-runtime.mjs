import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const requiredRuntimeFiles = [
  'msvcp140.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll',
];
const runtimeDependencyPattern =
  /\b(?:concrt140|msvcp140(?:_\d+|_atomic_wait|_codecvt_ids)?|vccorlib140|vcruntime140(?:_\d+|_threads)?)\.dll\b/giu;
const binaryExtensions = new Set(['.exe', '.dll', '.node']);

const root = fileURLToPath(new URL('..', import.meta.url));
const unpackedDirectory = join(root, 'dist', 'win-unpacked');
const resourcesDirectory = join(unpackedDirectory, 'resources');
const toolsDirectory = join(resourcesDirectory, 'tools');

if (process.platform !== 'win32') {
  throw new Error('Windows VC++ Runtime verification must run on Windows.');
}

const requiredDirectories = [resourcesDirectory, toolsDirectory];
const missingRuntimeFiles = requiredDirectories.flatMap((directory) =>
  requiredRuntimeFiles
    .map((fileName) => join(directory, fileName))
    .filter((filePath) => !existsSync(filePath)),
);
if (missingRuntimeFiles.length > 0) {
  throw new Error(`Packaged VC++ Runtime files are missing:\n${missingRuntimeFiles.join('\n')}`);
}

const listNativeBinaries = (directory) => {
  if (!existsSync(directory)) {
    return [];
  }

  const binaries = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      binaries.push(...listNativeBinaries(path));
    } else if (entry.isFile() && binaryExtensions.has(extname(entry.name).toLocaleLowerCase())) {
      binaries.push(path);
    }
  }
  return binaries;
};

const scanRuntimeDependencies = async (filePath) => {
  const dependencies = new Set();
  let trailingText = '';

  for await (const chunk of createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
    const text = trailingText + chunk.toString('latin1');
    for (const match of text.matchAll(runtimeDependencyPattern)) {
      dependencies.add(match[0].toLocaleLowerCase());
    }
    trailingText = text.slice(-96);
  }

  return [...dependencies].sort();
};

const binaries = listNativeBinaries(unpackedDirectory);
if (binaries.length === 0) {
  throw new Error(`No packaged Windows native binaries were found under ${resourcesDirectory}.`);
}

const unresolvedDependencies = [];
let dependencyCount = 0;
for (const binaryPath of binaries) {
  const dependencies = await scanRuntimeDependencies(binaryPath);
  dependencyCount += dependencies.length;
  for (const dependency of dependencies) {
    if (!existsSync(join(dirname(binaryPath), dependency))) {
      unresolvedDependencies.push(`${binaryPath}: ${dependency}`);
    }
  }
}

if (unresolvedDependencies.length > 0) {
  throw new Error(
    `Packaged Windows binaries have unresolved app-local VC++ Runtime dependencies:\n${unresolvedDependencies.join('\n')}`,
  );
}

const packagedRuntimeBytes = requiredDirectories.reduce(
  (total, directory) =>
    total + requiredRuntimeFiles.reduce((directoryTotal, fileName) => directoryTotal + statSync(join(directory, fileName)).size, 0),
  0,
);
console.log(
  `[verify:win-vc-runtime] ${binaries.length} PE binaries checked; ${dependencyCount} runtime import(s) resolved app-locally using ${(
    packagedRuntimeBytes /
    1024 /
    1024
  ).toFixed(2)} MB on disk.`,
);
