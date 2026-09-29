import { useCallback, useMemo, useState } from 'react';
import { Clipboard, Download, FileText, RefreshCw } from 'lucide-react';
import type { LibraryHealthReport } from '../../../shared/types/library';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';
import { getLibraryBridge } from '../../utils/echoBridge';

type TranslateOptions = Record<string, string | number>;
type Translate = (key: TranslationKey, options?: TranslateOptions) => string;
const fallbackT: Translate = translateFallback;

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

const summarizeReport = (report: LibraryHealthReport, t: Translate): string => [
  t('mediaLibrary.health.summary.reportTitle', { time: new Date(report.generatedAt).toLocaleString() }),
  t('mediaLibrary.health.summary.library', {
    songs: report.summary.songCount,
    albums: report.summary.albumCount,
    artists: report.summary.artistCount,
    folders: report.summary.folderCount,
  }),
  t('mediaLibrary.health.summary.database', {
    status: report.database.status,
    health: report.database.healthStatus,
    action: report.database.recommendedAction,
  }),
  t('mediaLibrary.health.summary.scan', { status: report.scan.status, errors: report.scan.errorCount }),
  t('mediaLibrary.health.summary.quality', { count: report.quality.reduce((total, item) => total + item.count, 0) }),
  t('mediaLibrary.health.summary.cache', { size: formatBytes(report.cache.totalSizeBytes), count: report.cache.items.length }),
  t('mediaLibrary.health.summary.watcher', {
    state: report.watcher.enabled ? t('mediaLibrary.health.value.enabled') : t('mediaLibrary.health.value.disabled'),
    pending: report.watcher.pendingPathCount,
  }),
  t('mediaLibrary.health.summary.remote', {
    total: report.remoteSources.total,
    enabled: report.remoteSources.enabled,
    errors: report.remoteSources.error,
  }),
  t('mediaLibrary.health.summary.warnings', { count: report.warnings.length }),
].join('\n');

const qualityTotal = (report: LibraryHealthReport | null): number =>
  report?.quality.reduce((total, item) => total + item.count, 0) ?? 0;

export const LibraryHealthReportPanel = (): JSX.Element => {
  const t = useOptionalI18n()?.t ?? fallbackT;
  const [expanded, setExpanded] = useState(false);
  const [report, setReport] = useState<LibraryHealthReport | null>(null);
  const [busyAction, setBusyAction] = useState<'refresh' | 'copy' | 'export' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const summaryLabel = useMemo(() => {
    if (!report) {
      return t('mediaLibrary.health.summary.notRefreshed');
    }
    return t('mediaLibrary.health.summary.short', {
      songs: report.summary.songCount,
      warnings: report.warnings.length,
      issues: qualityTotal(report),
    });
  }, [report, t]);

  const refreshReport = useCallback(async (): Promise<void> => {
    const library = getLibraryBridge();
    if (!library?.getHealthReport) {
      setMessage(t('mediaLibrary.health.error.bridgeRead'));
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
  }, [t]);

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
      setMessage(t('mediaLibrary.health.error.clipboard'));
      return;
    }

    setBusyAction('copy');
    setMessage(null);
    try {
      await navigator.clipboard.writeText(summarizeReport(report, t));
      setMessage(t('mediaLibrary.health.message.copied'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }, [refreshReport, report, t]);

  const handleExport = useCallback(async (): Promise<void> => {
    const library = getLibraryBridge();
    if (!library?.exportHealthReport) {
      setMessage(t('mediaLibrary.health.error.bridgeExport'));
      return;
    }

    setBusyAction('export');
    setMessage(null);
    try {
      const exportedPath = await library.exportHealthReport();
      setMessage(exportedPath ? t('mediaLibrary.health.message.exported', { path: exportedPath }) : t('mediaLibrary.health.message.exportCancelled'));
      if (exportedPath && library.getHealthReport) {
        setReport(await library.getHealthReport());
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }, [t]);

  return (
    <div className="settings-cache-panel settings-cache-panel--library-health">
      <button
        aria-expanded={expanded}
        className="settings-library-health-summary"
        onClick={handleToggleExpanded}
        type="button"
      >
        <span>
          <strong>{t('mediaLibrary.health.title')}</strong>
          <em>{busyAction === 'refresh' ? t('mediaLibrary.health.message.refreshing') : summaryLabel}</em>
        </span>
        <FileText size={16} />
      </button>

      {expanded ? (
        <>
          <div className="settings-status-grid settings-library-health-grid">
            <span>
              <em>{t('mediaLibrary.health.metric.database')}</em>
              <strong>{report ? `${report.database.status} / ${report.database.recommendedAction}` : t('mediaLibrary.health.value.notRead')}</strong>
            </span>
            <span>
              <em>{t('mediaLibrary.health.metric.scanErrors')}</em>
              <strong>{report ? report.scan.errorCount : t('mediaLibrary.health.value.notRead')}</strong>
            </span>
            <span>
              <em>{t('mediaLibrary.health.metric.qualityIssues')}</em>
              <strong>{report ? qualityTotal(report) : t('mediaLibrary.health.value.notRead')}</strong>
            </span>
            <span>
              <em>{t('mediaLibrary.health.metric.cache')}</em>
              <strong>{report ? formatBytes(report.cache.totalSizeBytes) : t('mediaLibrary.health.value.notRead')}</strong>
            </span>
            <span>
              <em>{t('mediaLibrary.health.metric.liveUpdates')}</em>
              <strong>{report ? (report.watcher.enabled ? t('mediaLibrary.health.value.enabled') : t('mediaLibrary.health.value.disabled')) : t('mediaLibrary.health.value.notRead')}</strong>
            </span>
            <span>
              <em>{t('mediaLibrary.health.metric.remoteSources')}</em>
              <strong>{report ? t('mediaLibrary.health.value.remoteCount', { count: report.remoteSources.total }) : t('mediaLibrary.health.value.notRead')}</strong>
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
              {t('mediaLibrary.health.action.refresh')}
            </button>
            <button className="settings-action-button" type="button" disabled={busyAction !== null || !report} onClick={() => void handleCopy()}>
              <Clipboard size={15} />
              {t('mediaLibrary.health.action.copy')}
            </button>
            <button className="settings-action-button" type="button" disabled={busyAction !== null} onClick={() => void handleExport()}>
              <Download size={15} />
              {t('mediaLibrary.health.action.export')}
            </button>
          </div>

          {message ? <p className="settings-inline-note">{message}</p> : null}
        </>
      ) : null}
    </div>
  );
};
