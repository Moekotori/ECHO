import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Power, RotateCcw, Save } from 'lucide-react';
import {
  defaultDspRackState,
  type ChannelMatrixState,
  type CrossfeedState,
  type StereoFieldState,
} from '../../../shared/types/dspRack';
import { getEqBridge } from '../../utils/echoBridge';
import { formatUserFacingError } from '../../utils/userFacingError';

type SliderProps = {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (value: number) => void;
};

const Slider = ({ label, value, display, min, max, step, disabled, onChange }: SliderProps): JSX.Element => (
  <label>
    <span><strong>{label}</strong><em>{display}</em></span>
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  </label>
);

type PanelShellProps<State extends { enabled: boolean }> = {
  eyebrow: string;
  title: string;
  description: string;
  state: State;
  defaults: State;
  busy: boolean;
  error: string | null;
  onDraft: (state: State) => void;
  onApply: (state: State) => void;
  children: ReactNode;
  extraActions?: ReactNode;
};

const PanelShell = <State extends { enabled: boolean }>({
  eyebrow,
  title,
  description,
  state,
  defaults,
  busy,
  error,
  onDraft,
  onApply,
  children,
  extraActions,
}: PanelShellProps<State>): JSX.Element => (
  <section className="dsp-module-panel dsp-module-panel--compressor dsp-module-panel--spatial" aria-label={title}>
    <header className="dsp-compressor-header">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <button
        type="button"
        className="dsp-compressor-power"
        data-active={state.enabled}
        disabled={busy}
        onClick={() => onApply({ ...state, enabled: !state.enabled })}
      >
        <Power size={16} aria-hidden="true" />
        {state.enabled ? '已启用' : '已旁路'}
      </button>
    </header>
    {error ? <p className="dsp-rack-error" role="alert">{error}</p> : null}
    <div className="dsp-compressor-controls">{children}</div>
    {extraActions ? <div className="dsp-spatial-presets">{extraActions}</div> : null}
    <footer className="dsp-compressor-actions">
      <button type="button" disabled={busy} onClick={() => onDraft(defaults)}>
        <RotateCcw size={15} aria-hidden="true" />恢复默认
      </button>
      <button type="button" disabled={busy} onClick={() => onApply(state)}>
        <Save size={15} aria-hidden="true" />应用参数
      </button>
    </footer>
  </section>
);

export const CrossfeedPanel = ({ state, onApplied }: {
  state: CrossfeedState;
  onApplied: (state: CrossfeedState) => void;
}): JSX.Element => {
  const [draft, setDraft] = useState(state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(state), [state]);
  const apply = async (next: CrossfeedState): Promise<void> => {
    const bridge = getEqBridge();
    if (!bridge?.setCrossfeedState) return setError('交叉馈送控制桥不可用。');
    setBusy(true); setError(null);
    try { const applied = await bridge.setCrossfeedState(next); setDraft(applied); onApplied(applied); }
    catch (cause) { setError(formatUserFacingError(cause, { context: 'audio' })); }
    finally { setBusy(false); }
  };
  return (
    <PanelShell
      eyebrow="Headphone Spatial"
      title="低频交叉馈送"
      description="在 Mid / Side 域收窄低频左右差异，保留高频定位，缓解耳机硬分离。"
      state={draft}
      defaults={defaultDspRackState().crossfeed}
      busy={busy}
      error={error}
      onDraft={setDraft}
      onApply={(next) => void apply(next)}
    >
      <Slider label="馈送量" value={draft.amount} display={`${Math.round(draft.amount * 100)}%`} min={0} max={1} step={0.01} disabled={busy} onChange={(amount) => setDraft((current) => ({ ...current, amount }))} />
      <Slider label="低通截止" value={draft.cutoffHz} display={`${Math.round(draft.cutoffHz)} Hz`} min={100} max={4000} step={10} disabled={busy} onChange={(cutoffHz) => setDraft((current) => ({ ...current, cutoffHz }))} />
    </PanelShell>
  );
};

export const StereoFieldPanel = ({ state, onApplied }: {
  state: StereoFieldState;
  onApplied: (state: StereoFieldState) => void;
}): JSX.Element => {
  const [draft, setDraft] = useState(state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(state), [state]);
  const apply = async (next: StereoFieldState): Promise<void> => {
    const bridge = getEqBridge();
    if (!bridge?.setStereoFieldState) return setError('立体声场控制桥不可用。');
    setBusy(true); setError(null);
    try { const applied = await bridge.setStereoFieldState(next); setDraft(applied); onApplied(applied); }
    catch (cause) { setError(formatUserFacingError(cause, { context: 'audio' })); }
    finally { setBusy(false); }
  };
  return (
    <PanelShell
      eyebrow="Mid / Side Field"
      title="立体声场"
      description="独立控制中心与侧声道增益，并在 0–200% 范围调整声场宽度。"
      state={draft}
      defaults={defaultDspRackState().stereoField}
      busy={busy}
      error={error}
      onDraft={setDraft}
      onApply={(next) => void apply(next)}
    >
      <Slider label="声场宽度" value={draft.width} display={`${Math.round(draft.width * 100)}%`} min={0} max={2} step={0.01} disabled={busy} onChange={(width) => setDraft((current) => ({ ...current, width }))} />
      <Slider label="中心增益" value={draft.centerGainDb} display={`${draft.centerGainDb.toFixed(1)} dB`} min={-18} max={18} step={0.5} disabled={busy} onChange={(centerGainDb) => setDraft((current) => ({ ...current, centerGainDb }))} />
      <Slider label="侧声道增益" value={draft.sideGainDb} display={`${draft.sideGainDb.toFixed(1)} dB`} min={-18} max={18} step={0.5} disabled={busy} onChange={(sideGainDb) => setDraft((current) => ({ ...current, sideGainDb }))} />
    </PanelShell>
  );
};

const matrixPreset = (name: 'identity' | 'swap' | 'mono'): Pick<ChannelMatrixState, 'leftToLeft' | 'rightToLeft' | 'leftToRight' | 'rightToRight'> => {
  if (name === 'swap') return { leftToLeft: 0, rightToLeft: 1, leftToRight: 1, rightToRight: 0 };
  if (name === 'mono') return { leftToLeft: 0.5, rightToLeft: 0.5, leftToRight: 0.5, rightToRight: 0.5 };
  return { leftToLeft: 1, rightToLeft: 0, leftToRight: 0, rightToRight: 1 };
};

export const ChannelMatrixPanel = ({ state, onApplied }: {
  state: ChannelMatrixState;
  onApplied: (state: ChannelMatrixState) => void;
}): JSX.Element => {
  const [draft, setDraft] = useState(state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(state), [state]);
  const apply = async (next: ChannelMatrixState): Promise<void> => {
    const bridge = getEqBridge();
    if (!bridge?.setChannelMatrixState) return setError('声道矩阵控制桥不可用。');
    setBusy(true); setError(null);
    try { const applied = await bridge.setChannelMatrixState(next); setDraft(applied); onApplied(applied); }
    catch (cause) { setError(formatUserFacingError(cause, { context: 'audio' })); }
    finally { setBusy(false); }
  };
  const setCoefficient = (key: keyof ReturnType<typeof matrixPreset>, value: number): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  return (
    <PanelShell
      eyebrow="2 × 2 Routing"
      title="声道矩阵"
      description="每个输出声道都可由左右输入按系数组合；系数支持反相和最高 2× 增益。"
      state={draft}
      defaults={defaultDspRackState().channelMatrix}
      busy={busy}
      error={error}
      onDraft={setDraft}
      onApply={(next) => void apply(next)}
      extraActions={(
        <>
          <button type="button" onClick={() => setDraft((current) => ({ ...current, ...matrixPreset('identity') }))}>直通</button>
          <button type="button" onClick={() => setDraft((current) => ({ ...current, ...matrixPreset('swap') }))}>左右交换</button>
          <button type="button" onClick={() => setDraft((current) => ({ ...current, ...matrixPreset('mono') }))}>等增益单声道</button>
        </>
      )}
    >
      <Slider label="L → L" value={draft.leftToLeft} display={draft.leftToLeft.toFixed(2)} min={-2} max={2} step={0.01} disabled={busy} onChange={(value) => setCoefficient('leftToLeft', value)} />
      <Slider label="R → L" value={draft.rightToLeft} display={draft.rightToLeft.toFixed(2)} min={-2} max={2} step={0.01} disabled={busy} onChange={(value) => setCoefficient('rightToLeft', value)} />
      <Slider label="L → R" value={draft.leftToRight} display={draft.leftToRight.toFixed(2)} min={-2} max={2} step={0.01} disabled={busy} onChange={(value) => setCoefficient('leftToRight', value)} />
      <Slider label="R → R" value={draft.rightToRight} display={draft.rightToRight.toFixed(2)} min={-2} max={2} step={0.01} disabled={busy} onChange={(value) => setCoefficient('rightToRight', value)} />
    </PanelShell>
  );
};
