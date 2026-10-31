import '../../../styles/setting-help-tooltip.css';
import {
  useId,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp } from 'lucide-react';

type SettingHelpTooltipProps = {
  children: ReactNode;
  label: string;
};

const TOOLTIP_GAP_PX = 6;
const TOOLTIP_INLINE_OFFSET_PX = 6;
const TOOLTIP_VIEWPORT_PADDING_PX = 24;
const TOOLTIP_MAX_WIDTH_PX = 340;
const CLOSE_DELAY_MS = 160;

const getHelpTooltipStyle = (trigger: HTMLElement, bubble: HTMLElement | null): CSSProperties => {
  const rect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxWidth = Math.min(TOOLTIP_MAX_WIDTH_PX, Math.max(0, viewportWidth - TOOLTIP_VIEWPORT_PADDING_PX * 2));
  const rtl = getComputedStyle(trigger).direction === 'rtl';
  const preferredLeft = rtl
    ? rect.right + TOOLTIP_INLINE_OFFSET_PX - maxWidth
    : rect.left - TOOLTIP_INLINE_OFFSET_PX;
  const left = Math.min(
    Math.max(TOOLTIP_VIEWPORT_PADDING_PX, preferredLeft),
    Math.max(TOOLTIP_VIEWPORT_PADDING_PX, viewportWidth - maxWidth - TOOLTIP_VIEWPORT_PADDING_PX),
  );
  const height = bubble?.scrollHeight ?? 0;
  const below = Math.max(0, viewportHeight - rect.bottom - TOOLTIP_GAP_PX - TOOLTIP_VIEWPORT_PADDING_PX);
  const above = Math.max(0, rect.top - TOOLTIP_GAP_PX - TOOLTIP_VIEWPORT_PADDING_PX);
  const placeAbove = height > below && above > below;
  const availableHeight = Math.min(
    placeAbove ? above : below,
    Math.max(0, viewportHeight - TOOLTIP_VIEWPORT_PADDING_PX * 2),
  );

  return {
    left,
    width: maxWidth,
    maxHeight: availableHeight,
    top: placeAbove ? 'auto' : Math.max(TOOLTIP_VIEWPORT_PADDING_PX, rect.bottom + TOOLTIP_GAP_PX),
    bottom: placeAbove ? Math.max(TOOLTIP_VIEWPORT_PADDING_PX, viewportHeight - rect.top + TOOLTIP_GAP_PX) : 'auto',
  };
};

export const SettingHelpTooltip = ({ children, label }: SettingHelpTooltipProps): JSX.Element => {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [bubbleStyle, setBubbleStyle] = useState<CSSProperties | null>(null);
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(false);
  const focusedRef = useRef(false);
  const hoveredRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback((): void => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const close = useCallback((): void => {
    cancelClose();
    pinnedRef.current = false;
    setPinned(false);
    setOpen(false);
  }, [cancelClose]);

  const scheduleClose = (): void => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      if (!pinnedRef.current && !focusedRef.current && !hoveredRef.current) setOpen(false);
    }, CLOSE_DELAY_MS);
  };

  const enter = (): void => {
    hoveredRef.current = true;
    cancelClose();
    setOpen(true);
  };

  const leave = (): void => {
    hoveredRef.current = false;
    scheduleClose();
  };

  useEffect(() => () => {
    if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onOutsideInteraction = (event: Event): void => {
      if (event.target instanceof Node && !triggerRef.current?.contains(event.target) && !bubbleRef.current?.contains(event.target)) close();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', onOutsideInteraction, true);
    document.addEventListener('focusin', onOutsideInteraction, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', onOutsideInteraction, true);
      document.removeEventListener('focusin', onOutsideInteraction, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', close);
    };
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open) {
      setBubbleStyle(null);
      return undefined;
    }

    const updatePosition = (): void => {
      const trigger = triggerRef.current;
      if (!trigger) {
        return;
      }

      setBubbleStyle(getHelpTooltipStyle(trigger, bubbleRef.current));
    };

    const onScroll = (event: Event): void => {
      // Reading a long bubble should not dismiss it; scrolling its page should.
      if (!(event.target instanceof Node) || !bubbleRef.current?.contains(event.target)) close();
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, children, close]);

  return (
    <span
      className="setting-help-tooltip"
      data-search-keywords={typeof children === 'string' ? children : undefined}
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      <button
        ref={triggerRef}
        className="setting-help-tooltip__trigger"
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        data-pinned={pinned ? 'true' : undefined}
        onClick={() => {
          if (pinnedRef.current) close();
          else {
            cancelClose();
            pinnedRef.current = true;
            setPinned(true);
            setOpen(true);
          }
        }}
        onBlur={() => {
          focusedRef.current = false;
          if (!pinnedRef.current && !hoveredRef.current) close();
          else scheduleClose();
        }}
        onFocus={() => {
          focusedRef.current = true;
          cancelClose();
          setOpen(true);
        }}
      >
        <CircleHelp size={15} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && document.body
        ? createPortal(
            <span
              ref={bubbleRef}
              className="setting-help-tooltip__bubble"
              id={tooltipId}
              role="tooltip"
              onMouseEnter={enter}
              onMouseLeave={leave}
              style={bubbleStyle ?? { visibility: 'hidden' }}
            >
              {children}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
};
