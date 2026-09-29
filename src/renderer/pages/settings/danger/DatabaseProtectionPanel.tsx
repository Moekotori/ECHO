import {
  FileText,
  FolderOpen,
  Power,
  RotateCw,
  Save,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import type { LibraryDatabaseProtectionStatus } from '../../../../shared/types/library';
import type { TranslationKey } from '../../../i18n/locales';
import {
  formatProtectionTimestamp,
  formatUpdateBytes,
} from '../diagnostics/settingsDiagnosticsFormat';

type Translate = (
  key: TranslationKey,
  options?: Record<string, string | number>,
) => string;

type DatabaseProtectionBusyAction =
  | 'refresh'
  | 'snapshot'
  | 'restore'
  | 'scrub'
  | 'discard'
  | 'relaunch'
  | 'open'
  | null;

type DatabaseProtectionPanelProps = {
  archiveLabel: string;
  badgeLabel: string;
  busy: boolean;
  busyAction: DatabaseProtectionBusyAction;
  confirmWord: string;
  dataProtectionDisabled: boolean;
  description: string;
  diagnosticsBusy: boolean;
  error: string | null;
  message: string | null;
  onConfirmWordChange: (value: string) => void;
  onCreateSnapshot: () => void;
  onDiscardQuarantinedTracks: () => void;
  onExportDiagnostics: () => void;
  onOpenFolder: () => void;
  onPrimaryRecovery: () => void;
  onRefresh: () => void;
  onRelaunchRecovery: () => void;
  pathLabel: string;
  primaryActionBusyLabel: string;
  primaryActionDisabled: boolean;
  primaryActionLabel: string;
  primaryActionUnavailableReason: string | null;
  quarantined: boolean;
  recoverySteps: string[];
  snapshotLabel: string;
  status: LibraryDatabaseProtectionStatus | null;
  t: Translate;
  unrecoverable: boolean;
};

export const DatabaseProtectionPanel = ({
  archiveLabel,
  badgeLabel,
  busy,
  busyAction,
  confirmWord,
  dataProtectionDisabled,
  description,
  diagnosticsBusy,
  error,
  message,
  onConfirmWordChange,
  onCreateSnapshot,
  onDiscardQuarantinedTracks,
  onExportDiagnostics,
  onOpenFolder,
  onPrimaryRecovery,
  onRefresh,
  onRelaunchRecovery,
  pathLabel,
  primaryActionBusyLabel,
  primaryActionDisabled,
  primaryActionLabel,
  primaryActionUnavailableReason,
  quarantined,
  recoverySteps,
  snapshotLabel,
  status,
  t,
  unrecoverable,
}: DatabaseProtectionPanelProps): JSX.Element => {
  const healthStatus = status?.health.status;
  const latestHealthySnapshot = status?.latestHealthySnapshot ?? null;

  return (
    <div className="settings-database-protection" data-health={healthStatus ?? 'unknown'}>
      <header>
        <div>
          <span className="section-kicker">{t('settings.danger.database.kicker')}</span>
          <h3>{t('settings.danger.database.title')}</h3>
          <p>{description}</p>
        </div>
        <span className={`settings-database-health settings-database-health--${healthStatus ?? 'unknown'}`}>
          {badgeLabel}
        </span>
      </header>
      <div className="settings-database-grid">
        <span>
          <em>{t('settings.danger.database.meta.current')}</em>
          <strong>{formatUpdateBytes(status?.databaseSizeBytes)}</strong>
          <small title={pathLabel}>{pathLabel}</small>
        </span>
        <span>
          <em>{t('settings.danger.database.meta.snapshot')}</em>
          <strong>{snapshotLabel}</strong>
          <small>{latestHealthySnapshot?.id ?? t('settings.danger.database.meta.snapshotHint')}</small>
        </span>
        <span>
          <em>{t('settings.danger.database.meta.archive')}</em>
          <strong>{archiveLabel}</strong>
          <small>{status?.latestArchive?.id ?? t('settings.danger.database.meta.archiveHint')}</small>
        </span>
      </div>
      {quarantined || (healthStatus && healthStatus !== 'ok') ? (
        <ol className="settings-database-steps">
          {recoverySteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {unrecoverable && status?.unrecoverableReason ? (
        <p className="settings-inline-error">{status.unrecoverableReason}</p>
      ) : null}
      <div className="settings-database-actions">
        <button
          className="settings-action-button"
          type="button"
          disabled={busyAction === 'refresh'}
          onClick={onRefresh}
        >
          <RotateCw size={15} />
          {busyAction === 'refresh'
            ? t('settings.danger.database.action.checking')
            : t('settings.danger.database.action.check')}
        </button>
        <button
          className="settings-action-button"
          type="button"
          disabled={busy || dataProtectionDisabled}
          onClick={onCreateSnapshot}
        >
          <Save size={15} />
          {busyAction === 'snapshot'
            ? t('settings.danger.database.action.creating')
            : t('settings.danger.database.action.create')}
        </button>
        <button
          className="settings-danger-button"
          type="button"
          disabled={primaryActionDisabled}
          onClick={onPrimaryRecovery}
        >
          <ShieldAlert size={15} />
          {busyAction === 'restore' || busyAction === 'scrub'
            ? primaryActionBusyLabel
            : primaryActionLabel}
        </button>
        {quarantined ? (
          <button
            className="settings-danger-button"
            type="button"
            disabled={busy || status?.hasRunningScan || !status?.canScrubQuarantinedDatabase}
            onClick={onDiscardQuarantinedTracks}
          >
            <Trash2 size={15} />
            {busyAction === 'discard'
              ? t('settings.danger.database.action.discarding')
              : t('settings.danger.database.action.discard')}
          </button>
        ) : null}
        <button
          className="settings-danger-button"
          type="button"
          disabled={busy}
          onClick={onRelaunchRecovery}
        >
          <Power size={15} />
          {busyAction === 'relaunch'
            ? t('settings.danger.database.action.relaunching')
            : t('settings.danger.database.action.relaunch')}
        </button>
        <button
          className="settings-action-button"
          type="button"
          disabled={busyAction === 'open'}
          onClick={onOpenFolder}
        >
          <FolderOpen size={15} />
          {t('settings.danger.database.action.open')}
        </button>
        <button
          className="settings-action-button"
          type="button"
          disabled={diagnosticsBusy}
          onClick={onExportDiagnostics}
        >
          <FileText size={15} />
          {diagnosticsBusy
            ? t('settings.danger.database.action.exporting')
            : t('settings.danger.database.action.export')}
        </button>
      </div>
      <label className="settings-danger-confirm-field" htmlFor="settings-danger-confirm-word">
        <span>{t('settings.danger.database.confirmWord')}</span>
        <input
          id="settings-danger-confirm-word"
          type="text"
          value={confirmWord}
          placeholder={t('settings.danger.database.confirmPlaceholder')}
          autoComplete="off"
          onChange={(event) => onConfirmWordChange(event.target.value)}
        />
      </label>
      {primaryActionUnavailableReason ? (
        <p className="settings-inline-note">{primaryActionUnavailableReason}</p>
      ) : null}
      {error ? <p className="settings-inline-error" role="alert">{error}</p> : null}
      {message ? <p className="settings-inline-note" role="status">{message}</p> : null}
      {status?.hasRunningScan ? (
        <p className="settings-inline-error">{t('settings.danger.database.scanRunning')}</p>
      ) : null}
      {status?.maintenanceEvents.length ? (
        <div className="settings-database-events">
          {status.maintenanceEvents.slice(0, 3).map((event) => (
            <span key={`${event.createdAt}-${event.action}`}>
              <em>{formatProtectionTimestamp(event.createdAt)}</em>
              <strong>{event.action}</strong>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
};
