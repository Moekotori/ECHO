import React from 'react';
import ReactDOM from 'react-dom/client';
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

const appearancePreferences = readAppearancePreferences();
const themeMode = readThemeMode();
const appBridge = getAppBridge();
applyThemeMode(themeMode);
applyAppearancePreferences(appearancePreferences);

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
  variant?: 'primary' | 'secondary' | 'danger';
};

const crashGuardActionButtonStyleByVariant = (
  variant: NonNullable<CrashGuardActionButtonProps['variant']>,
  disabled: boolean,
): React.CSSProperties => {
  const baseStyle: React.CSSProperties = {
    minHeight: 46,
    minWidth: 144,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    border: '1px solid rgba(20, 28, 42, 0.14)',
    borderRadius: 8,
    padding: '0 16px',
    color: '#18212f',
    background: '#fffaf0',
    font: 'inherit',
    fontSize: 14,
    fontWeight: 800,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.52 : 1,
    boxShadow: '0 8px 18px rgba(20, 28, 42, 0.08)',
  };

  if (variant === 'primary') {
    return {
      ...baseStyle,
      borderColor: '#0f766e',
      color: '#ffffff',
      background: '#0f766e',
      boxShadow: '0 16px 30px rgba(15, 118, 110, 0.22)',
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
    onClick={onClick}
    disabled={disabled}
    style={crashGuardActionButtonStyleByVariant(variant, disabled)}
    title={title}
  >
    <Icon size={17} strokeWidth={2.2} aria-hidden="true" />
    <span>{label}</span>
  </button>
);

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
    const windowLabel = this.props.label === 'main-window'
      ? '主窗口'
      : this.props.label === 'mini-player'
        ? '迷你播放器'
        : '桌面歌词';

    return (
      <main style={crashGuardShellStyle}>
        <section style={crashGuardPanelStyle} aria-labelledby="echo-crash-guard-title">
          <div style={crashGuardHeaderStyle}>
            <div style={crashGuardBrandStyle}>
              <span style={crashGuardSealStyle}>
                <ShieldCheck size={19} strokeWidth={2.4} aria-hidden="true" />
              </span>
              <div>
                <p style={crashGuardEyebrowStyle}>ECHO Next Recovery</p>
                <strong style={crashGuardBrandTitleStyle}>Renderer Guard</strong>
              </div>
            </div>
            <span style={crashGuardChipStyle}>{bridgeStatus}</span>
          </div>
          <div style={crashGuardBodyStyle}>
            <aside style={crashGuardRailStyle}>
              <div style={crashGuardWarningPlateStyle}>
                <AlertTriangle size={38} strokeWidth={2.3} aria-hidden="true" />
              </div>
              <p style={crashGuardRailKickerStyle}>UI 保护已接管</p>
              <strong style={crashGuardRailTitleStyle}>不要反复重启，先留下现场。</strong>
              <dl style={crashGuardMetaListStyle}>
                <div style={crashGuardMetaItemStyle}>
                  <dt style={crashGuardMetaTermStyle}>窗口</dt>
                  <dd style={crashGuardMetaValueStyle}>{windowLabel}</dd>
                </div>
                <div style={crashGuardMetaItemStyle}>
                  <dt style={crashGuardMetaTermStyle}>状态</dt>
                  <dd style={crashGuardMetaValueStyle}>{bridgeStatus}</dd>
                </div>
                <div style={crashGuardMetaItemStyle}>
                  <dt style={crashGuardMetaTermStyle}>判断</dt>
                  <dd style={crashGuardMetaValueStyle}>渲染层报错</dd>
                </div>
              </dl>
            </aside>
            <div style={crashGuardContentStyle}>
              <p style={crashGuardSectionLabelStyle}>Crash containment</p>
              <h1 id="echo-crash-guard-title" style={crashGuardTitleStyle}>
                界面被保护页拦住了，ECHO 还活着。
              </h1>
              <p style={crashGuardLeadStyle}>
                这是当前窗口的 React 渲染错误，不等于播放核心已经崩掉。重启后如果马上又回到这里，说明同一段界面状态还会触发错误；诊断包和报告比继续重启更有用。
              </p>
              <div style={crashGuardCalloutStyle}>
                <strong style={crashGuardCalloutTitleStyle}>推荐顺序</strong>
                <span>先导出诊断包，再打开崩溃报告；重载界面只适合临时状态抖动。</span>
              </div>
              <div style={crashGuardActionsStyle}>
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
                  label="重启应用"
                  onClick={this.restartApp}
                  disabled={!diagnosticsAvailable}
                  title="重新启动 ECHO Next"
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
              <p style={crashGuardStatusStyle}>
                {this.state.actionMessage || (diagnosticsAvailable ? '诊断桥可用，可以安全导出现场信息。' : '诊断桥不可用，请手动重启 ECHO。')}
              </p>
            </div>
          </div>
          <details style={crashGuardDetailsStyle}>
            <summary style={crashGuardSummaryStyle}>错误摘要</summary>
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
  padding: 28,
  backgroundColor: '#111827',
  backgroundImage:
    'linear-gradient(135deg, rgba(17, 24, 39, 0.96) 0%, rgba(24, 33, 47, 0.98) 46%, rgba(236, 231, 221, 0.98) 46%, rgba(249, 246, 238, 0.98) 100%), linear-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px)',
  backgroundSize: 'auto, 42px 42px, 42px 42px',
  color: '#141c2a',
  fontFamily: '"Microsoft YaHei", "Segoe UI", sans-serif',
};

const crashGuardPanelStyle: React.CSSProperties = {
  width: 'min(1120px, 100%)',
  border: '1px solid rgba(255, 255, 255, 0.72)',
  borderRadius: 8,
  padding: 26,
  background: 'rgba(255, 251, 241, 0.96)',
  boxShadow: '0 30px 80px rgba(7, 11, 19, 0.32)',
  backdropFilter: 'blur(14px)',
};

const crashGuardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  paddingBottom: 22,
  borderBottom: '1px solid rgba(20, 28, 42, 0.12)',
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
  color: '#f7d477',
  background: '#172033',
  boxShadow: 'inset 0 -4px 0 #b76e2b',
};

const crashGuardEyebrowStyle: React.CSSProperties = {
  margin: 0,
  color: '#687385',
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
  background: '#e9f5ef',
  fontSize: 12,
  fontWeight: 800,
};

const crashGuardBodyStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 26,
  marginTop: 24,
};

const crashGuardRailStyle: React.CSSProperties = {
  minHeight: 320,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  borderRadius: 8,
  padding: 24,
  background: '#172033',
  color: '#fff7e8',
  boxShadow: 'inset 0 -7px 0 #d99a2b',
};

const crashGuardWarningPlateStyle: React.CSSProperties = {
  width: 74,
  height: 74,
  display: 'grid',
  placeItems: 'center',
  border: '1px solid rgba(247, 212, 119, 0.34)',
  borderRadius: 8,
  color: '#f7d477',
  background: 'rgba(247, 212, 119, 0.1)',
};

const crashGuardRailKickerStyle: React.CSSProperties = {
  margin: '24px 0 0',
  color: '#f7d477',
  fontSize: 13,
  fontWeight: 800,
};

const crashGuardRailTitleStyle: React.CSSProperties = {
  display: 'block',
  maxWidth: 300,
  marginTop: 8,
  color: '#fffaf0',
  fontSize: 27,
  lineHeight: 1.22,
  fontWeight: 900,
};

const crashGuardMetaListStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
  margin: '28px 0 0',
};

const crashGuardMetaItemStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '72px minmax(0, 1fr)',
  gap: 10,
  alignItems: 'center',
  minHeight: 34,
  borderTop: '1px solid rgba(255, 250, 240, 0.12)',
  paddingTop: 10,
};

const crashGuardMetaTermStyle: React.CSSProperties = {
  margin: 0,
  color: 'rgba(255, 250, 240, 0.58)',
  fontSize: 12,
  fontWeight: 800,
};

const crashGuardMetaValueStyle: React.CSSProperties = {
  margin: 0,
  color: '#fffaf0',
  fontSize: 13,
  fontWeight: 800,
};

const crashGuardContentStyle: React.CSSProperties = {
  minWidth: 0,
  alignSelf: 'center',
};

const crashGuardSectionLabelStyle: React.CSSProperties = {
  margin: 0,
  color: '#b76e2b',
  fontSize: 13,
  fontWeight: 900,
};

const crashGuardTitleStyle: React.CSSProperties = {
  maxWidth: 680,
  margin: '10px 0 0',
  color: '#141c2a',
  fontSize: 40,
  lineHeight: 1.18,
  fontWeight: 900,
};

const crashGuardLeadStyle: React.CSSProperties = {
  maxWidth: 720,
  margin: '18px 0 0',
  color: '#485467',
  fontSize: 15,
  lineHeight: 1.8,
};

const crashGuardCalloutStyle: React.CSSProperties = {
  maxWidth: 720,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginTop: 22,
  borderLeft: '4px solid #d99a2b',
  padding: '12px 14px',
  color: '#3c4658',
  background: '#f4ecd9',
  borderRadius: 8,
  fontSize: 14,
  lineHeight: 1.6,
};

const crashGuardCalloutTitleStyle: React.CSSProperties = {
  color: '#172033',
  fontWeight: 900,
};

const crashGuardActionsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 11,
  marginTop: 24,
};

const crashGuardStatusStyle: React.CSSProperties = {
  minHeight: 24,
  margin: '16px 0 0',
  color: '#8a4b0f',
  fontSize: 14,
  fontWeight: 800,
  wordBreak: 'break-word',
};

const crashGuardDetailsStyle: React.CSSProperties = {
  marginTop: 24,
  borderTop: '1px solid rgba(20, 28, 42, 0.12)',
  paddingTop: 18,
  color: '#3c4658',
};

const crashGuardSummaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  fontWeight: 900,
  outline: 'none',
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

const isDesktopLyricsWindow = new URLSearchParams(window.location.search).get('desktopLyrics') === '1';
const isMiniPlayerWindow = new URLSearchParams(window.location.search).get('miniPlayer') === '1';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
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
