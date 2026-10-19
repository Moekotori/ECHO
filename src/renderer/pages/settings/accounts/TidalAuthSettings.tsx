import { ExternalLink, Save } from 'lucide-react';
import { useI18n } from '../../../i18n/I18nProvider';
import { SettingRow } from '../components/SettingsPrimitives';

type TidalDraft = { clientId: string; clientSecret: string; redirectUri: string; countryCode: string };
type Props = {
  draft: TidalDraft;
  message: string | null;
  disabled: boolean;
  defaultRedirectUri: string;
  onChange: (patch: Partial<TidalDraft>) => void;
  onSave: () => void;
  onOpenDashboard: () => void;
};
const fields: Array<{ key: keyof TidalDraft; label: string; secret?: boolean }> = [
  { key: 'clientId', label: 'Client ID' },
  { key: 'clientSecret', label: 'Client Secret', secret: true },
  { key: 'redirectUri', label: 'Redirect URI' },
  { key: 'countryCode', label: 'Country Code' },
];
export const TidalAuthSettings = ({ draft, message, disabled, defaultRedirectUri, onChange, onSave, onOpenDashboard }: Props): JSX.Element => {
  const { t } = useI18n();
  return <SettingRow className="setting-row--full setting-row--credential" id="settings-row-tidal-auth-config"
    title={t('settings.integrations.tidalAuth.title')} description={t('settings.integrations.tidalAuth.description')}>
    <div className="settings-cache-panel settings-cache-panel--bare settings-cache-panel--tidal-auth">
      <div className="settings-proxy-grid">
        {fields.map(({ key, label, secret }) => <label key={key} className="settings-proxy-field"><span>{label}</span>
          <input type={secret ? 'password' : 'text'} value={draft[key]} disabled={disabled} autoComplete="off"
            placeholder={key === 'redirectUri' ? defaultRedirectUri : key === 'countryCode' ? 'US' : label}
            onChange={(event) => onChange({ [key]: key === 'countryCode' ? event.target.value.toUpperCase() : event.target.value })} />
        </label>)}
      </div>
      <div className="settings-chip-row settings-chip-row--left">
        <button className="settings-action-button" type="button" disabled={disabled} onClick={onSave}><Save size={15} />{t('settings.integrations.tidalAuth.save')}</button>
        <button className="settings-action-button" type="button" onClick={onOpenDashboard}><ExternalLink size={15} />{t('settings.integrations.common.openDashboard', { service: 'TIDAL' })}</button>
      </div>
      <p className="settings-inline-note">{t('settings.integrations.common.dashboardCallback', { uri: defaultRedirectUri })}</p>
      {message ? <p className="settings-inline-note">{message}</p> : null}
    </div>
  </SettingRow>;
};
