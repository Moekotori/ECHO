import React from 'react';
import ReactDOM from 'react-dom/client';
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
    void window.echo?.diagnostics.exportDiagnosticsZip()
      .then((outputPath) => {
        this.setActionMessage(outputPath ? `已导出: ${outputPath}` : '已取消导出。');
      })
      .catch((error) => {
        this.setActionMessage(error instanceof Error ? error.message : String(error));
      });
  };

  private openCrashReport = (): void => {
    void window.echo?.diagnostics.openCrashReport()
      .then((outputPath) => {
        this.setActionMessage(outputPath ? `已打开: ${outputPath}` : '未找到崩溃报告。');
      })
      .catch((error) => {
        this.setActionMessage(error instanceof Error ? error.message : String(error));
      });
  };

  private restartApp = (): void => {
    void window.echo?.diagnostics.relaunchApp().catch((error) => {
      this.setActionMessage(error instanceof Error ? error.message : String(error));
    });
  };

  private quitApp = (): void => {
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

    return (
      <main style={crashGuardShellStyle}>
        <section style={crashGuardPanelStyle}>
          <div style={crashGuardTopStyle}>
            <p style={crashGuardEyebrowStyle}>ECHO Recovery</p>
            <span style={crashGuardChipStyle}>UI 保护页</span>
          </div>
          <div style={crashGuardBodyStyle}>
            <aside style={crashGuardRailStyle} aria-hidden="true">
              <span style={crashGuardRailCodeStyle}>UI</span>
              <span style={crashGuardRailTextStyle}>已接管</span>
            </aside>
            <div style={crashGuardContentStyle}>
              <h1 style={crashGuardTitleStyle}>界面崩了，但 ECHO 还在。</h1>
              <p style={crashGuardLeadStyle}>
                当前窗口进入恢复模式。可以先导出诊断和查看报告，也可以重载界面、重启应用，或者直接关闭 ECHO。
              </p>
              <div style={crashGuardActionsStyle}>
                <button type="button" onClick={this.exportDiagnostics} disabled={!diagnosticsAvailable} style={crashGuardPrimaryButtonStyle}>
                  导出日志
                </button>
                <button type="button" onClick={this.openCrashReport} disabled={!diagnosticsAvailable} style={crashGuardButtonStyle}>
                  打开报告
                </button>
                <button type="button" onClick={this.reloadRenderer} style={crashGuardButtonStyle}>
                  重载界面
                </button>
                <button type="button" onClick={this.restartApp} disabled={!diagnosticsAvailable} style={crashGuardButtonStyle}>
                  重启 ECHO
                </button>
                <button type="button" onClick={this.quitApp} disabled={!appControlsAvailable} style={crashGuardDangerButtonStyle}>
                  关闭 ECHO
                </button>
              </div>
            </div>
          </div>
          <p style={crashGuardStatusStyle}>
            {this.state.actionMessage || (diagnosticsAvailable ? '' : '诊断桥不可用，请手动重启 ECHO。')}
          </p>
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
  padding: 24,
  backgroundColor: '#eef2ef',
  backgroundImage:
    'linear-gradient(rgba(16, 24, 40, 0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(16, 24, 40, 0.045) 1px, transparent 1px)',
  backgroundSize: '36px 36px',
  color: '#18212f',
  fontFamily: '"Microsoft YaHei", "Segoe UI", sans-serif',
};

const crashGuardPanelStyle: React.CSSProperties = {
  width: 'min(940px, 100%)',
  border: '1px solid rgba(24, 33, 47, 0.12)',
  borderRadius: 8,
  padding: 28,
  background: '#fbfcf8',
  boxShadow: '0 24px 70px rgba(24, 33, 47, 0.18)',
};

const crashGuardTopStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  paddingBottom: 18,
  borderBottom: '1px solid rgba(24, 33, 47, 0.1)',
};

const crashGuardEyebrowStyle: React.CSSProperties = {
  margin: 0,
  color: '#176c66',
  fontSize: 13,
  fontWeight: 900,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

const crashGuardChipStyle: React.CSSProperties = {
  border: '1px solid rgba(23, 108, 102, 0.18)',
  borderRadius: 999,
  padding: '6px 10px',
  color: '#176c66',
  background: '#e7f2ed',
  fontSize: 12,
  fontWeight: 800,
};

const crashGuardBodyStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(72px, 112px) minmax(0, 1fr)',
  gap: 28,
  marginTop: 26,
};

const crashGuardRailStyle: React.CSSProperties = {
  minHeight: 178,
  display: 'grid',
  placeItems: 'center',
  alignContent: 'center',
  gap: 10,
  borderRadius: 8,
  background: '#1d2633',
  color: '#fff7e3',
  boxShadow: 'inset 0 -6px 0 #e2aa3b',
};

const crashGuardRailCodeStyle: React.CSSProperties = {
  fontSize: 34,
  fontWeight: 900,
  lineHeight: 1,
};

const crashGuardRailTextStyle: React.CSSProperties = {
  color: '#f0cf8b',
  fontSize: 13,
  fontWeight: 800,
};

const crashGuardContentStyle: React.CSSProperties = {
  minWidth: 0,
};

const crashGuardTitleStyle: React.CSSProperties = {
  margin: 0,
  color: '#111827',
  fontSize: 42,
  lineHeight: 1.16,
  fontWeight: 900,
};

const crashGuardLeadStyle: React.CSSProperties = {
  maxWidth: 660,
  margin: '16px 0 0',
  color: '#4b5563',
  fontSize: 15,
  lineHeight: 1.8,
};

const crashGuardActionsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  marginTop: 24,
};

const crashGuardButtonStyle: React.CSSProperties = {
  minHeight: 44,
  border: '1px solid rgba(24, 33, 47, 0.14)',
  borderRadius: 8,
  padding: '0 18px',
  color: '#1f2937',
  background: '#ffffff',
  font: 'inherit',
  fontWeight: 800,
  cursor: 'pointer',
  boxShadow: '0 1px 2px rgba(24, 33, 47, 0.08)',
};

const crashGuardPrimaryButtonStyle: React.CSSProperties = {
  ...crashGuardButtonStyle,
  borderColor: '#176c66',
  color: '#ffffff',
  background: '#176c66',
};

const crashGuardDangerButtonStyle: React.CSSProperties = {
  ...crashGuardButtonStyle,
  borderColor: '#b42318',
  color: '#ffffff',
  background: '#b42318',
};

const crashGuardStatusStyle: React.CSSProperties = {
  minHeight: 22,
  margin: '18px 0 0',
  color: '#9a3412',
  fontSize: 14,
  fontWeight: 700,
  wordBreak: 'break-word',
};

const crashGuardDetailsStyle: React.CSSProperties = {
  marginTop: 18,
  color: '#374151',
};

const crashGuardSummaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  fontWeight: 900,
};

const crashGuardPreStyle: React.CSSProperties = {
  maxHeight: 180,
  overflow: 'auto',
  margin: '14px 0 0',
  padding: 14,
  border: '1px solid rgba(24, 33, 47, 0.1)',
  borderRadius: 8,
  background: '#111827',
  color: '#e5e7eb',
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
