import { useMemo, useState } from 'react';
import type { CSSProperties, ChangeEvent, KeyboardEvent, PointerEvent } from 'react';
import { formatTime } from './playerFormat';

type PlayerProgressProps = {
  disabled: boolean;
  durationSeconds: number;
  isLoading?: boolean;
  positionSeconds: number;
  waveformEnabled?: boolean;
  waveformSeed?: string | null;
  onCommit: (positionSeconds: number) => void;
};

const waveformBarCount = 96;

const hashWaveformSeed = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createWaveformBars = (seed: string): number[] => {
  let state = hashWaveformSeed(seed || 'echo-next');
  return Array.from({ length: waveformBarCount }, (_, index) => {
    state = Math.imul(state ^ (state >>> 15), 2246822519) >>> 0;
    state = Math.imul(state ^ (state >>> 13), 3266489917) >>> 0;
    const random = ((state ^= state >>> 16) >>> 0) / 4294967295;
    const phrase = Math.sin(index * 0.23 + (state % 17)) * 0.18;
    const swell = Math.sin((index / Math.max(1, waveformBarCount - 1)) * Math.PI) * 0.28;
    return Math.max(0.18, Math.min(1, 0.28 + random * 0.52 + phrase + swell));
  });
};

export const PlayerProgress = ({
  disabled,
  durationSeconds,
  isLoading = false,
  positionSeconds,
  waveformEnabled = false,
  waveformSeed,
  onCommit,
}: PlayerProgressProps): JSX.Element => {
  const [dragPositionSeconds, setDragPositionSeconds] = useState<number | null>(null);
  const displayedPositionSeconds = dragPositionSeconds ?? positionSeconds;
  const boundedPositionSeconds =
    durationSeconds > 0 ? Math.min(durationSeconds, Math.max(0, displayedPositionSeconds)) : 0;
  const progressPercent =
    durationSeconds > 0 ? Math.min(100, Math.max(0, (boundedPositionSeconds / durationSeconds) * 100)) : 0;
  const progressStyle = {
    '--progress-percent': `${progressPercent}%`,
  } as CSSProperties;
  const waveformBars = useMemo(
    () => (waveformEnabled ? createWaveformBars(`${waveformSeed ?? 'idle'}:${Math.round(durationSeconds)}`) : []),
    [durationSeconds, waveformEnabled, waveformSeed],
  );

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setDragPositionSeconds(Number(event.currentTarget.value));
  };

  const handlePointerCommit = (event: PointerEvent<HTMLInputElement>): void => {
    setDragPositionSeconds(null);
    onCommit(Number(event.currentTarget.value));
  };

  const handlePointerCancel = (): void => {
    setDragPositionSeconds(null);
  };

  const handleKeyCommit = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' || event.key === ' ' || event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
      setDragPositionSeconds(null);
      onCommit(Number(event.currentTarget.value));
    }
  };

  return (
    <div className="progress-row" aria-label="Playback position">
      <span>{isLoading ? '加载中' : formatTime(boundedPositionSeconds)}</span>
      <div
        className="progress-track"
        data-loading={isLoading ? 'true' : undefined}
        data-waveform={waveformEnabled && !isLoading ? 'true' : undefined}
        style={progressStyle}
      >
        {waveformEnabled && !isLoading ? (
          <div className="progress-waveform" aria-hidden="true">
            {waveformBars.map((height, index) => (
              <i
                data-played={((index + 0.5) / waveformBarCount) * 100 <= progressPercent ? 'true' : undefined}
                key={index}
                style={{
                  '--waveform-bar-index': index,
                  '--waveform-bar-height': `${Math.round(height * 100)}%`,
                } as CSSProperties}
              />
            ))}
          </div>
        ) : null}
        <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
        <div className="progress-thumb" style={{ left: `${progressPercent}%` }} />
        <input
          aria-label="Seek position"
          className="progress-slider"
          disabled={disabled || isLoading || durationSeconds <= 0}
          max={Math.max(0, durationSeconds)}
          min={0}
          onChange={handleChange}
          onKeyUp={handleKeyCommit}
          onPointerCancel={handlePointerCancel}
          onPointerUp={handlePointerCommit}
          step={0.1}
          type="range"
          value={boundedPositionSeconds}
        />
      </div>
      <span>{formatTime(durationSeconds)}</span>
    </div>
  );
};
