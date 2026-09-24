import { useEffect, useState } from 'react';
import { Gauge, Power, RotateCcw, Save } from 'lucide-react';
import {
  compressorAttackMaxMs,
  compressorAttackMinMs,
  compressorKneeMaxDb,
  compressorKneeMinDb,
  compressorMakeupMaxDb,
  compressorMakeupMinDb,
  compressorRatioMax,
  compressorRatioMin,
  compressorReleaseMaxMs,
  compressorReleaseMinMs,
  compressorThresholdMaxDb,
  compressorThresholdMinDb,
  defaultDspRackState,
  type CompressorState,
} from '../../../shared/types/dspRack';
import { getEqBridge } from '../../utils/echoBridge';
import { formatUserFacingError } from '../../utils/userFacingError';

type CompressorPanelProps = {
  state: CompressorState;
  onApplied: (state: CompressorState) => void;
};

type CompressorNumberKey = 'thresholdDb' | 'ratio' | 'attackMs' | 'releaseMs' | 'kneeDb' | 'makeupDb' | 'mix';

const controls: Array<{
  key: CompressorNumberKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'thresholdDb', label: '阈值', unit: 'dB', min: compressorThresholdMinDb, max: compressorThresholdMaxDb, step: 0.5 },
  { key: 'ratio', label: '压缩比', unit: ':1', min: compressorRatioMin, max: compressorRatioMax, step: 0.1 },
  { key: 'attackMs', label: '启动', unit: 'ms', min: compressorAttackMinMs, max: compressorAttackMaxMs, step: 0.1 },
  { key: 'releaseMs', label: '释放', unit: 'ms', min: compressorReleaseMinMs, max: compressorReleaseMaxMs, step: 1 },
  { key: 'kneeDb', label: '拐点宽度', unit: 'dB', min: compressorKneeMinDb, max: compressorKneeMaxDb, step: 0.5 },
  { key: 'makeupDb', label: '补偿增益', unit: 'dB', min: compressorMakeupMinDb, max: compressorMakeupMaxDb, step: 0.5 },
  { key: 'mix', label: '并行混合', unit: '%', min: 0, max: 1, step: 0.01 },
];

const displayValue = (key: CompressorNumberKey, value: number): string =>
  key === 'mix' ? `${Math.round(value * 100)}` : `${Number(value.toFixed(2))}`;

export const CompressorPanel = ({ state, onApplied }: CompressorPanelProps): JSX.Element => {
  const [draft, setDraft] = useState(state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(state), [state]);

  useEffect(() => {
    const eq = getEqBridge();
    if (!eq?.getCompressorState) return undefined;
    let cancelled = false;
    const refreshMeter = async (): Promise<void> => {
      try {
        const next = await eq.getCompressorState();
        if (!cancelled) {
          setDraft((current) => ({
            ...current,
            gainReductionDb: next.gainReductionDb,
            clippingRisk: next.clippingRisk,
          }));
        }
      } catch {
        // A transient host restart should not replace the editable draft with
        // an error state. The next successful poll restores native telemetry.
      }
    };
    const timer = window.setInterval(() => void refreshMeter(), 250);
    void refreshMeter();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const apply = async (next: CompressorState): Promise<void> => {
    const eq = getEqBridge();
    if (!eq?.setCompressorState) {
      setError('压缩器控制桥不可用。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const applied = await eq.setCompressorState(next);
      setDraft(applied);
      onApplied(applied);
    } catch (applyError) {
      setError(formatUserFacingError(applyError, { context: 'audio' }));
    } finally {
      setBusy(false);
    }
  };

  const setNumber = (key: CompressorNumberKey, value: number): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const reset = (): void => {
    const defaults = defaultDspRackState().compressor;
    setDraft(defaults);
  };

  return (
    <section className="dsp-module-panel dsp-module-panel--compressor" aria-label="压缩器">
      <header className="dsp-compressor-header">
        <div>
          <span>Native Dynamics</span>
          <h2>立体声联动压缩器</h2>
          <p>前馈峰值检测、软拐点与并行混合。处理发生在 Audio Core，控制面只提交参数。</p>
        </div>
        <button
          type="button"
          className="dsp-compressor-power"
          data-active={draft.enabled}
          disabled={busy}
          onClick={() => void apply({ ...draft, enabled: !draft.enabled })}
        >
          <Power size={16} aria-hidden="true" />
          {draft.enabled ? '已启用' : '已旁路'}
        </button>
      </header>

      <div className="dsp-compressor-meter" data-active={draft.enabled}>
        <Gauge size={20} aria-hidden="true" />
        <span>当前增益衰减</span>
        <strong>{draft.gainReductionDb.toFixed(1)} dB</strong>
      </div>

      {error ? <p className="dsp-rack-error" role="alert">{error}</p> : null}

      <div className="dsp-compressor-controls">
        {controls.map((control) => (
          <label key={control.key}>
            <span>
              <strong>{control.label}</strong>
              <em>{displayValue(control.key, draft[control.key])} {control.unit}</em>
            </span>
            <input
              type="range"
              aria-label={control.label}
              min={control.min}
              max={control.max}
              step={control.step}
              value={draft[control.key]}
              disabled={busy}
              onChange={(event) => setNumber(control.key, Number(event.target.value))}
            />
          </label>
        ))}
      </div>

      <footer className="dsp-compressor-actions">
        <button type="button" disabled={busy} onClick={reset}>
          <RotateCcw size={15} aria-hidden="true" />
          恢复默认
        </button>
        <button type="button" disabled={busy} onClick={() => void apply(draft)}>
          <Save size={15} aria-hidden="true" />
          应用参数
        </button>
      </footer>
    </section>
  );
};
