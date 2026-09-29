import { RefreshCw, SlidersHorizontal } from 'lucide-react';
import type { AudioStatus } from '../../../../shared/types/audio';
import type { TranslationKey } from '../../../i18n/locales';
import {
  SettingRow,
  SettingSection,
  SettingSubsectionTitle,
  type SettingSubsectionTitleProps,
} from '../components/SettingsPrimitives';
import type { SettingsNavKey } from '../settingsTypes';

type EqSettingsSectionProps = {
  activeKey: SettingsNavKey;
  getSubsection: (key: 'eqWorkbench') => SettingSubsectionTitleProps;
  onOpenDspPage: () => void;
  onRefreshStatus: () => void | Promise<void>;
  status: AudioStatus | null;
  t: (key: TranslationKey) => string;
};

export const EqSettingsSection = ({
  activeKey,
  getSubsection,
  onOpenDspPage,
  onRefreshStatus,
  status,
  t,
}: EqSettingsSectionProps): JSX.Element => (
  <SettingSection
    activeKey={activeKey}
    icon={SlidersHorizontal}
    id="eq"
    title={t('settings.nav.eq.label')}
  >
    <SettingSubsectionTitle {...getSubsection('eqWorkbench')} />
    <SettingRow
      title="音效处理工作台"
      description="EQ、余量、声道与输出保护已经搬到侧栏里的音效处理工作区。"
    >
      <div className="settings-cache-panel settings-cache-panel--bare settings-cache-panel--dsp-workbench">
        <div className="settings-status-grid settings-status-grid--audio">
          <span>
            <em>Signal path</em>
            <strong>{status?.dspActive ? 'DSP path' : 'Native direct'}</strong>
          </span>
          <span>
            <em>EQ</em>
            <strong>{status?.eqEnabled ? 'Enabled' : 'Bypassed'}</strong>
          </span>
          <span>
            <em>Preset</em>
            <strong>{status?.eqPresetName ?? 'Flat'}</strong>
          </span>
          <span>
            <em>Safety</em>
            <strong>{status?.clippingRisk ? 'Headroom risk' : 'Protected'}</strong>
          </span>
        </div>
        <div className="settings-chip-row settings-chip-row--left">
          <button className="settings-action-button" type="button" onClick={onOpenDspPage}>
            <SlidersHorizontal size={15} />
            打开音效处理
          </button>
          <button
            className="settings-action-button"
            type="button"
            onClick={() => void onRefreshStatus()}
          >
            <RefreshCw size={15} />
            刷新状态
          </button>
        </div>
        <p className="settings-inline-note">
          这里保留状态摘要；具体调音请从左侧音效处理进入，布局更接近 Roon 的链路式工作流。
        </p>
      </div>
    </SettingRow>
  </SettingSection>
);
