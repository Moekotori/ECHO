import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

const ECHO_DIR = 'echo-next';
const LEGACY_FOLDER_NAME = 'ECHO NEXT';

const isLinux = (): boolean => process.platform === 'linux';

const envVar = (name: string, defaultPath: string): string =>
  process.env[name]?.trim() || defaultPath;

let _configPath: string | null = null;
let _dataPath: string | null = null;
let _cachePath: string | null = null;

/** Resolved XDG config path (~/.config/echo-next). */
export const getConfigPath = (): string => {
  if (!_configPath) throw new Error('xdgPaths: not initialized');
  return _configPath;
};

/** Resolved XDG data path (~/.local/share/echo-next). */
export const getDataPath = (): string => {
  if (!_dataPath) throw new Error('xdgPaths: not initialized');
  return _dataPath;
};

/** Resolved XDG cache path (~/.cache/echo-next). */
export const getCachePath = (): string => {
  if (!_cachePath) throw new Error('xdgPaths: not initialized');
  return _cachePath;
};

/**
 * Initialise XDG base directory paths.
 * Must be called once at app startup, before any path-dependent service.
 *
 * On Linux the three XDG directories are created and `app.setPath('userData')`
 * is pointed at the config directory so existing `app.getPath('userData')`
 * consumers continue to work for config-like files.
 * A one-shot migration moves data from the legacy `~/.config/ECHO NEXT`
 * directory into the proper XDG layout.
 *
 * On Windows / macOS — no-op (Electron defaults are used unchanged).
 *
 * Returns the config path (the new `userData`).
 */
export const initializeXdgPaths = (): string => {
  if (_configPath) return _configPath;

  if (!isLinux()) {
    _configPath = app.getPath('userData');
    _dataPath = app.getPath('userData');
    _cachePath = app.getPath('userData');
    return _configPath;
  }

  const xdgConfigHome = envVar('XDG_CONFIG_HOME', join(process.env.HOME ?? '/tmp', '.config'));
  const xdgDataHome = envVar('XDG_DATA_HOME', join(process.env.HOME ?? '/tmp', '.local', 'share'));
  const xdgCacheHome = envVar('XDG_CACHE_HOME', join(process.env.HOME ?? '/tmp', '.cache'));

  _configPath = join(xdgConfigHome, ECHO_DIR);
  _dataPath = join(xdgDataHome, ECHO_DIR);
  _cachePath = join(xdgCacheHome, ECHO_DIR);

  mkdirSync(_configPath, { recursive: true });
  mkdirSync(_dataPath, { recursive: true });
  mkdirSync(_cachePath, { recursive: true });

  if (app.setPath) {
    app.setPath('userData', _configPath);
  }

  return _configPath;
};

const configItems = new Set([
  'echo-settings.json',
  'accounts.json',
  'eq',
  'eq-presets.json',
  'eq-state.json',
  'eq-profiles.json',
  'echo-download-settings.json',
  'streaming-favorites.json',
  'room-correction-state.json',
]);

const cacheItems = new Set([
  'smtc-covers',
]);

/** Migrate legacy `~/.config/ECHO NEXT` → XDG layout. Runs at most once. */
export const migrateLegacyXdgData = (): void => {
  if (!isLinux()) return;

  const legacyDir = join(
    envVar('XDG_CONFIG_HOME', join(process.env.HOME ?? '/tmp', '.config')),
    LEGACY_FOLDER_NAME,
  );

  if (!existsSync(legacyDir)) return;

  const sentinel = join(_configPath!, '.xdg-migration-done');
  if (existsSync(sentinel)) return;

  let entries: string[];
  try {
    entries = readdirSync(legacyDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === 'data-protection' || entry === 'eq-backups' || entry.startsWith('.')) continue;

    const sourcePath = join(legacyDir, entry);

    if (configItems.has(entry)) {
      const dest = join(_configPath!, entry);
      if (!existsSync(dest)) {
        try { renameSync(sourcePath, dest); } catch { /* ignore */ }
      }
    } else if (cacheItems.has(entry)) {
      const dest = join(_cachePath!, entry);
      if (!existsSync(dest)) {
        try { renameSync(sourcePath, dest); } catch { /* ignore */ }
      }
    } else {
      const dest = join(_dataPath!, entry);
      if (!existsSync(dest)) {
        try { renameSync(sourcePath, dest); } catch { /* ignore */ }
      }
    }
  }

  try {
    writeFileSync(sentinel, `${new Date().toISOString()}\n`, 'utf8');
  } catch { /* best-effort */ }
};

/** Alias for getConfigPath — drop-in for existing `app.getPath('userData')` call sites. */
export const getUserDataPath = (): string => getConfigPath();
