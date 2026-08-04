import React from 'react';
import ReactDOM from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { AlertTriangle, Download, FileText, Power, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import '@fontsource/outfit/800.css';
import '@fontsource/outfit/900.css';
import { App } from './app/App';
import { DesktopLyricsApp } from './desktop-lyrics/DesktopLyricsApp';
import { I18nProvider } from './i18n/I18nProvider';
import { MiniPlayerApp } from './mini-player/MiniPlayerApp';
import { startPerformanceStallMonitor } from './diagnostics/performanceStallMonitor';
import { startMemoryInteractionDiagnostics } from './diagnostics/memoryInteractionDiagnostics';
import {
  applyAppearancePreferences,
  loadPersistedAppearancePreferences,
  readAppearancePreferences,
  registerAppearanceFontFile,
} from './preferences/appearancePreferences';
import { applyThemeMode, loadPersistedThemeMode, readThemeMode, watchSystemThemeMode, watchThemeSettings } from './preferences/themePreferences';
import type { AppearancePreferences, AppSettings } from '../shared/types/appSettings';
import { PlaybackQueueProvider } from './stores/PlaybackQueueProvider';
import { getAppBridge } from './utils/echoBridge';
import './styles/tokens.css';
import './styles/theme.css';
import './styles/layout.css';
import './styles/motion.css';
import './styles/app.css';
import './styles/songs.css';
import './styles/folders.css';
import './styles/audio-cd.css';
import './styles/home.css';
import './styles/dsp.css';
import './styles/eq.css';
import './styles/album-detail.css';
import './styles/artist-detail.css';
import './styles/queue.css';
import './styles/lyrics.css';
import './styles/legacy-theme-bridge.css';
import './styles/ui-polish.css';
import './styles/theme-presets.css';
import './styles/desktop-lyrics.css';
import './styles/mini-player.css';
import './styles/scrollbars.css';

declare global {
  interface Window {
    __echoReactRoot?: Root;
  }
}

const appearancePreferences = readAppearancePreferences();
const themeMode = readThemeMode();
const appBridge = getAppBridge();
applyThemeMode(themeMode);
applyAppearancePreferences(appearancePreferences);
startMemoryInteractionDiagnostics();

const loadAppearanceFontFiles = (preferences: AppearancePreferences): void => {
  if (preferences.mainFontFilePath && appBridge) {
    void appBridge.loadFontFile(preferences.mainFontFilePath).then((fontFile) => registerAppearanceFontFile('main', fontFile)).catch(() => undefined);
  }

  if (preferences.chineseFontFilePath && appBridge) {
    void appBridge
      .loadFontFile(preferences.chineseFontFilePath)
      .then((fontFile) => registerAppearanceFontFile('chinese', fontFile))
      .catch(() => undefined);
  }

  if (preferences.fallbackFontFilePath && appBridge) {
    void appBridge
      .loadFontFile(preferences.fallbackFontFilePath)
      .then((fontFile) => registerAppearanceFontFile('fallback', fontFile))
      .catch(() => undefined);
  }
};

const loadLyricsFontFiles = (settings: Partial<AppSettings>): void => {
  if (settings.lyricsFontFilePath && appBridge) {
    void appBridge
      .loadFontFile(settings.lyricsFontFilePath)
      .then((fontFile) => registerAppearanceFontFile('lyrics', fontFile))
      .catch(() => undefined);
  }

  if (settings.desktopLyricsFontFilePath && appBridge) {
    void appBridge
      .loadFontFile(settings.desktopLyricsFontFilePath)
      .then((fontFile) => registerAppearanceFontFile('desktopLyrics', fontFile))
      .catch(() => undefined);
  }
};

const reportRendererError = (payload: Parameters<NonNullable<Window['echo']['diagnostics']>['reportRendererError']>[0]): void => {
  void window.echo?.diagnostics.reportRendererError(payload).catch(() => undefined);
};

type CrashGuardProps = {
  children: React.ReactNode;
  label: string;
};

type CrashGuardState = {
  error: Error | null;
  actionMessage: string;
};

type CrashGuardActionButtonProps = {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  title: string;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
};

type CrashGuardStepItem = {
  description: string;
  title: string;
};

const crashGuardSteps: CrashGuardStepItem[] = [
  {
    title: '先导出诊断包',
    description: '保留日志、窗口状态和错误栈，后续排查最有用。',
  },
  {
    title: '再打开崩溃报告',
    description: '把报告给开发者或 AI 看，通常比反复重启更快定位。',
  },
  {
    title: '最后再重载或重启',
    description: '如果只是一次临时状态抖动，重载界面可能就能恢复。',
  },
];

const crashGuardActionButtonStyleByVariant = (
  variant: NonNullable<CrashGuardActionButtonProps['variant']>,
  disabled: boolean,
): React.CSSProperties => {
  const baseStyle: React.CSSProperties = {
    minHeight: 44,
    minWidth: 136,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    border: '1px solid rgba(29, 78, 216, 0.16)',
    borderRadius: 8,
    padding: '0 15px',
    color: '#17324d',
    background: '#ffffff',
    font: 'inherit',
    fontSize: 14,
    fontWeight: 800,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    boxShadow: '0 10px 22px rgba(39, 65, 91, 0.08)',
    transition: 'transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease, background 160ms ease',
  };

  if (variant === 'primary') {
    return {
      ...baseStyle,
      borderColor: '#0f766e',
      color: '#ffffff',
      background: 'linear-gradient(135deg, #0f766e 0%, #12817a 100%)',
      boxShadow: '0 16px 34px rgba(15, 118, 110, 0.24)',
    };
  }

  if (variant === 'danger') {
    return {
      ...baseStyle,
      borderColor: '#b42318',
      color: '#ffffff',
      background: '#b42318',
      boxShadow: '0 16px 28px rgba(180, 35, 24, 0.2)',
    };
  }

  if (variant === 'quiet') {
    return {
      ...baseStyle,
      color: '#53606f',
      background: '#f8fafc',
      boxShadow: 'none',
    };
  }

  return baseStyle;
};

const CrashGuardActionButton = ({
  disabled = false,
  icon: Icon,
  label,
  onClick,
  title,
  variant = 'secondary',
}: CrashGuardActionButtonProps): JSX.Element => (
  <button
    type="button"
    className="echo-crash-guard-action"
    onClick={onClick}
    disabled={disabled}
    style={crashGuardActionButtonStyleByVariant(variant, disabled)}
    title={title}
  >
    <Icon size={17} strokeWidth={2.2} aria-hidden="true" />
    <span>{label}</span>
  </button>
);

const CrashGuardStep = ({ description, index, title }: CrashGuardStepItem & { index: number }): JSX.Element => (
  <li className="echo-crash-guard-step" style={crashGuardStepStyle}>
    <span className="echo-crash-guard-step-index" style={crashGuardStepIndexStyle}>
      {index + 1}
    </span>
    <span style={crashGuardStepTextStyle}>
      <strong style={crashGuardStepTitleStyle}>{title}</strong>
      <span style={crashGuardStepDescriptionStyle}>{description}</span>
    </span>
  </li>
);

const crashGuardMotionCss = `
@keyframes echoCrashGuardPanelIn {
  from { opacity: 0; transform: translateY(18px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes echoCrashGuardFadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes echoCrashGuardBreathe {
  0%, 100% { transform: scale(1); box-shadow: 0 18px 44px rgba(15, 118, 110, 0.18); }
  50% { transform: scale(1.035); box-shadow: 0 22px 54px rgba(15, 118, 110, 0.26); }
}

@keyframes echoCrashGuardRing {
  0% { opacity: 0.42; transform: scale(0.82); }
  70%, 100% { opacity: 0; transform: scale(1.55); }
}

@keyframes echoCrashGuardScan {
  from { transform: translateX(-38%); }
  to { transform: translateX(118%); }
}

.echo-crash-guard-panel {
  animation: echoCrashGuardPanelIn 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.echo-crash-guard-hero,
.echo-crash-guard-step,
.echo-crash-guard-actions {
  animation: echoCrashGuardFadeUp 560ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.echo-crash-guard-step:nth-child(1) { animation-delay: 90ms; }
.echo-crash-guard-step:nth-child(2) { animation-delay: 160ms; }
.echo-crash-guard-step:nth-child(3) { animation-delay: 230ms; }
.echo-crash-guard-actions { animation-delay: 260ms; }

.echo-crash-guard-beacon {
  animation: echoCrashGuardBreathe 2600ms ease-in-out infinite;
}

.echo-crash-guard-beacon-ring {
  animation: echoCrashGuardRing 2400ms ease-out infinite;
}

.echo-crash-guard-beacon-ring:nth-child(2) {
  animation-delay: 900ms;
}

.echo-crash-guard-scan::after {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 42%;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent, rgba(15, 118, 110, 0.24), transparent);
  animation: echoCrashGuardScan 2600ms ease-in-out infinite;
}

.echo-crash-guard-action:not(:disabled):hover {
  transform: translateY(-1px);
  box-shadow: 0 16px 30px rgba(39, 65, 91, 0.12);
}

.echo-crash-guard-action:not(:disabled):active {
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .echo-crash-guard-panel,
  .echo-crash-guard-hero,
  .echo-crash-guard-step,
  .echo-crash-guard-actions,
  .echo-crash-guard-beacon,
  .echo-crash-guard-beacon-ring,
  .echo-crash-guard-scan::after {
    animation: none !important;
  }

  .echo-crash-guard-action {
    transition: none !important;
  }
}
`;

class CrashGuard extends React.Component<CrashGuardProps, CrashGuardState> {
  state: CrashGuardState = {
    error: null,
    actionMessage: '',
  };

  static getDerivedStateFromError(error: Error): CrashGuardState {
    return {
      error,
      actionMessage: '',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportRendererError({
      message: `React render crashed in ${this.props.label}: ${error.message}`,
      stack: `${error.stack ?? ''}\n\nComponent stack:\n${info.componentStack}`.trim(),
      source: 'error',
      timestamp: new Date().toISOString(),
    });
  }

  private setActionMessage = (message: string): void => {
    this.setState({ actionMessage: message });
  };

  private exportDiagnostics = (): void => {
    this.setActionMessage('正在准备诊断包...');
    void window.echo?.diagnostics.exportDiagnosticsZip()
      .then((outputPath) => {
        this.setActionMessage(outputPath ? `诊断包已导出: ${outputPath}` : '已取消导出。');
      })
      .catch((error) => {
        this.setActionMessage(error instanceof Error ? error.message : String(error));
      });
  };

  private openCrashReport = (): void => {
    this.setActionMessage('正在打开崩溃报告...');
    void window.echo?.diagnostics.openCrashReport()
      .then((outputPath) => {
        this.setActionMessage(outputPath ? `已打开崩溃报告: ${outputPath}` : '未找到崩溃报告。');
      })
      .catch((error) => {
        this.setActionMessage(error instanceof Error ? error.message : String(error));
      });
  };

  private restartApp = (): void => {
    this.setActionMessage('已请求重启 ECHO。若再次回到这里，请优先导出诊断包。');
    void window.echo?.diagnostics.relaunchApp().catch((error) => {
      this.setActionMessage(error instanceof Error ? error.message : String(error));
    });
  };

  private quitApp = (): void => {
    this.setActionMessage('正在关闭 ECHO...');
    void window.echo?.app.quit().catch((error) => {
      this.setActionMessage(error instanceof Error ? error.message : String(error));
    });
  };

  private reloadRenderer = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    const diagnosticsAvailable = Boolean(window.echo?.diagnostics);
    const appControlsAvailable = Boolean(window.echo?.app);
    const bridgeStatus = diagnosticsAvailable ? '诊断桥在线' : '诊断桥不可用';
    const bridgeHint = diagnosticsAvailable ? '可以导出诊断包' : '请先截图或手动重启';
    const statusMessage = this.state.actionMessage
      || (diagnosticsAvailable ? '建议先导出诊断包，再打开报告；这些信息不会自动上传。' : '诊断桥不可用，请先截图保留这一页，再手动重启 ECHO。');
    const windowLabel = this.props.label === 'main-window'
      ? '主窗口'
      : this.props.label === 'mini-player'
        ? '迷你播放器'
        : '桌面歌词';

    return (
      <main style={crashGuardShellStyle}>
        <style>{crashGuardMotionCss}</style>
        <section className="echo-crash-guard-panel" style={crashGuardPanelStyle} aria-labelledby="echo-crash-guard-title">
          <div style={crashGuardHeaderStyle}>
            <div style={crashGuardBrandStyle}>
              <span style={crashGuardSealStyle}>
                <ShieldCheck size={19} strokeWidth={2.4} aria-hidden="true" />
              </span>
              <div>
                <p style={crashGuardEyebrowStyle}>ECHO Next</p>
                <strong style={crashGuardBrandTitleStyle}>界面保护模式</strong>
              </div>
            </div>
            <span style={crashGuardChipStyle}>{bridgeStatus}</span>
          </div>
          <div style={crashGuardBodyStyle}>
            <aside className="echo-crash-guard-hero" style={crashGuardRailStyle}>
              <div style={crashGuardBeaconWrapStyle}>
                <div className="echo-crash-guard-beacon" style={crashGuardWarningPlateStyle}>
                  <span className="echo-crash-guard-beacon-ring" style={crashGuardBeaconRingStyle} />
                  <span className="echo-crash-guard-beacon-ring" style={crashGuardBeaconRingStyle} />
                  <AlertTriangle size={38} strokeWidth={2.25} aria-hidden="true" />
                </div>
                <div>
                  <p style={crashGuardRailKickerStyle}>已拦截一次界面错误</p>
                  <strong style={crashGuardRailTitleStyle}>ECHO 还在，先把现场留下来。</strong>
                </div>
              </div>
              <div className="echo-crash-guard-scan" style={crashGuardScanStyle} aria-hidden="true" />
              <dl style={crashGuardMetaListStyle}>
                <div style={crashGuardMetaItemStyle}>
                  <dt style={crashGuardMetaTermStyle}>窗口</dt>
                  <dd style={crashGuardMetaValueStyle}>{windowLabel}</dd>
                </div>
                <div style={crashGuardMetaItemStyle}>
                  <dt style={crashGuardMetaTermStyle}>诊断</dt>
                  <dd style={crashGuardMetaValueStyle}>{bridgeHint}</dd>
                </div>
                <div style={crashGuardMetaItemStyle}>
                  <dt style={crashGuardMetaTermStyle}>类型</dt>
                  <dd style={crashGuardMetaValueStyle}>React 渲染错误</dd>
                </div>
              </dl>
            </aside>
            <div className="echo-crash-guard-hero" style={crashGuardContentStyle}>
              <p style={crashGuardSectionLabelStyle}>界面保护已启动</p>
              <h1 id="echo-crash-guard-title" style={crashGuardTitleStyle}>
                ECHO 的界面刚刚出错了。
              </h1>
              <p style={crashGuardLeadStyle}>
                这通常是当前窗口的界面渲染失败，不一定代表播放核心或音乐文件损坏。请先按下面顺序保留信息，再决定重载或重启。
              </p>
              <ol style={crashGuardStepListStyle}>
                {crashGuardSteps.map((step, index) => (
                  <CrashGuardStep key={step.title} index={index} {...step} />
                ))}
              </ol>
              <div className="echo-crash-guard-actions" style={crashGuardActionsStyle}>
                <CrashGuardActionButton
                  icon={Download}
                  label="导出诊断包"
                  onClick={this.exportDiagnostics}
                  disabled={!diagnosticsAvailable}
                  title="导出当前诊断信息和崩溃线索"
                  variant="primary"
                />
                <CrashGuardActionButton
                  icon={FileText}
                  label="打开报告"
                  onClick={this.openCrashReport}
                  disabled={!diagnosticsAvailable}
                  title="打开最近一次崩溃报告"
                />
                <CrashGuardActionButton
                  icon={RefreshCw}
                  label="重载界面"
                  onClick={this.reloadRenderer}
                  title="只刷新当前渲染窗口"
                />
                <CrashGuardActionButton
                  icon={RotateCcw}
                  label="重启 ECHO"
                  onClick={this.restartApp}
                  disabled={!diagnosticsAvailable}
                  title="重新启动 ECHO Next"
                  variant="quiet"
                />
                <CrashGuardActionButton
                  icon={Power}
                  label="关闭 ECHO"
                  onClick={this.quitApp}
                  disabled={!appControlsAvailable}
                  title="退出 ECHO Next"
                  variant="danger"
                />
              </div>
              <p style={crashGuardStatusStyle} aria-live="polite">
                <span style={crashGuardStatusDotStyle} aria-hidden="true" />
                {statusMessage}
              </p>
            </div>
          </div>
          <details style={crashGuardDetailsStyle}>
            <summary style={crashGuardSummaryStyle}>开发者错误摘要</summary>
            <pre style={crashGuardPreStyle}>{this.state.error.message}</pre>
            <pre style={crashGuardPreStyle}>{this.state.error.stack ?? 'No stack available.'}</pre>
          </details>
        </section>
      </main>
    );
  }
}

const crashGuardShellStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  overflow: 'auto',
  padding: 'clamp(18px, 4vw, 42px)',
  backgroundColor: '#f6f4ee',
  backgroundImage:
    'linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(244, 248, 251, 0.98) 48%, rgba(252, 247, 236, 0.98) 100%), linear-gradient(90deg, rgba(15, 118, 110, 0.055) 1px, transparent 1px), linear-gradient(rgba(27, 56, 86, 0.05) 1px, transparent 1px)',
  backgroundSize: 'auto, 38px 38px, 38px 38px',
  color: '#172033',
  fontFamily: '"Microsoft YaHei", "Segoe UI", sans-serif',
};

const crashGuardPanelStyle: React.CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  width: 'min(1080px, 100%)',
  border: '1px solid rgba(116, 132, 151, 0.22)',
  borderRadius: 8,
  padding: 'clamp(20px, 3.2vw, 34px)',
  background: 'rgba(255, 254, 250, 0.98)',
  boxShadow: '0 24px 70px rgba(39, 65, 91, 0.18)',
  backdropFilter: 'blur(12px)',
};

const crashGuardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
  paddingBottom: 20,
  borderBottom: '1px solid rgba(116, 132, 151, 0.18)',
};

const crashGuardBrandStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const crashGuardSealStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  display: 'inline-grid',
  placeItems: 'center',
  borderRadius: 8,
  color: '#0f766e',
  background: '#ecfdf5',
  border: '1px solid rgba(15, 118, 110, 0.18)',
  boxShadow: 'inset 0 -3px 0 rgba(15, 118, 110, 0.12)',
};

const crashGuardEyebrowStyle: React.CSSProperties = {
  margin: 0,
  color: '#6b7787',
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: 0,
  textTransform: 'uppercase',
};

const crashGuardBrandTitleStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 2,
  color: '#172033',
  fontSize: 17,
  fontWeight: 900,
};

const crashGuardChipStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 118, 110, 0.24)',
  borderRadius: 8,
  padding: '8px 11px',
  color: '#0f766e',
  background: '#ecfdf5',
  fontSize: 12,
  fontWeight: 800,
};

const crashGuardBodyStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
  gap: 30,
  alignItems: 'center',
  marginTop: 28,
};

const crashGuardRailStyle: React.CSSProperties = {
  minHeight: 360,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  gap: 24,
  border: '1px solid rgba(15, 118, 110, 0.14)',
  borderRadius: 8,
  padding: 24,
  background: 'linear-gradient(180deg, #f4fbf8 0%, #fff8e9 100%)',
  color: '#172033',
  boxShadow: 'inset 0 -6px 0 rgba(217, 154, 43, 0.28)',
};

const crashGuardBeaconWrapStyle: React.CSSProperties = {
  display: 'grid',
  gap: 22,
};

const crashGuardWarningPlateStyle: React.CSSProperties = {
  position: 'relative',
  width: 92,
  height: 92,
  display: 'grid',
  placeItems: 'center',
  border: '1px solid rgba(15, 118, 110, 0.22)',
  borderRadius: '50%',
  color: '#0f766e',
  background: '#ffffff',
  boxShadow: '0 18px 44px rgba(15, 118, 110, 0.18)',
};

const crashGuardBeaconRingStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  border: '1px solid rgba(15, 118, 110, 0.26)',
  borderRadius: '50%',
  pointerEvents: 'none',
};

const crashGuardScanStyle: React.CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  height: 8,
  borderRadius: 999,
  background: 'linear-gradient(90deg, rgba(15, 118, 110, 0.18), rgba(217, 154, 43, 0.24), rgba(29, 78, 216, 0.14))',
};

const crashGuardRailKickerStyle: React.CSSProperties = {
  margin: 0,
  color: '#0f766e',
  fontSize: 13,
  fontWeight: 900,
};

const crashGuardRailTitleStyle: React.CSSProperties = {
  display: 'block',
  maxWidth: 360,
  marginTop: 8,
  color: '#172033',
  fontSize: 30,
  lineHeight: 1.18,
  fontWeight: 900,
};

const crashGuardMetaListStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
  margin: 0,
};

const crashGuardMetaItemStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '64px minmax(0, 1fr)',
  gap: 10,
  alignItems: 'center',
  minHeight: 40,
  borderTop: '1px solid rgba(116, 132, 151, 0.16)',
  paddingTop: 11,
};

const crashGuardMetaTermStyle: React.CSSProperties = {
  margin: 0,
  color: '#6b7787',
  fontSize: 12,
  fontWeight: 800,
};

const crashGuardMetaValueStyle: React.CSSProperties = {
  margin: 0,
  color: '#172033',
  fontSize: 13,
  fontWeight: 800,
  wordBreak: 'break-word',
};

const crashGuardContentStyle: React.CSSProperties = {
  minWidth: 0,
  alignSelf: 'center',
};

const crashGuardSectionLabelStyle: React.CSSProperties = {
  margin: 0,
  color: '#0f766e',
  fontSize: 13,
  fontWeight: 900,
};

const crashGuardTitleStyle: React.CSSProperties = {
  maxWidth: 680,
  margin: '10px 0 0',
  color: '#172033',
  fontSize: 38,
  lineHeight: 1.16,
  fontWeight: 900,
};

const crashGuardLeadStyle: React.CSSProperties = {
  maxWidth: 720,
  margin: '16px 0 0',
  color: '#53606f',
  fontSize: 15,
  lineHeight: 1.78,
};

const crashGuardStepListStyle: React.CSSProperties = {
  maxWidth: 720,
  display: 'grid',
  gap: 10,
  listStyle: 'none',
  margin: '24px 0 0',
  padding: 0,
};

const crashGuardStepStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '34px minmax(0, 1fr)',
  gap: 12,
  alignItems: 'start',
  border: '1px solid rgba(116, 132, 151, 0.16)',
  borderRadius: 8,
  padding: '13px 14px',
  background: '#ffffff',
  boxShadow: '0 8px 20px rgba(39, 65, 91, 0.06)',
};

const crashGuardStepIndexStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  display: 'inline-grid',
  placeItems: 'center',
  borderRadius: 999,
  color: '#0f766e',
  background: '#ecfdf5',
  border: '1px solid rgba(15, 118, 110, 0.18)',
  fontSize: 13,
  fontWeight: 900,
};

const crashGuardStepTextStyle: React.CSSProperties = {
  display: 'grid',
  gap: 3,
};

const crashGuardStepTitleStyle: React.CSSProperties = {
  color: '#172033',
  fontSize: 14,
  fontWeight: 900,
};

const crashGuardStepDescriptionStyle: React.CSSProperties = {
  color: '#53606f',
  fontSize: 13,
  lineHeight: 1.58,
};

const crashGuardActionsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  marginTop: 22,
};

const crashGuardStatusStyle: React.CSSProperties = {
  minHeight: 26,
  display: 'flex',
  alignItems: 'flex-start',
  gap: 9,
  margin: '16px 0 0',
  color: '#7a4d12',
  fontSize: 14,
  fontWeight: 800,
  wordBreak: 'break-word',
};

const crashGuardStatusDotStyle: React.CSSProperties = {
  width: 9,
  height: 9,
  flex: '0 0 auto',
  marginTop: 6,
  borderRadius: 999,
  background: '#d99a2b',
  boxShadow: '0 0 0 4px rgba(217, 154, 43, 0.16)',
};

const crashGuardDetailsStyle: React.CSSProperties = {
  marginTop: 24,
  borderTop: '1px solid rgba(116, 132, 151, 0.18)',
  paddingTop: 18,
  color: '#3c4658',
};

const crashGuardSummaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  fontWeight: 900,
  outline: 'none',
  color: '#53606f',
};

const crashGuardPreStyle: React.CSSProperties = {
  maxHeight: 180,
  overflow: 'auto',
  margin: '14px 0 0',
  padding: 14,
  border: '1px solid rgba(20, 28, 42, 0.14)',
  borderRadius: 8,
  background: '#0f1724',
  color: '#e9eef7',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

window.addEventListener('error', (event) => {
  reportRendererError({
    message: event.message || 'Renderer error',
    stack: event.error instanceof Error ? event.error.stack : undefined,
    filename: event.filename || undefined,
    lineno: event.lineno,
    colno: event.colno,
    source: 'error',
    timestamp: new Date().toISOString(),
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  reportRendererError({
    message: reason instanceof Error ? reason.message : String(reason ?? 'Unhandled renderer rejection'),
    stack: reason instanceof Error ? reason.stack : undefined,
    source: 'unhandledrejection',
    timestamp: new Date().toISOString(),
  });
});

startPerformanceStallMonitor();
loadAppearanceFontFiles(appearancePreferences);
if (appBridge) {
  watchThemeSettings(() => appBridge.getSettings());
} else {
  watchSystemThemeMode(readThemeMode);
}
void loadPersistedThemeMode().catch(() => undefined);
void loadPersistedAppearancePreferences()
  .then((preferences) => {
    applyAppearancePreferences(preferences);
    loadAppearanceFontFiles(preferences);
  })
  .catch(() => undefined);
void appBridge?.getSettings().then(loadLyricsFontFiles).catch(() => undefined);

window.addEventListener('settings:changed', (event) => {
  const patch = event instanceof CustomEvent ? (event.detail as Partial<AppSettings> | null) : null;
  if (!patch || typeof patch !== 'object') {
    return;
  }

  if ('lyricsFontFilePath' in patch || 'desktopLyricsFontFilePath' in patch) {
    void appBridge?.getSettings().then(loadLyricsFontFiles).catch(() => undefined);
  }
});

const isDesktopLyricsWindow = new URLSearchParams(window.location.search).get('desktopLyrics') === '1';
const isMiniPlayerWindow = new URLSearchParams(window.location.search).get('miniPlayer') === '1';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element');
}

const reactRoot = window.__echoReactRoot ?? ReactDOM.createRoot(rootElement);
window.__echoReactRoot = reactRoot;

reactRoot.render(
  <React.StrictMode>
    <CrashGuard label={isMiniPlayerWindow ? 'mini-player' : isDesktopLyricsWindow ? 'desktop-lyrics' : 'main-window'}>
      {isMiniPlayerWindow ? (
        <I18nProvider>
          <PlaybackQueueProvider>
            <MiniPlayerApp />
          </PlaybackQueueProvider>
        </I18nProvider>
      ) : isDesktopLyricsWindow ? (
        <I18nProvider>
          <DesktopLyricsApp />
        </I18nProvider>
      ) : <App />}
    </CrashGuard>
  </React.StrictMode>,
);
