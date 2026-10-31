import { useState, useEffect, useCallback, useRef, forwardRef } from 'react';
import type { SleepTimerAction, SleepTimerStatus } from '../../../shared/types/sleepTimer';
import { translateFallback, useOptionalI18n } from '../../i18n/I18nProvider';

/** 预设时长（分钟） */
const PRESET_MINUTES = [5, 10, 15, 30, 45, 60] as const;

/** 触发行为 key 映射 */
const ACTION_KEYS: { value: SleepTimerAction; key: 'sleepTimer.action.pause' | 'sleepTimer.action.stop' | 'sleepTimer.action.quit' }[] = [
  { value: 'pause', key: 'sleepTimer.action.pause' },
  { value: 'stop', key: 'sleepTimer.action.stop' },
  { value: 'quit', key: 'sleepTimer.action.quit' },
];

type SleepTimerPopoverProps = {
  onClose: () => void;
  isVisible: boolean;
  embedded?: boolean;
};

/**
 * 睡眠定时器弹出面板
 * - 空闲态：显示行为选择 + 预设时长按钮
 * - 运行态：显示倒计时 + 取消按钮
 *
 * 样式由外部 `.sleep-timer-popover` CSS 类控制（定义在 app.css）
 */
export const SleepTimerPopover = forwardRef<HTMLDivElement, SleepTimerPopoverProps>(
  ({ onClose: _onClose, isVisible, embedded = false }, ref): JSX.Element => {
  const t = useOptionalI18n()?.t ?? translateFallback;
  const [status, setStatus] = useState<SleepTimerStatus | null>(null);
  const [selectedAction, setSelectedAction] = useState<SleepTimerAction>('pause');
  const [fadeOutEnabled, setFadeOutEnabled] = useState(true);
  const [customMinutes, setCustomMinutes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const commandPendingRef = useRef(false);
  const statusRevisionRef = useRef(0);
  const timerAvailable = Boolean(window.echo?.sleepTimer);

  /** 自定义时长是否有效（1-120 分钟） */
  const parsedMinutes = Number(customMinutes);
  const isCustomValid = customMinutes !== '' && Number.isInteger(parsedMinutes) && parsedMinutes >= 1 && parsedMinutes <= 120;

  // 获取初始状态
  useEffect(() => {
    if (!isVisible || !window.echo?.sleepTimer) return;
    let cancelled = false;
    const revision = statusRevisionRef.current;
    window.echo.sleepTimer.getStatus().then((s) => {
      if (cancelled || revision !== statusRevisionRef.current) return;
      setStatus(s);
      setError(null);
      if (s.isActive) {
        setSelectedAction(s.action);
        setFadeOutEnabled(s.fadeOutEnabled);
      }
    }).catch((reason) => {
      if (!cancelled && revision === statusRevisionRef.current) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { cancelled = true; };
  }, [isVisible]);

  // 监听 tick 更新
  useEffect(() => {
    if (!window.echo?.sleepTimer) return;
    const unsubscribe = window.echo.sleepTimer.onTick((remainingMs) => {
      setStatus((prev: SleepTimerStatus | null) => prev ? { ...prev, remainingMs, isActive: remainingMs > 0 } : prev);
    });
    return unsubscribe;
  }, []);

  const runCommand = useCallback(async (command: () => Promise<SleepTimerStatus>): Promise<void> => {
    if (commandPendingRef.current) return;
    commandPendingRef.current = true;
    statusRevisionRef.current += 1;
    setIsBusy(true);
    setError(null);
    try {
      const newStatus = await command();
      setStatus(newStatus);
      if (newStatus.isActive) setCustomMinutes('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      commandPendingRef.current = false;
      setIsBusy(false);
    }
  }, []);

  const handleStart = useCallback((minutes: number): void => {
    const timer = window.echo?.sleepTimer;
    if (!timer || !Number.isInteger(minutes) || minutes < 1 || minutes > 120) return;
    void runCommand(() => timer.start({ durationMinutes: minutes, action: selectedAction, fadeOut: fadeOutEnabled }));
  }, [selectedAction, fadeOutEnabled, runCommand]);

  const handleCustomStart = useCallback(() => {
    if (isCustomValid) handleStart(parsedMinutes);
  }, [isCustomValid, parsedMinutes, handleStart]);

  const handleCancel = useCallback((): void => {
    const timer = window.echo?.sleepTimer;
    if (timer) void runCommand(() => timer.cancel());
  }, [runCommand]);

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  /** 获取 action 的翻译标签 */
  const getActionLabel = (action: SleepTimerAction): string => {
    const mapping: Record<SleepTimerAction, 'sleepTimer.action.pause' | 'sleepTimer.action.stop' | 'sleepTimer.action.quit'> = {
      pause: 'sleepTimer.action.pause',
      stop: 'sleepTimer.action.stop',
      quit: 'sleepTimer.action.quit',
    };
    return t(mapping[action]);
  };

  return (
    <div ref={ref} className="sleep-timer-popover" data-embedded={embedded || undefined} data-open={isVisible} aria-busy={isBusy}>
      {/* 标题 */}
      <div className="st-popover-title">{t('sleepTimer.title')}</div>

      <div className="st-enable-row">
        <span className="st-enable-copy">
          <span>{t('sleepTimer.title')}</span>
          {!status?.isActive ? <small>{isCustomValid ? parsedMinutes : 30} {t('sleepTimer.custom.unit')}</small> : null}
        </span>
        <span className="st-switch-status">{t(status?.isActive ? 'firstRun.feature.enabled' : 'settings.about.updates.state.disabled')}</span>
        <button className={`st-toggle ${status?.isActive ? 'is-on' : ''}`} type="button" role="switch"
          aria-label={t('sleepTimer.title')} aria-checked={status?.isActive === true} disabled={isBusy || !timerAvailable}
          onClick={() => status?.isActive ? handleCancel() : handleStart(isCustomValid ? parsedMinutes : 30)}>
          <span className="st-toggle-knob" aria-hidden="true" />
        </button>
      </div>
      {error ? <div className="st-error" role="alert">{error}</div> : null}
      {status?.isActive ? (
        /* 运行态：倒计时 + 取消 */
        <div className="st-popover-running">
          <span className="st-countdown">{formatTime(status.remainingMs)}</span>
          <span className="st-hint">{t('sleepTimer.afterAction', { action: getActionLabel(status.action) })}</span>
          <button className="st-cancel-btn" type="button" disabled={isBusy || !timerAvailable} onClick={handleCancel}>
            {t('sleepTimer.status.cancel')}
          </button>
        </div>
      ) : (
        /* 空闲态：设置面板 */
        <>
          {/* 行为选择 */}
          <div className="st-action-bar">
            {ACTION_KEYS.map((opt) => (
              <button
                key={opt.value}
                disabled={isBusy || !timerAvailable}
                aria-pressed={selectedAction === opt.value}
                className={`st-action-btn ${selectedAction === opt.value ? 'is-active' : ''}`}
                type="button"
                onClick={() => setSelectedAction(opt.value)}
              >
                {t(opt.key)}
              </button>
            ))}
          </div>

          {/* 渐弱开关 */}
          <div className="st-fade-row">
            <span className="st-label">{t('sleepTimer.fadeOut.label')}</span>
            <span className="st-switch-status">{t(fadeOutEnabled ? 'firstRun.feature.enabled' : 'settings.about.updates.state.disabled')}</span>
            <button
              className={`st-toggle ${fadeOutEnabled ? 'is-on' : ''}`}
              type="button"
              role="switch"
              aria-checked={fadeOutEnabled}
              disabled={isBusy || !timerAvailable}
              aria-label={t('sleepTimer.fadeOut.label')}
              onClick={() => setFadeOutEnabled((prev) => !prev)}
            >
              <span className="st-toggle-knob" aria-hidden="true" />
            </button>
          </div>

          {/* 预设时长网格 */}
          <div className="st-preset-grid">
            {PRESET_MINUTES.map((minutes) => (
              <button
                key={minutes}
                className="st-preset-btn"
                disabled={isBusy || !timerAvailable}
                type="button"
                onClick={() => handleStart(minutes)}
              >
                {t(`sleepTimer.preset.${minutes}` as 'sleepTimer.preset.5' | 'sleepTimer.preset.10' | 'sleepTimer.preset.15' | 'sleepTimer.preset.30' | 'sleepTimer.preset.45' | 'sleepTimer.preset.60')}
              </button>
            ))}
          </div>

          {/* 自定义时长输入行 */}
          <div className="st-custom-row">
            <input
              type="number"
              step={1}
              disabled={isBusy || !timerAvailable}
              min={1}
              max={120}
              value={customMinutes}
              onChange={(e) => setCustomMinutes(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCustomStart(); }}
              placeholder="--"
              aria-label={t('sleepTimer.custom.unit')}
              className="st-input"
            />
            <span className="st-unit">{t('sleepTimer.custom.unit')}</span>
            <button
              className="st-confirm-btn"
              type="button"
              onClick={handleCustomStart}
              disabled={!isCustomValid || isBusy || !timerAvailable}
            >
              {t('sleepTimer.custom.confirm')}
            </button>
          </div>
        </>
      )}
    </div>
  );
});
