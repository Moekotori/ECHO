import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, X } from 'lucide-react';
import type { AppWallpaperPositionState } from '../../../../shared/types/appSettings';

type WallpaperPositionEditorProps = {
  imageUrl: string;
  saved: AppWallpaperPositionState | null;
  /**
   * Native dimensions of the picture being framed. For a static image, leave
   * at 0/0 — the editor reads them from the loaded image instead. For a video
   * first-frame capture, pass the frame's real width/height so the committed
   * framing can be restored against the actual video aspect.
   */
  naturalWidth?: number;
  naturalHeight?: number;
  /**
   * Initial wallpaper scale (percent). The editor treats this as the starting
   * zoom and commits the user's adjustments back as `appWallpaperPosition.zoom`
   * alongside a synced `appWallpaperScalePercent` so the non-position fallback
   * render path keeps the same size when fit modes change.
   */
  initialScalePercent?: number;
  /**
   * Aspect ratio (width / height) of the canvas the framing is being authored
   * for. Defaults to the current window's, which is correct for the wallpaper
   * the window is showing right now. The narrow-window wallpaper renders in a
   * portrait viewport, so it passes a portrait ratio and the preview shows the
   * crop that viewport will actually produce.
   */
  previewAspectRatio?: number;
  onCommit: (position: AppWallpaperPositionState, scalePercent: number) => void;
  onCancel: () => void;
  title: string;
  hint: string;
  scaleLabel: string;
  commitLabel: string;
  cancelLabel: string;
  resetLabel: string;
};

type EditorView = {
  zoom: number;
  x: number;
  y: number;
  w: number;
  h: number;
  iw: number;
  ih: number;
};

const clampZoom = (zoom: number): number => Math.max(0.1, Math.min(10, zoom));

/**
 * Framing editor for the app wallpaper's fit mode, ported from the standalone
 * background page's editor. The preview keeps the viewport's own aspect ratio,
 * so the committed framing — a fractional center plus a zoom on the contain
 * base — maps 1:1 onto the real wallpaper layer.
 */
export const WallpaperPositionEditor = ({
  imageUrl,
  saved,
  naturalWidth = 0,
  naturalHeight = 0,
  initialScalePercent = 100,
  previewAspectRatio,
  onCommit,
  onCancel,
  title,
  hint,
  scaleLabel,
  commitLabel,
  cancelLabel,
  resetLabel,
}: WallpaperPositionEditorProps): JSX.Element => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const viewRef = useRef<EditorView>({ zoom: 1, x: 0, y: 0, w: 0, h: 0, iw: 0, ih: 0 });
  const movedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [zoomState, setZoomState] = useState<number>(() => Math.max(0.1, Math.min(10, initialScalePercent / 100)));

  // Captured once when the editor opens (mirrors the standalone page) so a
  // window resize cannot shift the preview box out from under the framing.
  const [previewSize] = useState(() => {
    const aspect =
      previewAspectRatio && previewAspectRatio > 0
        ? previewAspectRatio
        : window.innerWidth / window.innerHeight;
    const maxWidth = Math.min(window.innerWidth * 0.75, 860);
    const maxHeight = window.innerHeight * 0.8;
    let width = maxWidth;
    let height = width / aspect;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * aspect;
    }
    return { width: Math.round(width), height: Math.round(height) };
  });
  const previewWidth = previewSize.width;
  const previewHeight = previewSize.height;

  const paint = useCallback(() => {
    const img = imgRef.current;
    if (!img) {
      return;
    }
    const view = viewRef.current;
    img.style.width = `${view.w}px`;
    img.style.height = `${view.h}px`;
    img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  }, []);

  const reset = useCallback(() => {
    const view = viewRef.current;
    if (view.w === 0) {
      return;
    }
    // Reset both the framing and the scale: 100% is the contain base scale,
    // centered in the viewport.
    view.zoom = 1;
    view.x = (previewWidth - view.w) / 2;
    view.y = (previewHeight - view.h) / 2;
    setZoomState(1);
    paint();
  }, [paint, previewHeight, previewWidth]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) {
      return;
    }
    const view = viewRef.current;
    const handleLoad = (): void => {
      const intrinsicWidth = naturalWidth > 0 ? naturalWidth : img.naturalWidth;
      const intrinsicHeight = naturalHeight > 0 ? naturalHeight : img.naturalHeight;
      const scale = Math.min(previewWidth / intrinsicWidth, previewHeight / intrinsicHeight);
      view.w = intrinsicWidth * scale;
      view.h = intrinsicHeight * scale;
      view.iw = intrinsicWidth;
      view.ih = intrinsicHeight;
      const fallbackZoom = Math.max(0.1, Math.min(10, initialScalePercent / 100));
      if (saved && saved.iw === view.iw && saved.ih === view.ih) {
        view.zoom = Number.isFinite(saved.zoom) ? saved.zoom : fallbackZoom;
        view.x = saved.x * previewWidth - (view.w * view.zoom) / 2;
        view.y = saved.y * previewHeight - (view.h * view.zoom) / 2;
      } else {
        view.zoom = fallbackZoom;
        view.x = (previewWidth - view.w * view.zoom) / 2;
        view.y = (previewHeight - view.h * view.zoom) / 2;
      }
      paint();
      setZoomState(view.zoom);
      setReady(true);
    };
    if (img.complete && img.naturalWidth > 0) {
      handleLoad();
    } else {
      img.addEventListener('load', handleLoad);
    }
    return () => img.removeEventListener('load', handleLoad);
  }, [initialScalePercent, naturalHeight, naturalWidth, paint, previewHeight, previewWidth, saved]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  // Lock the page underneath the editor so the mouse wheel only affects the
  // canvas (and the scale slider) — the settings page would otherwise
  // continue scrolling while the editor is open.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'contain';
    const swallowWheel = (event: WheelEvent): void => {
      event.preventDefault();
    };
    document.addEventListener('wheel', swallowWheel, { passive: false, capture: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
      document.removeEventListener('wheel', swallowWheel, { capture: true });
    };
  }, []);

  const commit = (): void => {
    const view = viewRef.current;
    if (view.iw <= 0 || view.ih <= 0) {
      onCancel();
      return;
    }
    onCommit(
      {
        zoom: view.zoom,
        x: (view.x + (view.w * view.zoom) / 2) / previewWidth,
        y: (view.y + (view.h * view.zoom) / 2) / previewHeight,
        iw: view.iw,
        ih: view.ih,
      },
      Math.max(40, Math.min(220, Math.round(view.zoom * 100))),
    );
  };

  const handleScaleSlider = (percent: number): void => {
    const nextZoom = clampZoom(percent / 100);
    const view = viewRef.current;
    if (view.w === 0) {
      // Image not loaded yet — still record the requested zoom so the
      // first paint lands at the right size.
      view.zoom = nextZoom;
      setZoomState(nextZoom);
      return;
    }
    const mx = previewWidth / 2;
    const my = previewHeight / 2;
    const ratio = nextZoom / view.zoom;
    view.x = mx - (mx - view.x) * ratio;
    view.y = my - (my - view.y) * ratio;
    view.zoom = nextZoom;
    setZoomState(nextZoom);
    paint();
  };

  const handleMouseDown = (event: React.MouseEvent): void => {
    event.preventDefault();
    movedRef.current = false;
    const view = viewRef.current;
    const startX = event.clientX;
    const startY = event.clientY;
    const startPx = view.x;
    const startPy = view.y;
    const onMove = (ev: MouseEvent): void => {
      if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) {
        movedRef.current = true;
      }
      view.x = startPx + ev.clientX - startX;
      view.y = startPy + ev.clientY - startY;
      paint();
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleWheel = (event: React.WheelEvent): void => {
    event.preventDefault();
    movedRef.current = false;
    const view = viewRef.current;
    const mx = previewWidth / 2;
    const my = previewHeight / 2;
    const nextZoom = clampZoom(view.zoom * (event.deltaY > 0 ? 0.97 : 1.03));
    view.x = mx - (mx - view.x) * (nextZoom / view.zoom);
    view.y = my - (my - view.y) * (nextZoom / view.zoom);
    view.zoom = nextZoom;
    setZoomState(nextZoom);
    paint();
  };

  const pinchRef = useRef<{ dist: number; zoom: number; cx: number; cy: number; px: number; py: number } | null>(null);
  const panRef = useRef<{ sx: number; sy: number; spx: number; spy: number } | null>(null);

  const handleTouchStart = (event: React.TouchEvent): void => {
    movedRef.current = false;
    const view = viewRef.current;
    const card = cardRef.current;
    if (!card) {
      return;
    }
    const rect = card.getBoundingClientRect();
    if (event.touches.length >= 2) {
      panRef.current = null;
      const [a, b] = [event.touches[0], event.touches[1]];
      pinchRef.current = {
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        zoom: view.zoom,
        cx: (a.clientX + b.clientX) / 2 - rect.left,
        cy: (a.clientY + b.clientY) / 2 - rect.top,
        px: view.x,
        py: view.y,
      };
      return;
    }
    pinchRef.current = null;
    if (event.touches.length === 1 && card.contains(event.target as Node)) {
      const touch = event.touches[0];
      panRef.current = { sx: touch.clientX, sy: touch.clientY, spx: view.x, spy: view.y };
    }
  };

  const handleTouchMove = (event: React.TouchEvent): void => {
    const view = viewRef.current;
    const card = cardRef.current;
    if (!card) {
      return;
    }
    const rect = card.getBoundingClientRect();
    if (event.touches.length >= 2 && pinchRef.current) {
      event.preventDefault();
      const pinch = pinchRef.current;
      if (pinch.dist <= 0) {
        return;
      }
      movedRef.current = true;
      const [a, b] = [event.touches[0], event.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const cx = (a.clientX + b.clientX) / 2 - rect.left;
      const cy = (a.clientY + b.clientY) / 2 - rect.top;
      const nextZoom = clampZoom(pinch.zoom * (dist / pinch.dist));
      view.x = cx - ((pinch.cx - pinch.px) / pinch.zoom) * nextZoom;
      view.y = cy - ((pinch.cy - pinch.py) / pinch.zoom) * nextZoom;
      view.zoom = nextZoom;
      setZoomState(nextZoom);
      paint();
      return;
    }
    if (event.touches.length === 1 && panRef.current) {
      event.preventDefault();
      const pan = panRef.current;
      const touch = event.touches[0];
      if (Math.abs(touch.clientX - pan.sx) > 4 || Math.abs(touch.clientY - pan.sy) > 4) {
        movedRef.current = true;
      }
      view.x = pan.spx + touch.clientX - pan.sx;
      view.y = pan.spy + touch.clientY - pan.sy;
      paint();
    }
  };

  const handleTouchEnd = (event: React.TouchEvent): void => {
    const view = viewRef.current;
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      panRef.current = { sx: touch.clientX, sy: touch.clientY, spx: view.x, spy: view.y };
      pinchRef.current = null;
    } else if (event.touches.length === 0) {
      panRef.current = null;
      pinchRef.current = null;
    }
  };

  return createPortal(
    <div
      className="settings-modal-backdrop wallpaper-editor-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (movedRef.current) {
          movedRef.current = false;
          return;
        }
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        aria-label={title}
        aria-modal="true"
        className="wallpaper-editor-modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-font-modal-header">
          <h3>{title}</h3>
          <button aria-label={cancelLabel} className="settings-icon-button" type="button" onClick={onCancel}>
            <X size={15} />
          </button>
        </header>
        <div
          ref={cardRef}
          className="wallpaper-editor-canvas"
          style={{ width: previewWidth, height: previewHeight, cursor: ready ? 'grab' : 'default' }}
          onMouseDown={handleMouseDown}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
          onTouchStart={handleTouchStart}
          onWheel={handleWheel}
        >
          <img alt="" draggable={false} ref={imgRef} src={imageUrl} />
        </div>
        <p className="wallpaper-editor-hint">{hint}</p>
        <div className="wallpaper-editor-scale">
          <span>{scaleLabel}</span>
          <input
            aria-label={scaleLabel}
            className="settings-range"
            max={220}
            min={40}
            step={1}
            type="range"
            value={Math.round(zoomState * 100)}
            onChange={(event) => handleScaleSlider(Number(event.target.value))}
            onInput={(event) => handleScaleSlider(Number((event.target as HTMLInputElement).value))}
          />
          <strong>{Math.round(zoomState * 100)}%</strong>
        </div>
        <div className="wallpaper-editor-actions">
          <button className="settings-action-button" type="button" onClick={reset}>
            <RotateCcw size={14} />
            {resetLabel}
          </button>
          <span className="wallpaper-editor-actions-spacer" />
          <button className="settings-action-button" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="settings-primary-button" type="button" onClick={commit}>
            {commitLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
};
