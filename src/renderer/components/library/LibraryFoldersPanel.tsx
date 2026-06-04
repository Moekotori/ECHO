import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderPlus, RefreshCw, RotateCw, Trash2, XCircle } from 'lucide-react';
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

type LibraryFoldersPanelProps = {
  autoRefresh?: boolean;
  autoFocus?: boolean;
  pollScanStatuses?: boolean;
};

const terminalStatuses = new Set<LibraryScanStatus['status']>(['completed', 'failed', 'cancelled']);
const runningStatuses = new Set<LibraryScanStatus['status']>(['queued', 'running']);
let sharedNotifiedJobIds = new Set<string>();

export const __resetLibraryFolderScanSessionForTests = (): void => {
  sharedNotifiedJobIds = new Set<string>();
};

const statusLabel = (status: LibraryScanStatus['status']): string => {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'running':
      return '扫描中';
    case 'completed':
      return '已完成';
    case 'cancelled':
      return '已取消';
    case 'failed':
      return '失败';
    default:
      return status;
  }
};

const phaseLabel = (phase: LibraryScanStatus['phase']): string => {
  switch (phase) {
    case 'queued':
      return '排队';
    case 'discovering':
      return '发现文件';
    case 'checking_cache':
      return '检查缓存';
    case 'reading_metadata':
      return '读取元数据';
    case 'extracting_covers':
      return '处理封面';
    case 'grouping_albums':
      return '整理专辑';
    case 'writing_database':
      return '写入数据库';
    case 'finished':
      return '完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '取消';
    default:
      return phase;
  }
};

const formatFolderError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const upper = message.toUpperCase();

  if (upper.includes('ENOENT')) {
    return '路径不存在';
  }

  if (upper.includes('ENOTDIR')) {
    return '不是文件夹';
  }

  if (upper.includes('EACCES') || upper.includes('EPERM')) {
    return '没有访问权限';
  }

  if (upper.includes('ALREADY EXISTS') || upper.includes('UNIQUE')) {
    return '文件夹已存在';
  }

  return message || '导入失败';
};

export const LibraryFoldersPanel = ({
  autoFocus = false,
  autoRefresh = true,
  pollScanStatuses = true,
}: LibraryFoldersPanelProps): JSX.Element => {
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [folderPath, setFolderPath] = useState('');
  const [scanStatuses, setScanStatuses] = useState<ScanStatusByFolder>(getLibraryScanStatuses);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [databaseRecoveryAvailable, setDatabaseRecoveryAvailable] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const refreshFolders = useCallback(async () => {
    try {
      const library = getLibraryBridge();

      if (!library) {
        setFolders([]);
        setError('桌面桥接不可用。请在 ECHO Next 桌面端管理曲库文件夹。');
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
      setError(formatFolderError(refreshError));
      setDatabaseRecoveryAvailable(false);
    } finally {
      setFoldersLoaded(true);
    }
  }, []);

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
        setError('桌面桥接不可用。请在 ECHO Next 桌面端扫描文件夹。');
        setDatabaseRecoveryAvailable(false);
        return;
      }

      const currentScan = getLibraryScanStatuses()[folderId];
      if (currentScan && runningStatuses.has(currentScan.status)) {
        setMessage('该文件夹正在后台扫描');
        return;
      }

      const scan = await library.scanFolder(folderId);
      updateScanStatus(scan);

      if (statusMessage) {
        setMessage(statusMessage);
      }
    },
    [updateScanStatus],
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
          setError('桌面桥接不可用。请在 ECHO Next 桌面端导入文件夹。');
          setDatabaseRecoveryAvailable(false);
          return;
        }

        const folder = await library.addFolder(normalizedPath);
        setFolderPath(normalizedPath);
        setMessage(alreadyImported ? '文件夹已存在，开始重新扫描' : '文件夹已添加，开始扫描');
        await refreshFolders();
        await startScan(folder.id, alreadyImported ? '文件夹已存在，开始重新扫描' : '文件夹已添加，开始扫描');
      } catch (importError) {
        if (isLibraryDatabaseCorruptionError(importError)) {
          setError(getLibraryDatabaseRecoveryMessage());
          setDatabaseRecoveryAvailable(true);
          return;
        }
        setError(formatFolderError(importError));
        setDatabaseRecoveryAvailable(false);
      }
    },
    [folders, refreshFolders, startScan],
  );

  const handleChooseFolder = useCallback(async (): Promise<void> => {
    try {
      const library = getLibraryBridge();

      if (!library) {
        setError('桌面桥接不可用。请在 ECHO Next 桌面端选择文件夹。');
        return;
      }

      const chosenPath = await library.chooseFolder();

      if (!chosenPath) {
        return;
      }

      setFolderPath(chosenPath);
      await importFolderPath(chosenPath);
    } catch (chooseError) {
      setError(formatFolderError(chooseError));
    }
  }, [importFolderPath]);

  const handleAddAndScan = useCallback(async (): Promise<void> => {
    await importFolderPath(folderPath);
  }, [folderPath, importFolderPath]);

  const handleCancelScan = useCallback(
    async (folderId: string, jobId: string): Promise<void> => {
      try {
        const library = getLibraryBridge();

        if (!library) {
          setError('桌面桥接不可用。请在 ECHO Next 桌面端取消扫描。');
          return;
        }

        const scan = await library.cancelScan(jobId);
        updateScanStatus(scan);
        setMessage('扫描已取消');
        await dispatchLibraryChanged();
      } catch (cancelError) {
        setError(formatFolderError(cancelError));
      }
    },
    [dispatchLibraryChanged, updateScanStatus],
  );

  const handleRemoveFolder = useCallback(
    async (folderId: string): Promise<void> => {
      try {
        const library = getLibraryBridge();

        if (!library) {
          setError('桌面桥接不可用。请在 ECHO Next 桌面端移除文件夹。');
          return;
        }

        await library.removeFolder(folderId);
        forgetLibraryScanStatus(folderId);
        setMessage('文件夹已移除');
        await dispatchLibraryChanged();
      } catch (removeError) {
        setError(formatFolderError(removeError));
      }
    },
    [dispatchLibraryChanged],
  );

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }

    void refreshFolders();
  }, [autoRefresh, refreshFolders]);

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
            ? '扫描完成'
            : status.status === 'cancelled'
              ? '扫描已取消'
              : '扫描失败',
        );
      }

      if (!isTerminal) {
        sharedNotifiedJobIds.delete(status.id);
      }
    }
  }, [dispatchLibraryChanged, scanStatuses]);

  return (
    <section className="audio-dev-panel" aria-label="曲库文件夹">
      <div className="audio-dev-header">
        <div>
          <span className="panel-kicker">曲库</span>
          <h2>文件夹</h2>
        </div>
        <button className="tool-button" type="button" aria-label="刷新文件夹" title="刷新文件夹" onClick={() => void refreshFolders()}>
          <RefreshCw size={17} />
        </button>
      </div>

      <div className="library-folder-entry">
        <label className="audio-field">
          <span>文件夹路径</span>
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
          <span>选择文件夹</span>
        </button>
        <button className="audio-command-button" type="button" onClick={() => void handleAddAndScan()} disabled={!folderPath.trim()}>
          <RotateCw size={17} />
          <span>添加并扫描</span>
        </button>
      </div>

      {message ? <p className="audio-file-path">{message}</p> : null}
      {error ? (
        <div className="library-database-recovery-callout">
          <p className="audio-error">{error}</p>
          {databaseRecoveryAvailable ? (
            <button className="settings-action-button" type="button" onClick={openLibraryDatabaseRecoverySettings}>
              去恢复助手
            </button>
          ) : null}
        </div>
      ) : null}

      {!foldersLoaded && !autoRefresh ? (
        <p className="audio-empty">{'\u66f2\u5e93\u6587\u4ef6\u5939\u5c06\u5728\u754c\u9762\u7a7a\u95f2\u540e\u8bfb\u53d6\uff0c\u4e5f\u53ef\u4ee5\u70b9\u51fb\u5237\u65b0\u7acb\u5373\u8bfb\u53d6\u3002'}</p>
      ) : folders.length === 0 ? (
        <p className="audio-empty">还没有导入曲库文件夹。</p>
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
                      {statusLabel(scan.status)} / {phaseLabel(scan.phase)} / 已处理 {scan.processedFiles}/{scan.totalFiles}，跳过 {scan.skippedFiles}
                    </small>
                  ) : (
                    <small>就绪</small>
                  )}
                </div>
                <button
                  className="audio-icon-command"
                  type="button"
                  aria-label="扫描文件夹"
                  title="扫描文件夹"
                  onClick={() => void startScan(folder.id)}
                  disabled={isScanning}
                >
                  <RotateCw size={17} />
                </button>
                <button
                  className="audio-icon-command"
                  type="button"
                  aria-label="取消扫描"
                  title="取消扫描"
                  onClick={() => scan && void handleCancelScan(folder.id, scan.id)}
                  disabled={!isScanning || !scan}
                >
                  <XCircle size={17} />
                </button>
                <button
                  className="audio-icon-command danger"
                  type="button"
                  aria-label="移除文件夹"
                  title="移除文件夹"
                  onClick={() => void handleRemoveFolder(folder.id)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
