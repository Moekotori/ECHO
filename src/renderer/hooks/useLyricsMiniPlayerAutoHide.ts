import { useEffect, useState, type RefObject } from 'react';

const hideDelayMs = 280;
const proximityPx = 150;
const revealBandPx = 164;

/** Owns only the lyrics pill's visibility, including its portalled menus and pointer drags. */
export const useLyricsMiniPlayerAutoHide = (
  hostRef: RefObject<HTMLDivElement>,
  enabled: boolean,
  queueOpen: boolean,
): boolean => {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(false);
    if (!enabled) return;

    let timer: number | undefined;
    let frame = 0;
    let dragging = false;
    let pointer: { x: number; y: number } | null = null;
    const host = hostRef.current;
    const cancelHide = (): void => {
      window.clearTimeout(timer);
      timer = undefined;
    };
    const reveal = (): void => {
      cancelHide();
      setHidden(false);
    };
    const isInteracting = (): boolean => {
      const focused = document.activeElement;
      return queueOpen || dragging || Boolean(
        host?.querySelector('[aria-expanded="true"], [data-popover-open="true"]') ||
        (focused instanceof HTMLElement && host?.contains(focused) && focused.matches(':focus-visible')),
      );
    };
    const isNear = (): boolean => {
      if (!pointer) return false;
      if (pointer.y >= window.innerHeight - revealBandPx) return true;
      // Use the resting footprint: the hidden host is translated below the viewport.
      const width = host?.offsetWidth || Math.min(820, Math.max(0, window.innerWidth - 96));
      const height = host?.offsetHeight || 72;
      return Math.abs(pointer.x - window.innerWidth / 2) <= width / 2 + proximityPx &&
        pointer.y >= window.innerHeight - height - proximityPx - 48;
    };
    const update = (): void => {
      if (isNear() || isInteracting()) {
        reveal();
      } else if (timer === undefined) {
        timer = window.setTimeout(() => {
          timer = undefined;
          if (!isNear() && !isInteracting()) setHidden(true);
        }, hideDelayMs);
      }
    };
    const requestUpdate = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };
    const onMove = (event: MouseEvent): void => {
      pointer = { x: event.clientX, y: event.clientY };
      requestUpdate();
    };
    const onLeave = (): void => {
      pointer = null;
      update();
    };
    const onPointerDown = (): void => {
      dragging = true;
      reveal();
    };
    const onPointerUp = (): void => {
      dragging = false;
      requestUpdate();
    };
    // Menu content may live in a portal. Observe the trigger's state, not its DOM location.
    const observer = new MutationObserver(requestUpdate);
    if (host) observer.observe(host, { subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'data-popover-open'] });
    window.addEventListener('mousemove', onMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    host?.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('focusin', requestUpdate);
    window.addEventListener('focusout', requestUpdate);
    window.addEventListener('resize', requestUpdate);
    update();

    return () => {
      cancelHide();
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      host?.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('focusin', requestUpdate);
      window.removeEventListener('focusout', requestUpdate);
      window.removeEventListener('resize', requestUpdate);
    };
  }, [enabled, hostRef, queueOpen]);

  return enabled && hidden;
};
