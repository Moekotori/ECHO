import { useState, useEffect, useCallback, forwardRef } from 'react';
import type { SleepTimerAction, SleepTimerStatus } from '../../../shared/types/sleepTimer';
import { useI18n } from '../../i18n/I18nProvider';

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
};

/**
 * 睡眠定时器弹出面板
 * - 空闲态：显示行为选择 + 预设时长按钮
 * - 运行态：显示倒计时 + 取消按钮
 *
 * 样式由外部 `.sleep-timer-popover` CSS 类控制（定义在 app.css）
 */
export const SleepTimerPopover = forwardRef<HTMLDivElement, SleepTimerPopoverProps>(
  ({ onClose, isVisible }, ref): JSX.Element => {
  const { t } = useI18n();
  const [status, setStatus] = useState<SleepTimerStatus | null>(null);
  const [selectedAction, setSelectedAction] = useState<SleepTimerAction>('pause');
  const [fadeOutEnabled, setFadeOutEnabled] = useState(true);
  const [customMinutes, setCustomMinutes] = useState('');

  /** 自定义时长是否有效（1-120 分钟） */
  const parsedMinutes = parseInt(customMinutes, 10);
  const isCustomValid = customMinutes !== '' && Number.isFinite(parsedMinutes) && parsedMinutes >= 1 && parsedMinutes <= 120;

  // 获取初始状态
  useEffect(() => {
    window.echo.sleepTimer.getStatus().then((s) => {
      setStatus(s);
      if (s.isActive) {
        setSelectedAction(s.action);
        setFadeOutEnabled(s.fadeOutEnabled);
      }
    }).catch(() => {});
  }, []);

  // 监听 tick 更新
  useEffect(() => {
    const unsubscribe = window.echo.sleepTimer.onTick((remainingMs) => {
      setStatus((prev: SleepTimerStatus | null) => prev ? { ...prev, remainingMs, isActive: remainingMs > 0 } : prev);
    });
    return unsubscribe;
  }, []);

  const handleStart = useCallback(async (minutes: number) => {
    const newStatus = await window.echo.sleepTimer.start({
      durationMinutes: minutes,
      action: selectedAction,
      fadeOut: fadeOutEnabled,
    });
    setStatus(newStatus);
    setCustomMinutes('');
  }, [selectedAction, fadeOutEnabled]);

  const handleCustomStart = useCallback(() => {
    if (isCustomValid) {
      handleStart(parsedMinutes);
    }
  }, [isCustomValid, parsedMinutes, handleStart]);

  const handleCancel = useCallback(async () => {
    const newStatus = await window.echo.sleepTimer.cancel();
    setStatus(newStatus);
  }, []);

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
    <div ref={ref} className="sleep-timer-popover" data-open={isVisible}>
      {/* 标题 */}
      <div className="st-popover-title">{t('sleepTimer.title')}</div>

      {status?.isActive ? (
        /* 运行态：倒计时 + 取消 */
        <div className="st-popover-running">
          <span className="st-countdown">{formatTime(status.remainingMs)}</span>
          <span className="st-hint">{t('sleepTimer.afterAction', { action: getActionLabel(status.action) })}</span>
          <button className="st-cancel-btn icon-button" type="button" onClick={handleCancel}>
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
                className={`st-action-btn ${selectedAction === opt.value ? 'is-active' : ''}`}
                type="button"
                onClick={() => setSelectedAction(opt.value)}
              >
                {t(opt.key)}
              </button>
            ))}
          </div>

          {/* 渐弱开关 */}
          <label className="st-fade-row">
            <span className="st-label">{t('sleepTimer.fadeOut.label')}</span>
            <div className={`st-toggle ${fadeOutEnabled ? 'is-on' : ''}`} onClick={() => setFadeOutEnabled((prev) => !prev)}>
              <span className="st-toggle-knob" />
            </div>
          </label>

          {/* 预设时长网格 */}
          <div className="st-preset-grid">
            {PRESET_MINUTES.map((minutes) => (
              <button
                key={minutes}
                className="st-preset-btn"
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
              disabled={!isCustomValid}
            >
              {t('sleepTimer.custom.confirm')}
            </button>
          </div>
        </>
      )}
    </div>
  );
});
