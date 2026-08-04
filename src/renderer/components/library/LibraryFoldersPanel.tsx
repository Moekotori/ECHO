import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, FolderPlus, RefreshCw, RotateCw, Trash2, XCircle } from 'lucide-react';
import type { LibraryFolder, LibraryScanStatus } from '../../../shared/types/library';
import {
  forgetLibraryScanStatus,
  getLibraryScanStatuses,
  rememberLibraryScanStatus,
  subscribeLibraryScanStatuses,
  type ScanStatusByFolder,
} from '../../stores/libraryScanSession';
import {
  getLibraryDatabaseRecoveryMessage,
  isLibraryDatabaseCorruptionError,
  openLibraryDatabaseRecoverySettings,
} from '../../utils/databaseRecovery';
import { getLibraryBridge } from '../../utils/echoBridge';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';
import { formatUserFacingError, getRawErrorMessage } from '../../utils/userFacingError';

type LibraryFoldersPanelProps = {
  autoRefresh?: boolean;
  autoFocus?: boolean;
  defaultCollapsed?: boolean;
  pollScanStatuses?: boolean;
  showOsuFolderImport?: boolean;
};

const terminalStatuses = new Set<LibraryScanStatus['status']>(['completed', 'failed', 'cancelled']);
const runningStatuses = new Set<LibraryScanStatus['status']>(['queued', 'running']);
let sharedNotifiedJobIds = new Set<string>();
type TranslateOptions = Record<string, string | number>;
type Translate = (key: TranslationKey, options?: TranslateOptions) => string;
const fallbackT: Translate = translateFallback;

export const __resetLibraryFolderScanSessionForTests = (): void => {
  sharedNotifiedJobIds = new Set<string>();
};

const statusLabel = (status: LibraryScanStatus['status'], t: Translate): string => {
  switch (status) {
    case 'queued':
      return t('mediaLibrary.folders.status.queued');
    case 'running':
      return t('mediaLibrary.folders.status.running');
    case 'completed':
      return t('mediaLibrary.folders.status.completed');
    case 'cancelled':
      return t('mediaLibrary.folders.status.cancelled');
    case 'failed':
      return t('mediaLibrary.folders.status.failed');
    default:
      return status;
  }
};

const phaseLabel = (phase: LibraryScanStatus['phase'], t: Translate): string => {
  switch (phase) {
    case 'queued':
      return t('mediaLibrary.folders.phase.queued');
    case 'discovering':
      return t('mediaLibrary.folders.phase.discovering');
    case 'checking_cache':
      return t('mediaLibrary.folders.phase.checkingCache');
    case 'reading_metadata':
      return t('mediaLibrary.folders.phase.readingMetadata');
    case 'extracting_covers':
      return t('mediaLibrary.folders.phase.extractingCovers');
    case 'grouping_albums':
      return t('mediaLibrary.folders.phase.groupingAlbums');
    case 'writing_database':
      return t('mediaLibrary.folders.phase.writingDatabase');
    case 'finished':
      return t('mediaLibrary.folders.phase.finished');
    case 'failed':
      return t('mediaLibrary.folders.phase.failed');
    case 'cancelled':
      return t('mediaLibrary.folders.phase.cancelled');
    default:
      return phase;
  }
};

const formatFolderError = (error: unknown, t: Translate): string => {
  const message = getRawErrorMessage(error);
  const upper = message.toUpperCase();

  if (upper.includes('ENOENT')) {
    return t('mediaLibrary.folders.error.pathMissing');
  }

  if (upper.includes('ENOTDIR')) {
    return t('mediaLibrary.folders.error.notFolder');
  }

  if (upper.includes('EACCES') || upper.includes('EPERM')) {
    return t('mediaLibrary.folders.error.noAccess');
  }

  if (upper.includes('ALREADY EXISTS') || upper.includes('UNIQUE')) {
    return t('mediaLibrary.folders.error.alreadyExists');
  }

  return formatUserFacingError(error, { context: 'folders', fallback: t('mediaLibrary.folders.error.importFailed') });
};

export const LibraryFoldersPanel = ({
  autoFocus = false,
  autoRefresh = true,
  defaultCollapsed = false,
  pollScanStatuses = true,
  showOsuFolderImport = false,
}: LibraryFoldersPanelProps): JSX.Element => {
  const t = useOptionalI18n()?.t ?? fallbackT;
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [folderPath, setFolderPath] = useState('');
  const [scanStatuses, setScanStatuses] = useState<ScanStatusByFolder>(getLibraryScanStatuses);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [databaseRecoveryAvailable, setDatabaseRecoveryAvailable] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const refreshFolders = useCallback(async () => {
    try {
      const library = getLibraryBridge();

      if (!library) {
        setFolders([]);
        setError(t('mediaLibrary.folders.error.bridgeManage'));
        setDatabaseRecoveryAvailable(false);
        return;
      }

      setFolders(await library.getFolders());
      setError(null);
      setDatabaseRecoveryAvailable(false);
    } catch (refreshError) {
      if (isLibraryDatabaseCorruptionError(refreshError)) {
        setError(getLibraryDatabaseRecoveryMessage());
        setDatabaseRecoveryAvailable(true);
        return;
      }
      setError(formatFolderError(refreshError, t));
      setDatabaseRecoveryAvailable(false);
    } finally {
      setFoldersLoaded(true);
    }
  }, [t]);

  const dispatchLibraryChanged = useCallback(async () => {
    try {
      await getLibraryBridge()?.getSummary();
    } catch {
      // Summary warmup is best-effort.
    }

    window.dispatchEvent(new Event('library:changed'));
    await refreshFolders();
  }, [refreshFolders]);

  const updateScanStatus = useCallback((status: LibraryScanStatus) => {
    rememberLibraryScanStatus(status);
  }, []);

  const startScan = useCallback(
    async (folderId: string, statusMessage?: string): Promise<void> => {
      const library = getLibraryBridge();

      if (!library) {
        setError(t('mediaLibrary.folders.error.bridgeScan'));
        setDatabaseRecoveryAvailable(false);
        return;
      }

      const currentScan = getLibraryScanStatuses()[folderId];
      if (currentScan && runningStatuses.has(currentScan.status)) {
        setMessage(t('mediaLibrary.folders.message.alreadyScanning'));
        return;
      }

      const scan = await library.scanFolder(folderId);
      updateScanStatus(scan);

      if (statusMessage) {
        setMessage(statusMessage);
      }
    },
    [t, updateScanStatus],
  );

  const importFolderPath = useCallback(
    async (selectedPath: string): Promise<void> => {
      const normalizedPath = selectedPath.trim();

      if (!normalizedPath) {
        return;
      }

      setError(null);
      const alreadyImported = folders.some((folder) => folder.path === normalizedPath);

      try {
        const library = getLibraryBridge();

        if (!library) {
          setError(t('mediaLibrary.folders.error.bridgeImport'));
          setDatabaseRecoveryAvailable(false);
          return;
        }

        const folder = await library.addFolder(normalizedPath);
        setFolderPath(normalizedPath);
        setMessage(alreadyImported ? t('mediaLibrary.folders.message.rescanExisting') : t('mediaLibrary.folders.message.addedScanning'));
        await refreshFolders();
        await startScan(folder.id, alreadyImported ? t('mediaLibrary.folders.message.rescanExisting') : t('mediaLibrary.folders.message.addedScanning'));
      } catch (importError) {
        if (isLibraryDatabaseCorruptionError(importError)) {
          setError(getLibraryDatabaseRecoveryMessage());
          setDatabaseRecoveryAvailable(true);
          return;
        }
        setError(formatFolderError(importError, t));
        setDatabaseRecoveryAvailable(false);
      }
    },
    [folders, refreshFolders, startScan, t],
  );

  const handleChooseFolder = useCallback(async (): Promise<void> => {
    try {
      const library = getLibraryBridge();

      if (!library) {
        setError(t('mediaLibrary.folders.error.bridgeChoose'));
        return;
      }

      const chosenPath = await library.chooseFolder();

      if (!chosenPath) {
        return;
      }

      setFolderPath(chosenPath);
      await importFolderPath(chosenPath);
    } catch (chooseError) {
      setError(formatFolderError(chooseError, t));
    }
  }, [importFolderPath, t]);

  const handleAddAndScan = useCallback(async (): Promise<void> => {
    await importFolderPath(folderPath);
  }, [folderPath, importFolderPath]);

  const handleCancelScan = useCallback(
    async (folderId: string, jobId: string): Promise<void> => {
      try {
        const library = getLibraryBridge();

        if (!library) {
          setError(t('mediaLibrary.folders.error.bridgeCancel'));
          return;
        }

        const scan = await library.cancelScan(jobId);
        updateScanStatus(scan);
        setMessage(t('mediaLibrary.folders.message.scanCancelled'));
        await dispatchLibraryChanged();
      } catch (cancelError) {
        setError(formatFolderError(cancelError, t));
      }
    },
    [dispatchLibraryChanged, t, updateScanStatus],
  );

  const handleRemoveFolder = useCallback(
    async (folderId: string): Promise<void> => {
      try {
        const library = getLibraryBridge();

        if (!library) {
          setError(t('mediaLibrary.folders.error.bridgeRemove'));
          return;
        }

        await library.removeFolder(folderId);
        forgetLibraryScanStatus(folderId);
        setMessage(t('mediaLibrary.folders.message.folderRemoved'));
        await dispatchLibraryChanged();
      } catch (removeError) {
        setError(formatFolderError(removeError, t));
      }
    },
    [dispatchLibraryChanged, t],
  );

  useEffect(() => {
    if (!autoRefresh || isCollapsed) {
      return;
    }

    void refreshFolders();
  }, [autoRefresh, isCollapsed, refreshFolders]);

  useEffect(() => {
    return subscribeLibraryScanStatuses(setScanStatuses);
  }, []);

  useEffect(() => {
    if (!autoFocus) {
      return;
    }

    inputRef.current?.focus();
  }, [autoFocus]);

  const activeJobIds = useMemo(
    () =>
      Object.values(scanStatuses)
        .filter((status) => runningStatuses.has(status.status))
        .map((status) => status.id)
        .sort(),
    [scanStatuses],
  );

  useEffect(() => {
    if (!pollScanStatuses || activeJobIds.length === 0) {
      return undefined;
    }

    const pollActiveJobs = (): void => {
      const libraryBridge = getLibraryBridge();

      if (!libraryBridge) {
        return;
      }

      for (const jobId of activeJobIds) {
        void Promise.resolve(libraryBridge.getScanStatus(jobId)).then((status) => {
          if (status) {
            updateScanStatus(status);
          }
        });
      }
    };

    pollActiveJobs();
    const timer = window.setInterval(pollActiveJobs, 1000);

    return () => window.clearInterval(timer);
  }, [activeJobIds, pollScanStatuses, updateScanStatus]);

  useEffect(() => {
    for (const status of Object.values(scanStatuses)) {
      const isTerminal = terminalStatuses.has(status.status);

      if (isTerminal && !sharedNotifiedJobIds.has(status.id)) {
        sharedNotifiedJobIds.add(status.id);
        void dispatchLibraryChanged();
        setMessage(
          status.status === 'completed'
            ? t('mediaLibrary.folders.message.scanCompleted')
            : status.status === 'cancelled'
              ? t('mediaLibrary.folders.message.scanCancelled')
              : t('mediaLibrary.folders.message.scanFailed'),
        );
      }

      if (!isTerminal) {
        sharedNotifiedJobIds.delete(status.id);
      }
    }
  }, [dispatchLibraryChanged, scanStatuses, t]);

  const bodyId = 'library-folders-panel-body';

  return (
    <section className="audio-dev-panel library-folders-panel" aria-label={t('mediaLibrary.folders.aria')} data-collapsed={isCollapsed ? 'true' : 'false'}>
      <div className="audio-dev-header">
        <div>
          <span className="panel-kicker">{t('mediaLibrary.kicker')}</span>
          <h2>{t('mediaLibrary.folders.title')}</h2>
        </div>
        <div className="library-folders-panel-actions">
          {!isCollapsed ? (
            <button className="tool-button" type="button" aria-label={t('mediaLibrary.folders.action.refresh')} title={t('mediaLibrary.folders.action.refresh')} onClick={() => void refreshFolders()}>
              <RefreshCw size={17} />
            </button>
          ) : null}
          <button
            className="settings-collapse-toggle library-folders-panel-toggle"
            type="button"
            aria-controls={bodyId}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? t('mediaLibrary.folders.action.expand') : t('mediaLibrary.folders.action.collapse')}
            title={isCollapsed ? t('mediaLibrary.folders.action.expand') : t('mediaLibrary.folders.action.collapse')}
            onClick={() => setIsCollapsed((current) => !current)}
          >
            <span>{isCollapsed ? t('mediaLibrary.folders.action.expandShort') : t('mediaLibrary.folders.action.collapseShort')}</span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {!isCollapsed ? (
        <div id={bodyId} className="library-folders-panel-body">
      <div className="library-folder-entry">
        <label className="audio-field">
          <span>{t('mediaLibrary.folders.field.path')}</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="D:\\Music"
            value={folderPath}
            onChange={(event) => setFolderPath(event.target.value)}
          />
        </label>
        <button className="audio-command-button" type="button" onClick={() => void handleChooseFolder()}>
          <FolderPlus size={17} />
          <span>{t('mediaLibrary.folders.action.choose')}</span>
        </button>
        <button className="audio-command-button" type="button" onClick={() => void handleAddAndScan()} disabled={!folderPath.trim()}>
          <RotateCw size={17} />
          <span>{t('mediaLibrary.folders.action.addScan')}</span>
        </button>
        {showOsuFolderImport ? null : null}
      </div>

      {message ? <p className="audio-file-path">{message}</p> : null}
      {error ? (
        <div className="library-database-recovery-callout">
          <p className="audio-error">{error}</p>
          {databaseRecoveryAvailable ? (
            <button className="settings-action-button" type="button" onClick={openLibraryDatabaseRecoverySettings}>
              {t('mediaLibrary.folders.action.recovery')}
            </button>
          ) : null}
        </div>
      ) : null}

      {!foldersLoaded && !autoRefresh ? (
        <p className="audio-empty">{t('mediaLibrary.folders.empty.deferred')}</p>
      ) : folders.length === 0 ? (
        <p className="audio-empty">{t('mediaLibrary.folders.empty.none')}</p>
      ) : (
        <div className="library-folder-list">
          {folders.map((folder) => {
            const scan = scanStatuses[folder.id];
            const isScanning = scan ? runningStatuses.has(scan.status) : false;

            return (
              <div className="library-folder-row" key={folder.id}>
                <div>
                  <strong>{folder.name}</strong>
                  <span>{folder.path}</span>
                  {scan ? (
                    <small>
                      {t('mediaLibrary.folders.scan.progress', {
                        status: statusLabel(scan.status, t),
                        phase: phaseLabel(scan.phase, t),
                        processed: scan.processedFiles,
                        total: scan.totalFiles,
                        skipped: scan.skippedFiles,
                      })}
                    </small>
                  ) : (
                    <small>{t('mediaLibrary.folders.status.ready')}</small>
                  )}
                </div>
                <button
                  className="audio-icon-command"
                  type="button"
                  aria-label={t('mediaLibrary.folders.action.scan')}
                  title={t('mediaLibrary.folders.action.scan')}
                  onClick={() => void startScan(folder.id)}
                  disabled={isScanning}
                >
                  <RotateCw size={17} />
                </button>
                <button
                  className="audio-icon-command"
                  type="button"
                  aria-label={t('mediaLibrary.folders.action.cancelScan')}
                  title={t('mediaLibrary.folders.action.cancelScan')}
                  onClick={() => scan && void handleCancelScan(folder.id, scan.id)}
                  disabled={!isScanning || !scan}
                >
                  <XCircle size={17} />
                </button>
                <button
                  className="audio-icon-command danger"
                  type="button"
                  aria-label={t('mediaLibrary.folders.action.remove')}
                  title={t('mediaLibrary.folders.action.remove')}
                  onClick={() => void handleRemoveFolder(folder.id)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            );
          })}
        </div>
      )}
        </div>
      ) : null}
    </section>
  );
};
