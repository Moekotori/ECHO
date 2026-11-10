import type { AppSettings } from '../../../shared/types/appSettings';
import { createDefaultLocalShortcuts } from '../../../shared/types/globalShortcuts';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';
import { formatAcceleratorForDisplay } from '../../utils/shortcutAccelerator';
import './first-run-everyday.css';

const shortcuts = ['playPause', 'openPlaybackQueue', 'openSearch'] as const;

export function FirstRunEverydayStep({ settings, platform, hideToTray, onHideToTrayChange }: {
  settings: AppSettings | null;
  platform: NodeJS.Platform | 'unknown';
  hideToTray: boolean;
  onHideToTrayChange: (enabled: boolean) => void;
}): JSX.Element {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const bindings = { ...createDefaultLocalShortcuts(), ...settings?.localShortcuts };
  return <div className="first-run-everyday">
    <section>
      <h4>{t('settings.shortcuts.scope.local')}</h4>
      <p>{t('firstRun.daily.shortcuts')}</p>
      <dl className="first-run-shortcut-list">
        {shortcuts.map(action => {
          const binding = bindings[action];
          return <div key={action}>
            <dt>{t(`settings.shortcuts.action.${action}.title`)}</dt>
            <dd><kbd>{binding.enabled
              ? formatAcceleratorForDisplay(binding.accelerator, t('common.disabled')) : t('common.disabled')}</kbd></dd>
          </div>;
        })}
      </dl>
    </section>
    <section>
      <h4>{t('firstRun.daily.close')}</h4>
      {platform === 'darwin' ? <p>{t('firstRun.daily.mac')}</p> : <>
        <label className="first-run-scan-toggle">
          <input type="checkbox" checked={hideToTray} onChange={event => onHideToTrayChange(event.target.checked)} />
          <span className="first-run-scan-switch" aria-hidden="true" />
          <span>{t('settings.general.closeToTray')}</span>
        </label>
        <p>{t(hideToTray ? 'firstRun.daily.tray' : 'firstRun.daily.quit')}</p>
      </>}
    </section>
  </div>;
}
