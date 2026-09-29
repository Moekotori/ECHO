import { useState } from 'react';
import { getAppBridge } from '../../../utils/echoBridge';
import { Zap } from 'lucide-react';
import type { AppSettings } from '../../../../shared/types/appSettings';
import type { Locale } from '../../../i18n/locales';
import { SettingRow, ToggleButton } from './SettingsPrimitives';
import { settingsLocaleCopy } from '../settingsSubsections';

type Props = {
  locale: Locale;
  appSettings: AppSettings | null;
  highlightedSettingId: string | null;
  patchAppSettings: (patch: Partial<AppSettings>) => unknown;
  setError: (message: string | null) => void;
};

export const UltraLightSettingsRows = ({ locale, appSettings, highlightedSettingId, patchAppSettings, setError }: Props): JSX.Element => {
  const [ultraLightModeBusy, setUltraLightModeBusy] = useState(false);
  const handleEnterUltraLightMode = async (): Promise<void> => {
    const confirmed = window.confirm(settingsLocaleCopy(locale, {
      'zh-CN': '进入后会完全卸载 ECHO 界面。音乐将继续播放，可按 Ctrl+Shift+E 或点击托盘图标恢复界面。是否继续？',
      'zh-TW': '進入後會完全卸載 ECHO 介面。音樂將繼續播放，可按 Ctrl+Shift+E 或點擊系統匣圖示恢復介面。是否繼續？',
      'ja-JP': 'ECHO のUIを完全にアンロードします。再生は継続され、Ctrl+Shift+E またはトレイアイコンで復元できます。続行しますか？',
      'en-US': 'This completely unloads the ECHO UI. Playback continues; press Ctrl+Shift+E or click the tray icon to restore it. Continue?',
      'ko-KR': 'ECHO UI를 완전히 언로드합니다. 재생은 계속되며 Ctrl+Shift+E 또는 트레이 아이콘으로 복원할 수 있습니다. 계속할까요?',
    }));
    if (!confirmed) {
      return;
    }

    const app = getAppBridge();
    if (!app?.enterUltraLightMode) {
      setError('Ultra-light mode is unavailable in this build.');
      return;
    }

    setUltraLightModeBusy(true);
    setError(null);
    try {
      const status = await app.enterUltraLightMode();
      if (!status.active) {
        throw new Error(status.error ?? 'Failed to enter ultra-light mode.');
      }
    } catch (modeError) {
      setError(modeError instanceof Error ? modeError.message : String(modeError));
      setUltraLightModeBusy(false);
    }
  };

  const chinese = locale === 'zh-CN' || locale === 'zh-TW';
  return <>
              <SettingRow
                id="settings-row-ultra-light-mode"
                highlighted={highlightedSettingId === 'settings-row-ultra-light-mode'}
                title={settingsLocaleCopy(locale, {
                  'zh-CN': 'ECHO Ultralight',
                  'zh-TW': '超輕背景模式',
                  'ja-JP': '超軽量バックグラウンドモード',
                  'en-US': 'Ultra-light background mode',
                  'ko-KR': '초경량 백그라운드 모드',
                })}
                description={settingsLocaleCopy(locale, {
                  'zh-CN': '专为游戏场景设计。完全卸载所有 ECHO 界面，仅保留 Audio Core、native host、播放队列、托盘和快捷键；不会降低音质。',
                  'zh-TW': '專為遊戲場景設計。完全卸載所有 ECHO 介面，只保留 Audio Core、native host、播放佇列、系統匣和快捷鍵；不會降低音質。',
                  'ja-JP': 'ゲーム向け。ECHOの全UIをアンロードし、Audio Core、native host、キュー、トレイ、ショートカットのみを維持します。音質は変わりません。',
                  'en-US': 'Designed for gaming. Unloads every ECHO UI window while keeping Audio Core, the native host, queue, tray, and shortcuts. Audio quality is unchanged.',
                  'ko-KR': '게임용 모드입니다. 모든 ECHO UI를 언로드하고 Audio Core, native host, 대기열, 트레이, 단축키만 유지합니다. 음질은 바뀌지 않습니다.',
                })}
              >
                <button
                  className="settings-action-button"
                  type="button"
                  disabled={ultraLightModeBusy}
                  onClick={() => void handleEnterUltraLightMode()}
                >
                  <Zap size={15} />
                  {ultraLightModeBusy
                    ? settingsLocaleCopy(locale, {
                        'zh-CN': '正在卸载界面…',
                        'zh-TW': '正在卸載介面…',
                        'ja-JP': 'UIをアンロード中…',
                        'en-US': 'Unloading UI…',
                        'ko-KR': 'UI 언로드 중…',
                      })
                    : settingsLocaleCopy(locale, {
                        'zh-CN': '进入超轻后台模式',
                        'zh-TW': '進入超輕背景模式',
                        'ja-JP': '超軽量モードに入る',
                        'en-US': 'Enter ultra-light mode',
                        'ko-KR': '초경량 모드 시작',
                      })}
                </button>
              </SettingRow>
    <SettingRow
      id="settings-row-ultra-light-auto"
      highlighted={highlightedSettingId === 'settings-row-ultra-light-auto'}
      title={chinese ? '最小化或隐藏时自动启用 ECHO Ultralight' : 'Enable ECHO Ultralight on minimize or hide'}
      description={chinese ? '最小化后释放主界面，点击任务栏图标或托盘可恢复。仅在原生输出和可安全续播的本地队列下启用；CUE、远程播放和 System Output 保持界面驻留。' : 'Release the main interface in the background; restore from the taskbar or tray. Requires native output and a supported local queue. CUE, remote playback and System Output remain resident.'}
    >
      <ToggleButton ariaLabel="ECHO Ultralight auto" active={appSettings?.ultraLightOnMinimizeOrTrayEnabled === true} disabled={!appSettings}
        onClick={() => patchAppSettings({ ultraLightOnMinimizeOrTrayEnabled: appSettings?.ultraLightOnMinimizeOrTrayEnabled !== true })} />
    </SettingRow>
    <SettingRow
      id="settings-row-ultra-light-disable-gpu"
      descriptionInline
      highlighted={highlightedSettingId === 'settings-row-ultra-light-disable-gpu'}
      title={chinese ? '超轻模式禁用 Electron GPU（危险）' : 'Disable Electron GPU in Ultralight (dangerous)'}
      description={chinese ? '默认关闭。进入和退出时会重启 ECHO，可能短暂停播、黑屏或恢复失败；出现异常请重启并关闭此项。' : 'Off by default. Entering and leaving restarts ECHO and may interrupt audio or fail to restore the interface. Restart and disable this option if problems occur.'}
    >
      <ToggleButton ariaLabel="ECHO Ultralight GPU" active={appSettings?.ultraLightGpuDisabled === true} disabled={!appSettings}
        onClick={() => patchAppSettings({ ultraLightGpuDisabled: appSettings?.ultraLightGpuDisabled !== true })} />
    </SettingRow>
  </>;
};
