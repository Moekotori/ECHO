import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileAudio, RefreshCw, X } from 'lucide-react';
import type { LibraryTrack } from '../../../shared/types/library';
import type { PluginAudioAnalysisSeverity } from '../../../shared/types/plugins';

export const pluginTrackActionDrawerEvent = 'echo:plugin-track-action:open';

export type PluginTrackActionDrawerDetail = {
  pluginId: string;
  commandId: string;
  title: string;
  track: LibraryTrack;
};

type PluginTrackActionDrawerEvent = CustomEvent<PluginTrackActionDrawerDetail>;

type PluginTrackActionMetric = {
  label: string;
  value: string | number | boolean | null;
};

type PluginTrackActionEvidence = {
  severity?: PluginAudioAnalysisSeverity;
  message: string;
};

type PluginTrackActionResult = {
  title?: string;
  summary?: string;
  tone?: 'good' | 'warn' | 'risk' | 'neutral';
  confidence?: number;
  metrics?: PluginTrackActionMetric[];
  evidence?: PluginTrackActionEvidence[];
  notes?: string[];
};

type ActionState =
  | { status: 'idle'; result: null; raw: null; error: null }
  | { status: 'loading'; result: null; raw: null; error: null }
  | { status: 'ready'; result: PluginTrackActionResult | null; raw: unknown; error: null }
  | { status: 'error'; result: null; raw: null; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const normalizeSeverity = (value: unknown): PluginAudioAnalysisSeverity | undefined =>
  value === 'risk' || value === 'warning' || value === 'info' ? value : undefined;

const normalizeResult = (value: unknown): PluginTrackActionResult | null => {
  if (!isRecord(value)) {
    return null;
  }

  const metrics = Array.isArray(value.metrics)
    ? value.metrics
        .filter(isRecord)
        .map((item) => ({
          label: typeof item.label === 'string' ? item.label : '',
          value: ['string', 'number', 'boolean'].includes(typeof item.value) || item.value === null
            ? item.value as PluginTrackActionMetric['value']
            : String(item.value ?? ''),
        }))
        .filter((item) => Boolean(item.label))
    : undefined;

  const evidence = Array.isArray(value.evidence)
    ? value.evidence
        .filter(isRecord)
        .map((item) => ({
          severity: normalizeSeverity(item.severity),
          message: typeof item.message === 'string' ? item.message : '',
        }))
        .filter((item) => Boolean(item.message))
    : undefined;

  const notes = Array.isArray(value.notes)
    ? value.notes.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())
    : undefined;

  return {
    title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : undefined,
    summary: typeof value.summary === 'string' && value.summary.trim() ? value.summary.trim() : undefined,
    tone: value.tone === 'good' || value.tone === 'warn' || value.tone === 'risk' || value.tone === 'neutral' ? value.tone : undefined,
    confidence: typeof value.confidence === 'number' && Number.isFinite(value.confidence) ? Math.max(0, Math.min(1, value.confidence)) : undefined,
    metrics,
    evidence,
    notes,
  };
};

const evidenceIcon = (severity?: PluginAudioAnalysisSeverity): typeof AlertTriangle | typeof CheckCircle2 | typeof FileAudio => {
  if (severity === 'risk') {
    return AlertTriangle;
  }

  if (severity === 'warning') {
    return FileAudio;
  }

  return CheckCircle2;
};

const toErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('plugin_command_not_found')) {
    return '插件没有注册这个右键命令。请更新或重新导入插件包。';
  }
  if (message.includes('plugin_not_enabled')) {
    return '插件尚未启用。';
  }
  if (message.includes('plugin_permission_denied')) {
    return '插件缺少执行该命令需要的权限。';
  }
  return message;
};

const runPluginTrackAction = async (detail: PluginTrackActionDrawerDetail): Promise<unknown> => {
  const plugins = window.echo?.plugins;
  if (!plugins) {
    throw new Error('插件系统当前不可用。');
  }

  return plugins.runCommand({
    pluginId: detail.pluginId,
    commandId: detail.commandId,
    args: [{
      trackId: detail.track.id,
      title: detail.track.title,
      artist: detail.track.artist || detail.track.albumArtist || null,
    }],
  });
};

export const PluginTrackActionDrawerHost = (): JSX.Element | null => {
  const [detail, setDetail] = useState<PluginTrackActionDrawerDetail | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [action, setAction] = useState<ActionState>({ status: 'idle', result: null, raw: null, error: null });

  const close = useCallback((): void => {
    setIsOpen(false);
  }, []);

  const runAction = useCallback((nextDetail: PluginTrackActionDrawerDetail): void => {
    setAction({ status: 'loading', result: null, raw: null, error: null });
    void runPluginTrackAction(nextDetail)
      .then((raw) => {
        setAction({ status: 'ready', result: normalizeResult(raw), raw, error: null });
      })
      .catch((error) => {
        setAction({ status: 'error', result: null, raw: null, error: toErrorMessage(error) });
      });
  }, []);

  useEffect(() => {
    const handleOpen = (event: Event): void => {
      const nextDetail = (event as PluginTrackActionDrawerEvent).detail;
      if (!nextDetail?.pluginId || !nextDetail.commandId || !nextDetail.track?.id) {
        return;
      }

      setDetail(nextDetail);
      setIsOpen(true);
      runAction(nextDetail);
    };

    window.addEventListener(pluginTrackActionDrawerEvent, handleOpen);
    return () => window.removeEventListener(pluginTrackActionDrawerEvent, handleOpen);
  }, [runAction]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [close, isOpen]);

  const trackArtist = useMemo(() => detail?.track.artist || detail?.track.albumArtist || 'Unknown Artist', [detail]);
  const result = action.status === 'ready' ? action.result : null;

  if (!detail) {
    return null;
  }

  return (
    <aside className="plugin-track-action-drawer" aria-label="插件歌曲动作" data-open={isOpen ? 'true' : 'false'}>
      <button className="plugin-track-action-drawer__scrim" type="button" aria-label="关闭插件结果" onClick={close} />
      <section className="plugin-track-action-drawer__panel" aria-label="插件结果">
        <header className="plugin-track-action-drawer__header">
          <div>
            <span>{detail.title}</span>
            <h2>{result?.title ?? '插件结果'}</h2>
          </div>
          <button type="button" aria-label="关闭插件结果" title="关闭" onClick={close}>
            <X size={17} />
          </button>
        </header>

        <div className="plugin-track-action-track">
          <div className="plugin-track-action-track__icon">
            <FileAudio size={22} />
          </div>
          <div>
            <strong title={detail.track.title}>{detail.track.title}</strong>
            <span title={trackArtist}>{trackArtist}</span>
          </div>
        </div>

        {action.status === 'loading' ? (
          <div className="plugin-track-action-state" role="status">
            <RefreshCw size={18} />
            <span>正在运行插件...</span>
          </div>
        ) : null}

        {action.status === 'error' ? (
          <div className="plugin-track-action-error" role="alert">
            <AlertTriangle size={18} />
            <span>{action.error}</span>
            <button type="button" onClick={() => runAction(detail)}>
              重试
            </button>
          </div>
        ) : null}

        {result ? (
          <>
            <section className="plugin-track-action-verdict" data-tone={result.tone ?? 'neutral'}>
              <span>{result.summary ?? result.title ?? '完成'}</span>
              {typeof result.confidence === 'number' ? <strong>{Math.round(result.confidence * 100)}%</strong> : null}
            </section>

            {result.metrics && result.metrics.length > 0 ? (
              <div className="plugin-track-action-metrics" aria-label="插件指标">
                {result.metrics.map((metric) => (
                  <span key={metric.label}>
                    <small>{metric.label}</small>
                    <strong>{String(metric.value ?? '--')}</strong>
                  </span>
                ))}
              </div>
            ) : null}

            {result.evidence && result.evidence.length > 0 ? (
              <section className="plugin-track-action-section">
                <h3>证据</h3>
                <div className="plugin-track-action-evidence">
                  {result.evidence.map((item, index) => {
                    const Icon = evidenceIcon(item.severity);
                    return (
                      <article key={`${item.message}-${index}`} data-severity={item.severity ?? 'info'}>
                        <Icon size={16} />
                        <span>{item.message}</span>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {result.notes && result.notes.length > 0 ? (
              <section className="plugin-track-action-section">
                <h3>说明</h3>
                <ul>
                  {result.notes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : action.status === 'ready' ? (
          <pre className="plugin-track-action-json">{JSON.stringify(action.raw, null, 2)}</pre>
        ) : null}
      </section>
    </aside>
  );
};
