import { Zap } from 'lucide-react';
import type { TranslationKey } from '../../../i18n/locales';
import { SettingRow } from '../components/SettingsPrimitives';

type Translate = (
  key: TranslationKey,
  options?: Record<string, string | number>,
) => string;

type DangerMaintenanceSettingsProps = {
  busy: boolean;
  hardwareAccelerationDisabled: boolean;
  message: string | null;
  onClearLibraryCache: () => void;
  onDeleteAllUserData: () => void;
  onDeleteLibraryDatabase: () => void;
  onHardwareAccelerationToggle: () => void;
  onRepairLibraryDatabase: () => void;
  onResetDefaultSettings: () => void;
  t: Translate;
};

export const DangerMaintenanceSettings = ({
  busy,
  hardwareAccelerationDisabled,
  message,
  onClearLibraryCache,
  onDeleteAllUserData,
  onDeleteLibraryDatabase,
  onHardwareAccelerationToggle,
  onRepairLibraryDatabase,
  onResetDefaultSettings,
  t,
}: DangerMaintenanceSettingsProps): JSX.Element => {
  const processingLabel = t('settings.danger.action.processing');

  return (
    <>
      <SettingRow
        title={t('settings.danger.clearCache.title')}
        description={t('settings.danger.clearCache.description')}
      >
        <button
          className="settings-danger-button"
          type="button"
          disabled={busy}
          onClick={onClearLibraryCache}
        >
          {busy ? processingLabel : t('settings.danger.clearCache.action')}
        </button>
      </SettingRow>
      <SettingRow
        title={t('settings.danger.hardwareAcceleration.title')}
        description={t('settings.danger.hardwareAcceleration.description')}
      >
        <button
          className="settings-danger-button"
          type="button"
          disabled={busy}
          onClick={onHardwareAccelerationToggle}
        >
          <Zap size={15} />
          {busy
            ? processingLabel
            : hardwareAccelerationDisabled
              ? t('settings.danger.hardwareAcceleration.action.enable')
              : t('settings.danger.hardwareAcceleration.action.disable')}
        </button>
      </SettingRow>
      <SettingRow
        title={t('settings.danger.reset.title')}
        description={t('settings.danger.reset.description')}
      >
        <button
          className="settings-danger-button"
          type="button"
          disabled={busy}
          onClick={onResetDefaultSettings}
        >
          {busy ? processingLabel : t('settings.danger.reset.action')}
        </button>
      </SettingRow>
      <SettingRow
        title={t('settings.danger.repair.title')}
        description={t('settings.danger.repair.description')}
      >
        <button
          className="settings-danger-button"
          type="button"
          disabled={busy}
          onClick={onRepairLibraryDatabase}
        >
          {busy ? processingLabel : t('settings.danger.repair.action')}
        </button>
      </SettingRow>
      <SettingRow
        title={t('settings.danger.deleteDatabase.title')}
        description={t('settings.danger.deleteDatabase.description')}
      >
        <button
          className="settings-danger-button"
          type="button"
          disabled={busy}
          onClick={onDeleteLibraryDatabase}
        >
          {busy ? processingLabel : t('settings.danger.deleteDatabase.action')}
        </button>
      </SettingRow>
      <SettingRow
        title={t('settings.danger.deleteAll.title')}
        description={t('settings.danger.deleteAll.description')}
      >
        <button
          className="settings-danger-button"
          type="button"
          disabled={busy}
          onClick={onDeleteAllUserData}
        >
          {busy ? processingLabel : t('settings.danger.deleteAll.action')}
        </button>
      </SettingRow>
      {message ? <p className="settings-inline-note">{message}</p> : null}
    </>
  );
};
