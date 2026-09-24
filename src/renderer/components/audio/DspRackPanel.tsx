import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, LockKeyhole, RotateCcw, Save } from 'lucide-react';
import {
  defaultDspRackState,
  dspRackModuleIds,
  type DspRackModuleId,
  type DspRackState,
} from '../../../shared/types/dspRack';
import { getEqBridge } from '../../utils/echoBridge';
import { formatUserFacingError } from '../../utils/userFacingError';

const rackModuleLabels: Record<DspRackModuleId, { title: string; detail: string }> = {
  replayGain: { title: 'ReplayGain / Loudnorm', detail: '按曲目或专辑响度校准输入增益' },
  equalizer: { title: '均衡器', detail: '图示与参数均衡、AutoEq / APO 滤波器' },
  convolution: { title: '卷积', detail: '房间校正与耳机脉冲响应' },
  compressor: { title: '压缩器', detail: '立体声联动软拐点动态控制与并行混合' },
  crossfeed: { title: '交叉馈送', detail: '收窄低频左右差异，缓解耳机声像硬分离' },
  stereoField: { title: '立体声场', detail: 'Mid / Side 宽度、中心和侧声道增益' },
  channelMatrix: { title: '声道矩阵', detail: '可编程 2×2 左右声道路由与混合' },
  channelBalance: { title: '声道处理', detail: '平衡、延迟、反相与单声道矩阵' },
};

const fixedStageLabels = {
  headroom: 'Headroom',
  truePeakLimiter: 'True Peak Limiter',
  playbackRate: '播放速率',
  levelMeter: '最终电平表',
} as const;

export const moveDspRackModule = (
  order: readonly DspRackModuleId[],
  moduleId: DspRackModuleId,
  direction: -1 | 1,
): DspRackModuleId[] => {
  const index = order.indexOf(moduleId);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= order.length) {
    return [...order];
  }

  const next = [...order];
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
};

export const DspRackPanel = (): JSX.Element => {
  const [appliedState, setAppliedState] = useState<DspRackState>(defaultDspRackState);
  const [draftOrder, setDraftOrder] = useState<DspRackModuleId[]>([...dspRackModuleIds]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const eq = getEqBridge();
      if (!eq?.getDspRackState) return;
      try {
        const state = await eq.getDspRackState();
        if (!cancelled) {
          setAppliedState(state);
          setDraftOrder([...state.order]);
        }
      } catch (loadError) {
        if (!cancelled) setError(formatUserFacingError(loadError, { context: 'audio' }));
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const dirty = useMemo(
    () => draftOrder.some((moduleId, index) => moduleId !== appliedState.order[index]),
    [appliedState.order, draftOrder],
  );

  const applyOrder = async (order: DspRackModuleId[]): Promise<void> => {
    const eq = getEqBridge();
    if (!eq?.setDspRackState) {
      setError('DSP Rack 控制桥不可用。');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const state = await eq.setDspRackState({ order });
      setAppliedState(state);
      setDraftOrder([...state.order]);
    } catch (applyError) {
      setError(formatUserFacingError(applyError, { context: 'audio' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dsp-module-panel dsp-module-panel--rack" aria-label="DSP Rack 编排">
      <header className="dsp-rack-header">
        <div>
          <span>Native DSP Rack</span>
          <h2>编排实际处理顺序</h2>
          <p>拖动式编排会在后续加入；当前用上下按钮精确调整。应用后立即作用于当前 PCM 链，并持久化到下次启动。</p>
        </div>
        <div className="dsp-rack-actions">
          <button type="button" disabled={busy || !dirty} onClick={() => void applyOrder(draftOrder)}>
            <Save size={15} aria-hidden="true" />
            应用顺序
          </button>
          <button type="button" disabled={busy} onClick={() => setDraftOrder([...dspRackModuleIds])}>
            <RotateCcw size={15} aria-hidden="true" />
            默认顺序
          </button>
        </div>
      </header>

      {error ? <p className="dsp-rack-error" role="alert">{error}</p> : null}

      <ol className="dsp-rack-list">
        {draftOrder.map((moduleId, index) => {
          const copy = rackModuleLabels[moduleId];
          return (
            <li key={moduleId}>
              <GripVertical size={17} aria-hidden="true" />
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                <strong>{copy.title}</strong>
                <small>{copy.detail}</small>
              </div>
              <button
                type="button"
                aria-label={`上移 ${copy.title}`}
                disabled={busy || index === 0}
                onClick={() => setDraftOrder((order) => moveDspRackModule(order, moduleId, -1))}
              >
                <ArrowUp size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`下移 ${copy.title}`}
                disabled={busy || index === draftOrder.length - 1}
                onClick={() => setDraftOrder((order) => moveDspRackModule(order, moduleId, 1))}
              >
                <ArrowDown size={15} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>

      <footer className="dsp-rack-fixed">
        <div>
          <LockKeyhole size={16} aria-hidden="true" />
          <span>
            <strong>固定输出安全段</strong>
            <small>这些阶段不可移动，避免破坏削波保护、速率状态和最终遥测。</small>
          </span>
        </div>
        <ul>
          {appliedState.fixedPostStages.map((stage) => <li key={stage}>{fixedStageLabels[stage]}</li>)}
        </ul>
      </footer>
    </section>
  );
};
