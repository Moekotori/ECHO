import { useState, useEffect, useCallback, useRef } from 'react';
import { Timer } from 'lucide-react';
import { SleepTimerPopover } from './SleepTimerPopover';
import { useI18n } from '../../i18n/I18nProvider';

const POPOVER_EXIT_MS = 180;
const POPOVER_CLOSE_DISTANCE_PX = 150;

/** 计算 point 到 rect 的最近距离 */
const distanceFromRect = (x: number, y: number, rect: DOMRect): number => {
  const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
  const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
  return Math.hypot(dx, dy);
};

/**
 * 睡眠定时器按钮组件
 * - 空闲态：显示定时器图标
 * - 运行态：显示 MM:SS 倒计时
 * - 点击弹出 Popover（带入场/退场动画 + 点击外部关闭）
 */
export const SleepTimerButton = (): JSX.Element => {
  const { t } = useI18n();
  const [isActive, setIsActive] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [showPopover, setShowPopover] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Popover 入场/退场动画控制
  useEffect(() => {
    if (showPopover) {
      setShouldRender(true);
      const frame = window.requestAnimationFrame(() => setIsVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }
    setIsVisible(false);
    if (!shouldRender) return undefined;
    const timer = window.setTimeout(() => setShouldRender(false), POPOVER_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [showPopover, shouldRender]);

  // 点击外部自动关闭 Popover（与 VolumeControl 相同模式）
  useEffect(() => {
    if (!showPopover) return undefined;

    const handlePointerMove = (event: PointerEvent): void => {
      const rects = [rootRef.current?.getBoundingClientRect(), popoverRef.current?.getBoundingClientRect()].filter(
        (r): r is DOMRect => Boolean(r),
      );
      const nearestDistance = Math.min(...rects.map((rect) => distanceFromRect(event.clientX, event.clientY, rect)));
      if (nearestDistance > POPOVER_CLOSE_DISTANCE_PX) {
        setShowPopover(false);
      }
    };

    const handlePointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setShowPopover(false);
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [showPopover]);

  // 监听定时器 tick 事件
  useEffect(() => {
    // 防御性检查：确保 preload 已正确暴露 sleepTimer API
    if (!window.echo?.sleepTimer) {
      console.warn('[SleepTimerButton] window.echo.sleepTimer is not available. Available keys:', window.echo ? Object.keys(window.echo) : 'window.echo is undefined');
      return undefined;
    }
    const unsubscribe = window.echo.sleepTimer.onTick((ms) => {
      setRemainingMs(ms);
      setIsActive(ms > 0);
    });
    return unsubscribe;
  }, []);

  // 初始化时获取一次状态
  useEffect(() => {
    if (!window.echo?.sleepTimer) return;
    window.echo.sleepTimer.getStatus().then((status) => {
      setIsActive(status.isActive);
      setRemainingMs(status.remainingMs);
    }).catch(() => {});
  }, []);

  const formatTime = useCallback((ms: number): string => {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }, []);

  const handleTogglePopover = useCallback(() => {
    setShowPopover((prev) => !prev);
  }, []);

  const handleClosePopover = useCallback(() => {
    setShowPopover(false);
  }, []);

  return (
    <div className="sleep-timer-control" ref={rootRef}>
      <button
        className={`icon-button ${isActive ? 'is-soft-active' : ''}`}
        type="button"
        aria-label={isActive ? t('sleepTimer.status.active', { time: formatTime(remainingMs) }) : t('sleepTimer.title')}
        title={isActive ? t('sleepTimer.status.active', { time: formatTime(remainingMs) }) : t('sleepTimer.title')}
        onClick={handleTogglePopover}
      >
        {isActive ? (
          <span className="sleep-timer-countdown">{formatTime(remainingMs)}</span>
        ) : (
          <Timer size={17} />
        )}
      </button>
      {shouldRender && (
        <SleepTimerPopover onClose={handleClosePopover} isVisible={isVisible} ref={popoverRef} />
      )}
    </div>
  );
};
