import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Disc3, Mic2, Music2 } from 'lucide-react';
import type { AudioStatus } from '../../shared/types/audio';
import type { AppSettings } from '../../shared/types/appSettings';
import type { PlaybackStatus } from '../../shared/types/playback';
import { PlayerStatusChips } from '../components/player/PlayerStatusChips';
import { titleFromPath } from '../components/player/playerFormat';
import { useI18n } from '../i18n/I18nProvider';
import { usePlaybackQueue } from '../stores/PlaybackQueueProvider';

const idlePollingStates = new Set(['paused', 'stopped', 'idle', 'error']);
const nowPlayingMarqueeOverflowPx = 4;
const coverColorSampleSize = 32;
const maxCachedCoverPalettes = 48;
const readLowLoadPlaybackModeEnabled = (settings: Partial<AppSettings> | null | undefined): boolean =>
  settings?.lowLoadPlaybackModeEnabled === true;
const readNowPlayingCoverColorEnabled = (settings: Partial<AppSettings> | null | undefined): boolean =>
  settings?.nowPlayingCoverColorEnabled === true;

type NowPlayingCoverPalette = {
  rgb: string;
};

const coverPaletteCache = new Map<string, NowPlayingCoverPalette | null>();

const cacheCoverPalette = (coverUrl: string, palette: NowPlayingCoverPalette | null): void => {
  if (coverPaletteCache.size >= maxCachedCoverPalettes) {
    const firstKey = coverPaletteCache.keys().next().value as string | undefined;
    if (firstKey) {
      coverPaletteCache.delete(firstKey);
    }
  }

  coverPaletteCache.set(coverUrl, palette);
};

const scheduleCoverColorRead = (callback: () => void): (() => void) => {
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (typeof idleWindow.requestIdleCallback === 'function') {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 700 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(callback, 120);
  return () => window.clearTimeout(handle);
};

const extractCoverPalette = (image: HTMLImageElement): NowPlayingCoverPalette | null => {
  const canvas = document.createElement('canvas');
  canvas.width = coverColorSampleSize;
  canvas.height = coverColorSampleSize;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    return null;
  }

  context.drawImage(image, 0, 0, coverColorSampleSize, coverColorSampleSize);

  const data = context.getImageData(0, 0, coverColorSampleSize, coverColorSampleSize).data;
  let weightedRed = 0;
  let weightedGreen = 0;
  let weightedBlue = 0;
  let weightTotal = 0;
  let fallbackRed = 0;
  let fallbackGreen = 0;
  let fallbackBlue = 0;
  let fallbackWeightTotal = 0;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    if (alpha < 0.55) {
      continue;
    }

    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const lightness = (max + min) / 510;

    fallbackRed += red * alpha;
    fallbackGreen += green * alpha;
    fallbackBlue += blue * alpha;
    fallbackWeightTotal += alpha;

    if (saturation < 0.12 || lightness < 0.12 || lightness > 0.9) {
      continue;
    }

    const midToneWeight = 1 - Math.min(0.82, Math.abs(lightness - 0.55) * 1.4);
    const weight = alpha * (0.35 + saturation * 1.9) * midToneWeight;
    weightedRed += red * weight;
    weightedGreen += green * weight;
    weightedBlue += blue * weight;
    weightTotal += weight;
  }

  const total = weightTotal > 0 ? weightTotal : fallbackWeightTotal;
  if (total <= 0) {
    return null;
  }

  const red = Math.round((weightTotal > 0 ? weightedRed : fallbackRed) / total);
  const green = Math.round((weightTotal > 0 ? weightedGreen : fallbackGreen) / total);
  const blue = Math.round((weightTotal > 0 ? weightedBlue : fallbackBlue) / total);

  return {
    rgb: `${red} ${green} ${blue}`,
  };
};

const NowPlayingMarqueeText = ({
  as,
  className,
  text,
}: {
  as: 'h2' | 'p';
  className?: string;
  text: string;
}): JSX.Element => {
  const textRef = useRef<HTMLElement | null>(null);
  const innerRef = useRef<HTMLSpanElement | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const element = textRef.current;
    const innerElement = innerRef.current;
    if (!element || !innerElement) {
      setIsOverflowing(false);
      return undefined;
    }

    let frameId: number | null = null;
    const updateOverflow = (): void => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const distance = Math.max(0, innerElement.scrollWidth - element.clientWidth);
        element.style.setProperty('--now-playing-marquee-distance', `${distance + 22}px`);
        element.style.setProperty('--now-playing-marquee-duration', `${Math.min(24, Math.max(9, distance / 18 + 7))}s`);
        setIsOverflowing(distance > nowPlayingMarqueeOverflowPx);
      });
    };

    updateOverflow();

    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(updateOverflow) : null;
    resizeObserver?.observe(element);
    resizeObserver?.observe(innerElement);
    window.addEventListener('resize', updateOverflow);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateOverflow);
    };
  }, [text]);

  const setTextRef = (node: HTMLHeadingElement | HTMLParagraphElement | null): void => {
    textRef.current = node;
  };
  const props = {
    className: `now-playing-marquee ${className ?? ''}`,
    'data-overflow': isOverflowing ? 'true' : undefined,
    title: text,
  };
  const content = <span ref={innerRef}>{text}</span>;

  return as === 'h2' ? (
    <h2 {...props} ref={setTextRef}>
      {content}
    </h2>
  ) : (
    <p {...props} ref={setTextRef}>
      {content}
    </p>
  );
};

export const NowPlayingPage = (): JSX.Element => {
  const { t } = useI18n();
  const queue = usePlaybackQueue();
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus | null>(null);
  const [audioStatus, setAudioStatus] = useState<AudioStatus | null>(null);
  const [lowLoadPlaybackModeEnabled, setLowLoadPlaybackModeEnabled] = useState(false);
  const [nowPlayingCoverColorEnabled, setNowPlayingCoverColorEnabled] = useState(false);
  const [coverPalette, setCoverPalette] = useState<NowPlayingCoverPalette | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = audioStatus?.state ?? playbackStatus?.state ?? 'idle';
  const pollIntervalMs = lowLoadPlaybackModeEnabled || idlePollingStates.has(state) ? 1800 : 500;
  const statusTrackId = playbackStatus?.currentTrackId ?? audioStatus?.currentTrackId ?? null;
  const currentTrack =
    queue.currentTrack ??
    (statusTrackId ? queue.tracks.find((track) => track.id === statusTrackId) ?? null : null) ??
    (queue.lastPlayedTrack?.id === statusTrackId ? queue.lastPlayedTrack : null);
  const filePath = currentTrack?.path ?? audioStatus?.currentFilePath ?? playbackStatus?.filePath ?? null;
  const title = currentTrack?.title ?? titleFromPath(filePath);
  const artist = currentTrack?.artist || currentTrack?.albumArtist || (filePath ? t('nowPlaying.localFile') : t('nowPlaying.ready'));
  const coverUrl = currentTrack?.coverThumb ?? null;
  const shouldUseCoverColor = nowPlayingCoverColorEnabled && !lowLoadPlaybackModeEnabled;
  const coverColorStyle = useMemo(
    () =>
      shouldUseCoverColor && coverPalette
        ? ({
            '--now-playing-cover-rgb': coverPalette.rgb,
          } as CSSProperties)
        : undefined,
    [coverPalette, shouldUseCoverColor],
  );

  const refreshStatus = useCallback(async (): Promise<void> => {
    const echo = window.echo;

    if (!echo) {
      setError('Desktop bridge unavailable');
      return;
    }

    try {
      const [nextPlaybackStatus, nextAudioStatus] = await Promise.all([
        echo.playback.getStatus(),
        echo.audio.getStatus(),
      ]);

      setPlaybackStatus(nextPlaybackStatus);
      setAudioStatus(nextAudioStatus);
      const nextTrackId = nextPlaybackStatus.currentTrackId ?? nextAudioStatus.currentTrackId ?? null;
      if (nextTrackId) {
        queue.setCurrentTrackId(nextTrackId);
      }
      setError(nextAudioStatus.error);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : String(statusError));
    }
  }, [queue]);

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, pollIntervalMs);

    return () => window.clearInterval(timer);
  }, [pollIntervalMs, refreshStatus]);

  useEffect(() => {
    let cancelled = false;
    const applyInitialSettings = (settings: Partial<AppSettings> | null | undefined): void => {
      if (!cancelled) {
        setLowLoadPlaybackModeEnabled(readLowLoadPlaybackModeEnabled(settings));
        setNowPlayingCoverColorEnabled(readNowPlayingCoverColorEnabled(settings));
      }
    };

    void window.echo?.app?.getSettings?.().then(applyInitialSettings).catch(() => undefined);

    const handleSettingsChanged = (event: Event): void => {
      const patch = (event as CustomEvent<Partial<AppSettings> | null | undefined>).detail;
      if (!patch) {
        return;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'lowLoadPlaybackModeEnabled')) {
        setLowLoadPlaybackModeEnabled(readLowLoadPlaybackModeEnabled(patch));
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'nowPlayingCoverColorEnabled')) {
        setNowPlayingCoverColorEnabled(readNowPlayingCoverColorEnabled(patch));
      }
    };

    window.addEventListener('settings:changed', handleSettingsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('settings:changed', handleSettingsChanged);
    };
  }, []);

  useEffect(() => {
    if (!shouldUseCoverColor || !coverUrl) {
      setCoverPalette(null);
      return undefined;
    }

    if (coverPaletteCache.has(coverUrl)) {
      setCoverPalette(coverPaletteCache.get(coverUrl) ?? null);
      return undefined;
    }

    let disposed = false;
    let image: HTMLImageElement | null = null;

    const cancelIdle = scheduleCoverColorRead(() => {
      image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        if (disposed || !image) {
          return;
        }

        let palette: NowPlayingCoverPalette | null = null;
        try {
          palette = extractCoverPalette(image);
        } catch {
          palette = null;
        }

        cacheCoverPalette(coverUrl, palette);
        if (!disposed) {
          setCoverPalette(palette);
        }
      };
      image.onerror = () => {
        cacheCoverPalette(coverUrl, null);
        if (!disposed) {
          setCoverPalette(null);
        }
      };
      image.src = coverUrl;
    });

    return () => {
      disposed = true;
      cancelIdle();
      if (image) {
        image.onload = null;
        image.onerror = null;
      }
    };
  }, [coverUrl, shouldUseCoverColor]);

  return (
    <div className="page-stack now-playing-page" data-cover-color={coverColorStyle ? 'true' : undefined} style={coverColorStyle}>
      <section className="page-header">
        <div>
          <p className="section-kicker">{t('nowPlaying.kicker')}</p>
          <h1>{t('nowPlaying.title')}</h1>
          <p>{t('nowPlaying.description')}</p>
        </div>
        <button className="primary-action" type="button" onClick={() => window.dispatchEvent(new Event('app:navigate:lyrics'))}>
          <Mic2 size={17} />
          {t('nowPlaying.action.openLyrics')}
        </button>
      </section>

      <section className="now-playing-card">
        <div className="now-playing-cover" data-empty={!coverUrl}>
          {coverUrl ? <img alt="" src={coverUrl} /> : <Disc3 size={34} />}
        </div>
        <div className="now-playing-copy">
          <span>{currentTrack || filePath ? t('nowPlaying.state.playing') : t('nowPlaying.state.idle')}</span>
          <NowPlayingMarqueeText as="h2" text={currentTrack || filePath ? title : t('nowPlaying.emptyTitle')} />
          <NowPlayingMarqueeText as="p" text={artist} />
          <PlayerStatusChips status={audioStatus} state={state} track={currentTrack} />
          {error ? <strong className="now-playing-error">{error}</strong> : null}
        </div>
      </section>

      {!currentTrack && !filePath ? (
        <section className="empty-inline">
          <Music2 size={28} />
          <span>{t('nowPlaying.emptyDescription')}</span>
        </section>
      ) : null}
    </div>
  );
};
