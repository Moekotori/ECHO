import {
  ExternalLink,
  Github,
  Globe2,
  History,
  RotateCw,
  Save,
} from 'lucide-react';
import type { AutoUpdateSource } from '../../../../shared/types/appSettings';
import type { UpdateStatus } from '../../../../shared/types/updates';
import { StyledSelect } from '../../../components/ui/StyledSelect';
import type { TranslationKey } from '../../../i18n/locales';
import { ReleaseNotesMarkdown } from '../components/ReleaseNotesMarkdown';
import { SettingRow, ToggleButton } from '../components/SettingsPrimitives';
import { getUpdateStateLabel } from '../diagnostics/settingsDiagnosticsFormat';
import {
  afdianSponsorUrl,
  autoUpdateSourceOptions,
  baiduPanShareUrl,
  bilibiliSpaceUrl,
  officialWebsiteUrl,
  userDocumentationUrl,
} from '../general/generalSettingsModel';

type Translate = (
  key: TranslationKey,
  options?: Record<string, string | number>,
) => string;

type AboutUpdateSettingsProps = {
  appVersion: string | null;
  autoUpdateAvailable: boolean;
  autoUpdateEnabled: boolean;
  busy: boolean;
  currentSource: AutoUpdateSource;
  customUrlDraft: string;
  deferredReleaseNotes: string | null;
  downloadPercent: number;
  downloadSizeLabel: string;
  downloadSpeedLabel: string;
  onAutoUpdateEnabledChange: (enabled: boolean) => void;
  onCheck: () => void;
  onCustomUrlChange: (url: string) => void;
  onCustomUrlSave: () => void;
  onOpenRepository: () => void;
  onOpenUrl: (url: string) => void;
  onSourceChange: (source: AutoUpdateSource) => void;
  showDownloadProgress: boolean;
  status: UpdateStatus | null;
  t: Translate;
};

const updateLinks = [
  { icon: Globe2, labelKey: 'settings.about.links.officialWebsite', url: officialWebsiteUrl },
  { icon: ExternalLink, labelKey: 'settings.about.links.documentation', url: userDocumentationUrl },
  { icon: ExternalLink, labelKey: 'settings.about.links.baiduPan', url: baiduPanShareUrl },
  { icon: ExternalLink, labelKey: 'settings.about.links.bilibili', url: bilibiliSpaceUrl },
  { icon: ExternalLink, labelKey: 'settings.about.updates.action.afdian', url: afdianSponsorUrl },
  { icon: History, labelKey: 'settings.about.updates.action.history', url: 'https://github.com/moekotori/echo/releases' },
  { icon: ExternalLink, labelKey: 'settings.about.updates.action.qq', url: 'https://qm.qq.com/q/KrJE8PIqSQ' },
  { icon: ExternalLink, labelKey: 'settings.about.updates.action.discord', url: 'https://discord.gg/g7v4WMRq3K' },
] satisfies Array<{
  icon: typeof ExternalLink;
  labelKey: TranslationKey;
  url: string;
}>;

export const AboutUpdateSettings = ({
  appVersion,
  autoUpdateAvailable,
  autoUpdateEnabled,
  busy,
  currentSource,
  customUrlDraft,
  deferredReleaseNotes,
  downloadPercent,
  downloadSizeLabel,
  downloadSpeedLabel,
  onAutoUpdateEnabledChange,
  onCheck,
  onCustomUrlChange,
  onCustomUrlSave,
  onOpenRepository,
  onOpenUrl,
  onSourceChange,
  showDownloadProgress,
  status,
  t,
}: AboutUpdateSettingsProps): JSX.Element => (
  <SettingRow
    className="setting-row--full setting-row--compact-panel"
    title={t('settings.about.updates.title')}
    description={t('settings.about.updates.description')}
  >
    <div className="settings-cache-panel settings-cache-panel--updates">
      <div className="settings-status-grid settings-status-grid--updates">
        <span>
          <em>{t('settings.about.updates.currentVersion')}</em>
          <strong>{appVersion ?? status?.currentVersion ?? t('common.checking')}</strong>
        </span>
        <span>
          <em>{t('settings.about.updates.latestVersion')}</em>
          <strong>{status?.latestVersion ?? 'n/a'}</strong>
        </span>
        <span>
          <em>{t('settings.about.updates.status')}</em>
          <strong>
            {t(getUpdateStateLabel(status?.state ?? (autoUpdateEnabled ? 'idle' : 'disabled')))}
          </strong>
        </span>
        <span>
          <em>{t('settings.about.updates.lastChecked')}</em>
          <strong>{status?.checkedAt ? new Date(status.checkedAt).toLocaleString() : 'n/a'}</strong>
        </span>
      </div>
      {showDownloadProgress ? (
        <div className="settings-update-progress" role="status" aria-live="polite">
          <div className="settings-update-progress-label">
            <span>
              {status?.state === 'downloaded'
                ? t('settings.about.updates.progress.ready')
                : t('settings.about.updates.progress.downloading')}
            </span>
            <strong>{downloadPercent}%</strong>
          </div>
          <div
            aria-label={t('settings.about.updates.progress.aria', { percent: downloadPercent })}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={downloadPercent}
            className="settings-update-progress-track"
            role="progressbar"
          >
            <span style={{ width: `${downloadPercent}%` }} />
          </div>
          <div className="settings-update-progress-meta">
            <span>{downloadSizeLabel}</span>
            <span>{downloadSpeedLabel}</span>
          </div>
        </div>
      ) : null}
      <div className="settings-chip-row settings-chip-row--left settings-chip-row--actions">
        <div className="settings-inline-toggle">
          <span>{t('settings.about.updates.autoCheck')}</span>
          <ToggleButton
            active={autoUpdateEnabled}
            disabled={!autoUpdateAvailable}
            onClick={() => onAutoUpdateEnabledChange(!autoUpdateEnabled)}
          />
        </div>
        <div className="settings-update-source-picker">
          <span>{t('settings.about.updates.downloadSource')}</span>
          <StyledSelect
            ariaLabel={t('settings.about.updates.downloadSourceAria')}
            className="settings-update-source-select"
            disabled={!autoUpdateAvailable}
            options={autoUpdateSourceOptions.map((option) => ({
              value: option.source,
              label: `${option.label} · ${option.description}`,
            }))}
            showFilterIcon={false}
            value={currentSource}
            onChange={onSourceChange}
          />
        </div>
        {currentSource === 'custom' ? (
          <div className="settings-update-custom-source">
            <span>{t('settings.about.updates.customGenericSource')}</span>
            <input
              disabled={!autoUpdateAvailable}
              placeholder="https://example.com/echo/releases/latest/download"
              type="url"
              value={customUrlDraft}
              onChange={(event) => onCustomUrlChange(event.target.value)}
            />
            <button
              className="settings-action-button"
              type="button"
              disabled={!autoUpdateAvailable}
              onClick={onCustomUrlSave}
            >
              <Save size={15} />
              {t('settings.about.updates.action.save')}
            </button>
          </div>
        ) : null}
        <button
          className="settings-action-button"
          type="button"
          disabled={busy || !autoUpdateEnabled}
          onClick={onCheck}
        >
          <RotateCw className={busy ? 'spinning-icon' : undefined} size={15} />
          {busy
            ? t('settings.about.updates.action.checking')
            : t('settings.about.updates.action.check')}
        </button>
        <button className="settings-action-button" type="button" onClick={onOpenRepository}>
          <Github size={15} />
          ECHO NEXT
        </button>
        {updateLinks.map(({ icon: Icon, labelKey, url }) => (
          <button
            className="settings-action-button"
            key={labelKey}
            type="button"
            onClick={() => onOpenUrl(url)}
          >
            <Icon size={15} />
            {t(labelKey)}
          </button>
        ))}
      </div>
      {status?.releaseNotes ? (
        <div className="settings-update-notes">
          <em>{t('settings.about.updates.releaseNotes')}</em>
          {deferredReleaseNotes === status.releaseNotes ? (
            <ReleaseNotesMarkdown markdown={status.releaseNotes} />
          ) : (
            <p className="settings-inline-note">{t('settings.about.updates.releaseNotesPending')}</p>
          )}
        </div>
      ) : (
        <p className="settings-inline-note">{t('settings.about.updates.releaseNotesEmpty')}</p>
      )}
      {status?.error ? <p className="settings-inline-error">{status.error}</p> : null}
    </div>
  </SettingRow>
);
