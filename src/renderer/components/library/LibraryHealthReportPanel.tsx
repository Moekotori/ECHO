import { useCallback, useMemo, useState } from 'react';
import { Clipboard, Download, FileText, RefreshCw } from 'lucide-react';
import type { LibraryHealthReport } from '../../../shared/types/library';
import { getLibraryBridge } from '../../utils/echoBridge';

const formatBytes = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let nextValue = value;
  let unitIndex = 0;
  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }
  return `${nextValue >= 10 || unitIndex === 0 ? nextValue.toFixed(0) : nextValue.toFixed(1)} ${units[unitIndex] ?? 'B'}`;
};

const summarizeReport = (report: LibraryHealthReport): string => [
  `ECHO Next 曲库体检报告 ${new Date(report.generatedAt).toLocaleString()}`,
  `曲库：${report.summary.songCount} 首 / ${report.summary.albumCount} 张专辑 / ${report.summary.artistCount} 位艺人 / ${report.summary.folderCount} 个文件夹`,
  `数据库：${report.database.status} / ${report.database.healthStatus} / 建议 ${report.database.recommendedAction}`,
  `扫描：${report.scan.status} / 错误 ${report.scan.errorCount}`,
  `资料质量：${report.quality.reduce((total, item) => total + item.count, 0)} 个问题`,
  `缓存：${formatBytes(report.cache.totalSizeBytes)} / ${report.cache.items.length} 类`,
  `实时更新：${report.watcher.enabled ? '开启' : '关闭'} / 待处理 ${report.watcher.pendingPathCount}`,
  `远程源：${report.remoteSources.total} 个 / 启用 ${report.remoteSources.enabled} / 错误 ${report.remoteSources.error}`,
  `警告：${report.warnings.length}`,
].join('\n');

const qualityTotal = (report: LibraryHealthReport | null): number =>
  report?.quality.reduce((total, item) => total + item.count, 0) ?? 0;

export const LibraryHealthReportPanel = (): JSX.Element => {
  const [expanded, setExpanded] = useState(false);
  const [report, setReport] = useState<LibraryHealthReport | null>(null);
  const [busyAction, setBusyAction] = useState<'refresh' | 'copy' | 'export' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const summaryLabel = useMemo(() => {
    if (!report) {
      return '尚未刷新';
    }
    return `${report.summary.songCount} 首 · ${report.warnings.length} 个警告 · ${qualityTotal(report)} 个资料问题`;
  }, [report]);

  const refreshReport = useCallback(async (): Promise<void> => {
    const library = getLibraryBridge();
    if (!library?.getHealthReport) {
      setMessage('桌面桥接暂不可用，无法读取曲库体检报告。');
      return;
    }

    setBusyAction('refresh');
    setMessage(null);
    try {
      setReport(await library.getHealthReport());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }, []);

  const handleToggleExpanded = useCallback((): void => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && !report) {
      void refreshReport();
    }
  }, [expanded, refreshReport, report]);

  const handleCopy = useCallback(async (): Promise<void> => {
    if (!report) {
      await refreshReport();
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setMessage('系统剪贴板暂不可用。');
      return;
    }

    setBusyAction('copy');
    setMessage(null);
    try {
      await navigator.clipboard.writeText(summarizeReport(report));
      setMessage('体检摘要已复制。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }, [refreshReport, report]);

  const handleExport = useCallback(async (): Promise<void> => {
    const library = getLibraryBridge();
    if (!library?.exportHealthReport) {
      setMessage('桌面桥接暂不可用，无法导出曲库体检报告。');
      return;
    }

    setBusyAction('export');
    setMessage(null);
    try {
      const exportedPath = await library.exportHealthReport();
      setMessage(exportedPath ? `已导出：${exportedPath}` : '已取消导出。');
      if (exportedPath && library.getHealthReport) {
        setReport(await library.getHealthReport());
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }, []);

  return (
    <div className="settings-cache-panel settings-cache-panel--library-health">
      <button
        aria-expanded={expanded}
        className="settings-library-health-summary"
        onClick={handleToggleExpanded}
        type="button"
      >
        <span>
          <strong>曲库体检报告</strong>
          <em>{busyAction === 'refresh' ? '正在刷新...' : summaryLabel}</em>
        </span>
        <FileText size={16} />
      </button>

      {expanded ? (
        <>
          <div className="settings-status-grid settings-library-health-grid">
            <span>
              <em>数据库</em>
              <strong>{report ? `${report.database.status} / ${report.database.recommendedAction}` : '未读取'}</strong>
            </span>
            <span>
              <em>扫描错误</em>
              <strong>{report ? report.scan.errorCount : '未读取'}</strong>
            </span>
            <span>
              <em>资料问题</em>
              <strong>{report ? qualityTotal(report) : '未读取'}</strong>
            </span>
            <span>
              <em>缓存</em>
              <strong>{report ? formatBytes(report.cache.totalSizeBytes) : '未读取'}</strong>
            </span>
            <span>
              <em>实时更新</em>
              <strong>{report ? (report.watcher.enabled ? '已开启' : '已关闭') : '未读取'}</strong>
            </span>
            <span>
              <em>远程源</em>
              <strong>{report ? `${report.remoteSources.total} 个` : '未读取'}</strong>
            </span>
          </div>

          {report?.warnings.length ? (
            <div className="settings-library-health-warnings" role="status">
              {report.warnings.slice(0, 4).map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}

          <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
            <button className="settings-action-button" type="button" disabled={busyAction !== null} onClick={() => void refreshReport()}>
              <RefreshCw className={busyAction === 'refresh' ? 'spinning-icon' : undefined} size={15} />
              刷新体检
            </button>
            <button className="settings-action-button" type="button" disabled={busyAction !== null || !report} onClick={() => void handleCopy()}>
              <Clipboard size={15} />
              复制摘要
            </button>
            <button className="settings-action-button" type="button" disabled={busyAction !== null} onClick={() => void handleExport()}>
              <Download size={15} />
              导出 Markdown
            </button>
          </div>

          {message ? <p className="settings-inline-note">{message}</p> : null}
        </>
      ) : null}
    </div>
  );
};
