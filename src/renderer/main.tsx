import React from 'react';
import ReactDOM from 'react-dom/client';
import { dismissStartupOverlayAfterStablePaint } from './startupOverlay';
import type { Root } from 'react-dom/client';
import { AlertTriangle, Download, FileText, Power, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { I18nProvider, translateCurrentLocale } from './i18n/I18nProvider';
import type { TranslationKey } from './i18n/locales';
import { shouldStartHeavyRendererDiagnostics } from './diagnostics/rendererDiagnosticsMode';
import {
  applyAppearancePreferences,
  loadPersistedAppearancePreferences,
  readAppearancePreferences,
  registerAppearanceFontFile,
} from './preferences/appearancePreferences';
import {
  applyAccessibilityPreferences,
  defaultAccessibilityPreferences,
} from './preferences/accessibilityPreferences';
import { applyThemeMode, loadPersistedThemeMode, readThemeMode, watchSystemThemeMode, watchThemeSettings } from './preferences/themePreferences';
import type { AppearancePreferences, AppSettings } from '../shared/types/appSettings';
import { getAppBridge } from './utils/echoBridge';

declare global {
  interface Window {
    __echoReactRoot?: Root;
  }
}

const appearancePreferences = readAppearancePreferences();
const themeMode = readThemeMode();
const appBridge = getAppBridge();
const heavyRendererDiagnosticsEnabled = shouldStartHeavyRendererDiagnostics();
applyThemeMode(themeMode);
applyAppearancePreferences(appearancePreferences);
applyAccessibilityPreferences(defaultAccessibilityPreferences);
if (heavyRendererDiagnosticsEnabled) {
  void import('./diagnostics/memoryInteractionDiagnostics')
    .then(({ startMemoryInteractionDiagnostics }) => startMemoryInteractionDiagnostics())
    .catch(() => undefined);
}

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

const crashT = (key: TranslationKey, options?: Record<string, string | number>): string =>
  translateCurrentLocale(key, options);

const buildCrashGuardSteps = (): CrashGuardStepItem[] => [
  {
    title: crashT('crashGuard.step.export.title'),
    description: crashT('crashGuard.step.export.description'),
  },
  {
    title: crashT('crashGuard.step.report.title'),
    description: crashT('crashGuard.step.report.description'),
  },
  {
    title: crashT('crashGuard.step.reload.title'),
    description: crashT('crashGuard.step.reload.description'),
  },
];

const crashGuardActionButtonStyleByVariant = (
  variant: NonNullable<CrashGuardActionButtonProps['variant']>,
  disabled: boolean,
): React.CSSProperties => {
  const baseStyle: React.CSSProperties = {
    minHeight: 44,
    minWidth: 142,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    border: '1px solid #343b47',
    borderRadius: 7,
    padding: '0 15px',
    color: '#f3f5f7',
    background: '#11151a',
    font: 'inherit',
    fontSize: 14,
    fontWeight: 800,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    boxShadow: 'none',
    transition: 'transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease, background 160ms ease, color 160ms ease',
  };

  if (variant === 'primary') {
    return {
      ...baseStyle,
      borderColor: '#7186b8',
      color: '#ffffff',
      background: '#7186b8',
      boxShadow: '0 10px 28px rgba(113, 134, 184, 0.2)',
    };
  }

  if (variant === 'danger') {
    return {
      ...baseStyle,
      borderColor: 'rgba(225, 88, 88, 0.76)',
      color: '#ef6b6b',
      background: 'rgba(225, 88, 88, 0.04)',
      boxShadow: 'none',
    };
  }

  if (variant === 'quiet') {
    return {
      ...baseStyle,
      color: '#a3aab5',
      background: '#0f1217',
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
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes echoCrashGuardFadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes echoCrashGuardBreathe {
  0%, 100% { color: #7186b8; border-color: #343b47; }
  50% { color: #8fa5d6; border-color: #4b5872; }
}

@keyframes echoCrashGuardRing {
  0% { opacity: 0.32; transform: scale(0.88); }
  70%, 100% { opacity: 0; transform: scale(1.34); }
}

@keyframes echoCrashGuardScan {
  from { transform: scaleX(0.18); opacity: 0.55; }
  to { transform: scaleX(1); opacity: 1; }
}

.echo-crash-guard-panel {
  animation: echoCrashGuardPanelIn 460ms cubic-bezier(0.16, 1, 0.3, 1) both;
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
  width: 100%;
  border-radius: inherit;
  background: #7186b8;
  transform-origin: left center;
  animation: echoCrashGuardScan 900ms 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.echo-crash-guard-action:not(:disabled):hover {
  transform: translateY(-1px);
  border-color: #7186b8;
  background: #171c24;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.2);
}

.echo-crash-guard-action:focus-visible,
.echo-crash-guard-step:focus-within {
  outline: 2px solid #8fa5d6;
  outline-offset: 3px;
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

@media (max-width: 860px) {
  .echo-crash-guard-body {
    grid-template-columns: 1fr !important;
  }

  .echo-crash-guard-rail {
    min-height: auto !important;
    border-right: 0 !important;
    border-bottom: 1px solid #292f38;
    padding: 0 0 32px !important;
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
    this.setActionMessage(crashT('crashGuard.action.exporting'));
    void window.echo?.diagnostics.exportDiagnosticsZip()
      .then((outputPath) => {
        this.setActionMessage(
          outputPath
            ? crashT('crashGuard.action.exported', { path: outputPath })
            : crashT('crashGuard.action.exportCancelled'),
        );
      })
      .catch((error) => {
        this.setActionMessage(error instanceof Error ? error.message : String(error));
      });
  };

  private openCrashReport = (): void => {
    this.setActionMessage(crashT('crashGuard.action.openingReport'));
    void window.echo?.diagnostics.openCrashReport()
      .then((outputPath) => {
        this.setActionMessage(
          outputPath
            ? crashT('crashGuard.action.openedReport', { path: outputPath })
            : crashT('crashGuard.action.reportMissing'),
        );
      })
      .catch((error) => {
        this.setActionMessage(error instanceof Error ? error.message : String(error));
      });
  };

  private restartApp = (): void => {
    this.setActionMessage(crashT('crashGuard.action.restartRequested'));
    void window.echo?.diagnostics.relaunchApp().catch((error) => {
      this.setActionMessage(error instanceof Error ? error.message : String(error));
    });
  };

  private quitApp = (): void => {
    this.setActionMessage(crashT('crashGuard.action.quitting'));
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
    const bridgeStatus = diagnosticsAvailable
      ? crashT('crashGuard.bridge.online')
      : crashT('crashGuard.bridge.offline');
    const bridgeHint = diagnosticsAvailable
      ? crashT('crashGuard.bridge.hintOnline')
      : crashT('crashGuard.bridge.hintOffline');
    const statusMessage = this.state.actionMessage
      || (diagnosticsAvailable
        ? crashT('crashGuard.status.defaultOnline')
        : crashT('crashGuard.status.defaultOffline'));
    const windowLabel = this.props.label === 'main-window'
      ? crashT('crashGuard.window.main')
      : this.props.label === 'mini-player'
        ? crashT('crashGuard.window.miniPlayer')
        : this.props.label === 'pet'
          ? crashT('crashGuard.window.pet')
          : crashT('crashGuard.window.desktopLyrics');
    const crashGuardSteps = buildCrashGuardSteps();

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
                <strong style={crashGuardBrandTitleStyle}>{crashT('crashGuard.brandTitle')}</strong>
              </div>
            </div>
            <span style={crashGuardChipStyle}>{bridgeStatus}</span>
          </div>
          <div className="echo-crash-guard-body" style={crashGuardBodyStyle}>
            <aside className="echo-crash-guard-hero echo-crash-guard-rail" style={crashGuardRailStyle}>
              <div style={crashGuardBeaconWrapStyle}>
                <div className="echo-crash-guard-beacon" style={crashGuardWarningPlateStyle}>
                  <span className="echo-crash-guard-beacon-ring" style={crashGuardBeaconRingStyle} />
                  <span className="echo-crash-guard-beacon-ring" style={crashGuardBeaconRingStyle} />
                  <AlertTriangle size={38} strokeWidth={2.25} aria-hidden="true" />
                </div>
                <div>
                  <p style={crashGuardRailKickerStyle}>{crashT('crashGuard.rail.kicker')}</p>
                  <strong style={crashGuardRailTitleStyle}>{crashT('crashGuard.rail.title')}</strong>
                </div>
              </div>
              <div className="echo-crash-guard-scan" style={crashGuardScanStyle} aria-hidden="true" />
              <dl style={crashGuardMetaListStyle}>
                <div style={crashGuardMetaItemStyle}>
                  <dt style={crashGuardMetaTermStyle}>{crashT('crashGuard.meta.window')}</dt>
                  <dd style={crashGuardMetaValueStyle}>{windowLabel}</dd>
                </div>
                <div style={crashGuardMetaItemStyle}>
                  <dt style={crashGuardMetaTermStyle}>{crashT('crashGuard.meta.diagnostics')}</dt>
                  <dd style={crashGuardMetaValueStyle}>{bridgeHint}</dd>
                </div>
                <div style={crashGuardMetaItemStyle}>
                  <dt style={crashGuardMetaTermStyle}>{crashT('crashGuard.meta.type')}</dt>
                  <dd style={crashGuardMetaValueStyle}>{crashT('crashGuard.meta.renderError')}</dd>
                </div>
              </dl>
            </aside>
            <div className="echo-crash-guard-hero" style={crashGuardContentStyle}>
              <p style={crashGuardSectionLabelStyle}>{crashT('crashGuard.sectionLabel')}</p>
              <h1 id="echo-crash-guard-title" style={crashGuardTitleStyle}>
                {crashT('crashGuard.title')}
              </h1>
              <p style={crashGuardLeadStyle}>
                {crashT('crashGuard.lead')}
              </p>
              <ol style={crashGuardStepListStyle}>
                {crashGuardSteps.map((step, index) => (
                  <CrashGuardStep key={step.title} index={index} {...step} />
                ))}
              </ol>
              <div className="echo-crash-guard-actions" style={crashGuardActionsStyle}>
                <CrashGuardActionButton
                  icon={Download}
                  label={crashT('crashGuard.action.export')}
                  onClick={this.exportDiagnostics}
                  disabled={!diagnosticsAvailable}
                  title={crashT('crashGuard.action.exportTitle')}
                  variant="primary"
                />
                <CrashGuardActionButton
                  icon={FileText}
                  label={crashT('crashGuard.action.openReport')}
                  onClick={this.openCrashReport}
                  disabled={!diagnosticsAvailable}
                  title={crashT('crashGuard.action.openReportTitle')}
                />
                <CrashGuardActionButton
                  icon={RefreshCw}
                  label={crashT('crashGuard.action.reload')}
                  onClick={this.reloadRenderer}
                  title={crashT('crashGuard.action.reloadTitle')}
                />
                <CrashGuardActionButton
                  icon={RotateCcw}
                  label={crashT('crashGuard.action.restart')}
                  onClick={this.restartApp}
                  disabled={!diagnosticsAvailable}
                  title={crashT('crashGuard.action.restartTitle')}
                  variant="quiet"
                />
                <CrashGuardActionButton
                  icon={Power}
                  label={crashT('crashGuard.action.quit')}
                  onClick={this.quitApp}
                  disabled={!appControlsAvailable}
                  title={crashT('crashGuard.action.quitTitle')}
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
            <summary style={crashGuardSummaryStyle}>{crashT('crashGuard.summary')}</summary>
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
  placeItems: 'stretch',
  overflow: 'auto',
  padding: 0,
  background: '#0b0d10',
  color: '#f3f5f7',
  fontFamily: '"Segoe UI Variable", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
};

const crashGuardPanelStyle: React.CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  width: '100%',
  minHeight: '100vh',
  padding: 'clamp(24px, 3vw, 42px)',
  background: '#0b0d10',
};

const crashGuardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
  paddingBottom: 24,
  borderBottom: '1px solid #252a32',
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
  color: '#8fa5d6',
  background: '#12161c',
  border: '1px solid #303743',
};

const crashGuardEyebrowStyle: React.CSSProperties = {
  margin: 0,
  color: '#8d96a4',
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: 0,
  textTransform: 'uppercase',
};

const crashGuardBrandTitleStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 2,
  color: '#f3f5f7',
  fontSize: 17,
  fontWeight: 900,
};

const crashGuardChipStyle: React.CSSProperties = {
  border: '1px solid #343b47',
  borderRadius: 8,
  padding: '8px 11px',
  color: '#8fa5d6',
  background: '#11151a',
  fontSize: 12,
  fontWeight: 800,
};

const crashGuardBodyStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(280px, 0.82fr) minmax(420px, 1.38fr)',
  gap: 'clamp(34px, 5vw, 72px)',
  alignItems: 'center',
  maxWidth: 1320,
  width: '100%',
  margin: 'clamp(38px, 6vh, 74px) auto 0',
};

const crashGuardRailStyle: React.CSSProperties = {
  minHeight: 470,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 24,
  borderRight: '1px solid #292f38',
  padding: '0 clamp(30px, 4vw, 64px) 0 0',
  color: '#f3f5f7',
};

const crashGuardBeaconWrapStyle: React.CSSProperties = {
  display: 'grid',
  gap: 28,
};

const crashGuardWarningPlateStyle: React.CSSProperties = {
  position: 'relative',
  width: 92,
  height: 92,
  display: 'grid',
  placeItems: 'center',
  border: '1px solid #343b47',
  borderRadius: '50%',
  color: '#7186b8',
  background: '#0f1217',
};

const crashGuardBeaconRingStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  border: '1px solid rgba(113, 134, 184, 0.5)',
  borderRadius: '50%',
  pointerEvents: 'none',
};

const crashGuardScanStyle: React.CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  height: 4,
  borderRadius: 999,
  background: '#202631',
};

const crashGuardRailKickerStyle: React.CSSProperties = {
  margin: 0,
  color: '#8fa5d6',
  fontSize: 13,
  fontWeight: 900,
};

const crashGuardRailTitleStyle: React.CSSProperties = {
  display: 'block',
  maxWidth: 360,
  marginTop: 8,
  color: '#f3f5f7',
  fontSize: 'clamp(27px, 2.2vw, 34px)',
  lineHeight: 1.18,
  fontWeight: 900,
};

const crashGuardMetaListStyle: React.CSSProperties = {
  display: 'grid',
  gap: 0,
  margin: 0,
};

const crashGuardMetaItemStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '64px minmax(0, 1fr)',
  gap: 10,
  alignItems: 'center',
  minHeight: 40,
  borderTop: '1px solid #252a32',
  paddingTop: 11,
};

const crashGuardMetaTermStyle: React.CSSProperties = {
  margin: 0,
  color: '#7f8897',
  fontSize: 12,
  fontWeight: 800,
};

const crashGuardMetaValueStyle: React.CSSProperties = {
  margin: 0,
  color: '#e9ecf1',
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
  color: '#8fa5d6',
  fontSize: 13,
  fontWeight: 900,
};

const crashGuardTitleStyle: React.CSSProperties = {
  maxWidth: 680,
  margin: '10px 0 0',
  color: '#f5f6f8',
  fontSize: 'clamp(34px, 3.2vw, 48px)',
  lineHeight: 1.16,
  fontWeight: 900,
};

const crashGuardLeadStyle: React.CSSProperties = {
  maxWidth: 720,
  margin: '16px 0 0',
  color: '#9ba3af',
  fontSize: 15,
  lineHeight: 1.78,
};

const crashGuardStepListStyle: React.CSSProperties = {
  maxWidth: 720,
  display: 'grid',
  gap: 0,
  listStyle: 'none',
  margin: '24px 0 0',
  padding: 0,
};

const crashGuardStepStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '34px minmax(0, 1fr)',
  gap: 12,
  alignItems: 'start',
  borderTop: '1px solid #292f38',
  padding: '16px 0',
  background: 'transparent',
};

const crashGuardStepIndexStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  display: 'inline-grid',
  placeItems: 'center',
  borderRadius: 999,
  color: '#8fa5d6',
  background: '#10141a',
  border: '1px solid #7186b8',
  fontSize: 13,
  fontWeight: 900,
};

const crashGuardStepTextStyle: React.CSSProperties = {
  display: 'grid',
  gap: 3,
};

const crashGuardStepTitleStyle: React.CSSProperties = {
  color: '#f3f5f7',
  fontSize: 14,
  fontWeight: 900,
};

const crashGuardStepDescriptionStyle: React.CSSProperties = {
  color: '#949ca8',
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
  color: '#939ca9',
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
  background: '#7186b8',
  boxShadow: '0 0 0 4px rgba(113, 134, 184, 0.14)',
};

const crashGuardDetailsStyle: React.CSSProperties = {
  marginTop: 24,
  border: '1px solid #292f38',
  borderRadius: 7,
  padding: '16px 18px',
  color: '#a3aab5',
};

const crashGuardSummaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  fontWeight: 900,
  outline: 'none',
  color: '#a3aab5',
};

const crashGuardPreStyle: React.CSSProperties = {
  maxHeight: 180,
  overflow: 'auto',
  margin: '14px 0 0',
  padding: 14,
  border: '1px solid #303743',
  borderRadius: 8,
  background: '#080a0d',
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

if (heavyRendererDiagnosticsEnabled) {
  void import('./diagnostics/performanceStallMonitor')
    .then(({ startPerformanceStallMonitor }) => startPerformanceStallMonitor())
    .catch(() => undefined);
}
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
void appBridge?.getSettings()
  .then((settings) => {
    applyAccessibilityPreferences(settings.accessibilityPreferences);
    loadLyricsFontFiles(settings);
  })
  .catch(() => undefined);

window.addEventListener('settings:changed', (event) => {
  const patch = event instanceof CustomEvent ? (event.detail as Partial<AppSettings> | null) : null;
  if (!patch || typeof patch !== 'object') {
    return;
  }

  if ('lyricsFontFilePath' in patch || 'desktopLyricsFontFilePath' in patch) {
    void appBridge?.getSettings().then(loadLyricsFontFiles).catch(() => undefined);
  }
  if ('accessibilityPreferences' in patch) {
    applyAccessibilityPreferences(patch.accessibilityPreferences);
  }
});

const isDesktopLyricsWindow = new URLSearchParams(window.location.search).get('desktopLyrics') === '1';
const isMiniPlayerWindow = new URLSearchParams(window.location.search).get('miniPlayer') === '1';
const isPetWindow = new URLSearchParams(window.location.search).get('pet') === '1';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element');
}

const reactRoot = window.__echoReactRoot ?? ReactDOM.createRoot(rootElement);
window.__echoReactRoot = reactRoot;

const renderWindow = async (): Promise<void> => {
  if (isPetWindow) {
    const [{ PetApp }] = await Promise.all([
      import('./pet/PetApp'),
      import('./styles/petStyles'),
    ]);
    reactRoot.render(
      <React.StrictMode>
        <CrashGuard label="pet">
          <I18nProvider>
            <PetApp />
          </I18nProvider>
        </CrashGuard>
      </React.StrictMode>,
    );
    return;
  }

  if (isMiniPlayerWindow) {
    const [{ MiniPlayerApp }] = await Promise.all([
      import('./mini-player/MiniPlayerApp'),
      import('./styles/miniPlayerStyles'),
    ]);
    reactRoot.render(
      <React.StrictMode>
        <CrashGuard label="mini-player">
          <I18nProvider>
            <MiniPlayerApp />
          </I18nProvider>
        </CrashGuard>
      </React.StrictMode>,
    );
    return;
  }

  if (isDesktopLyricsWindow) {
    const [{ DesktopLyricsApp }] = await Promise.all([
      import('./desktop-lyrics/DesktopLyricsApp'),
      import('./styles/desktopLyricsStyles'),
    ]);
    reactRoot.render(
      <React.StrictMode>
        <CrashGuard label="desktop-lyrics">
          <I18nProvider>
            <DesktopLyricsApp />
          </I18nProvider>
        </CrashGuard>
      </React.StrictMode>,
    );
    return;
  }

  const [{ App, prepareAppStartup }] = await Promise.all([
    import('./app/App'),
    import('./styles/mainWindowStyles'),
  ]);
  const appStartupPreparation = prepareAppStartup();
  reactRoot.render(
    <React.StrictMode>
      <CrashGuard label="main-window">
        <App />
      </CrashGuard>
    </React.StrictMode>,
  );
  await appStartupPreparation;
  await dismissStartupOverlayAfterStablePaint();
};

void renderWindow().catch((error) => {
  reportRendererError({
    message: `Renderer entry failed to load: ${error instanceof Error ? error.message : String(error)}`,
    stack: error instanceof Error ? error.stack : undefined,
    source: 'error',
    timestamp: new Date().toISOString(),
  });
  throw error;
});
