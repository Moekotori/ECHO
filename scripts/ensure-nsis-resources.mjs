import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';

const cacheRoot =
  process.env.ELECTRON_BUILDER_CACHE ||
  (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache') : null);

const pluginArches = ['x86-unicode', 'x86-ansi'];

const safeStat = (path) => {
  try {
    return statSync(path);
  } catch {
    return null;
  }
};

const listDirectories = (path) => {
  if (!path || !existsSync(path)) {
    return [];
  }

  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(path, entry.name));
};

const findNewestDirectory = (paths) =>
  paths
    .map((path) => ({ path, mtimeMs: safeStat(path)?.mtimeMs ?? 0 }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.path ?? null;

const removeConflictingBundledPlugins = (sourceDir, targetDir) => {
  if (!sourceDir || !targetDir || !existsSync(sourceDir)) {
    return 0;
  }

  let removed = 0;
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.dll')) {
      continue;
    }

    const target = join(targetDir, entry.name);
    if (!existsSync(target)) {
      continue;
    }

    unlinkSync(target);
    removed += 1;
    console.log(`[ensure:nsis-resources] removed duplicate ${target}`);
  }

  return removed;
};

if (!cacheRoot) {
  console.warn('[ensure:nsis-resources] skipped: ELECTRON_BUILDER_CACHE/LOCALAPPDATA is unavailable');
  process.exit(0);
}

const nsisCacheRoot = join(cacheRoot, 'nsis');
const sourceRoot = findNewestDirectory(
  listDirectories(nsisCacheRoot).filter((path) => basename(path).startsWith('nsis-resources-')),
);
const nsisRoots = listDirectories(nsisCacheRoot).filter((path) => {
  const name = basename(path);
  return name.startsWith('nsis-') && !name.startsWith('nsis-resources-');
});

if (!sourceRoot || nsisRoots.length === 0) {
  console.warn('[ensure:nsis-resources] skipped: NSIS cache is not populated yet');
  process.exit(0);
}

const requiredPlugin = join(sourceRoot, 'plugins', 'x86-unicode', 'StdUtils.dll');
if (!existsSync(requiredPlugin)) {
  console.warn(`[ensure:nsis-resources] warning: missing ${requiredPlugin}`);
}

let removed = 0;
for (const nsisRoot of nsisRoots) {
  for (const arch of pluginArches) {
    removed += removeConflictingBundledPlugins(join(sourceRoot, 'plugins', arch), join(nsisRoot, 'Plugins', arch));
  }
}

if (removed === 0) {
  console.log('[ensure:nsis-resources] NSIS plugin cache has no resource duplicates');
}
