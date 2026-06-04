import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { AudioLevelTelemetry } from '../../../shared/types/audio';
import type { EqBand, EqFilterType } from '../../../shared/types/eq';
import { eqFrequenciesHz, eqMaxFrequencyHz, eqMaxGainDb, eqMinFrequencyHz, eqMinGainDb } from '../../../shared/types/eq';
import { useI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';
import {
  clamp,
  computeEqBandGainDbAtFrequency,
  computeEqBandNodePoint,
  computeEqResponseGainDbAtFrequency,
  computeEqSpectrumBars,
  type EqAnalyzerMode,
  formatDb,
  formatFrequencyLabel,
  isEqFilterGainEditable,
  resolveBandFrequency,
} from './eqPanelUtils';

type EqCurveViewProps = {
  bands: EqBand[];
  enabled: boolean;
  frequencyUnlocked: boolean;
  selectedBandIndex: number;
  spectrumEnabled?: boolean;
  analyzerMode?: EqAnalyzerMode;
  visualSpectrum?: number[];
  visualTelemetryState?: AudioLevelTelemetry['visualTelemetryState'];
  onBandSelect: (index: number) => void;
  onBandChange: (index: number, gainDb: number) => void;
  onBandCommit: (index: number, gainDb: number) => void;
  onBandFrequencyChange: (index: number, frequencyHz: number) => void;
  onBandFrequencyCommit: (index: number, frequencyHz: number) => void;
};

type DragPoint = {
  rawFrequencyHz: number;
  frequencyHz: number;
  gainDb: number;
};

type HoverReadout = {
  x: number;
  y: number;
  frequencyHz: number;
  totalGainDb: number;
  bandGainDb: number;
};

type DisplayBandEntry = {
  band: EqBand;
  index: number;
};

const width = 920;
const height = 360;
const paddingLeft = 62;
const paddingRight = 56;
const paddingTop = 30;
const paddingBottom = 42;
const plotWidth = width - paddingLeft - paddingRight;
const plotHeight = height - paddingTop - paddingBottom;
const responsePointCount = 180;
const defaultAxisLimitDb = 12;
const axisLimitStepsDb = [12, 18, 24, 36];
const axisFrequenciesHz = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
const eqFilterLabelKeys: Record<EqFilterType, TranslationKey> = {
  peaking: 'settings.eq.filter.peaking',
  lowShelf: 'settings.eq.filter.lowShelf',
  highShelf: 'settings.eq.filter.highShelf',
  lowPass: 'settings.eq.filter.lowPass',
  highPass: 'settings.eq.filter.highPass',
  notch: 'settings.eq.filter.notch',
};

const filterNodeKinds: Record<EqFilterType, 'peak' | 'shelf' | 'pass' | 'notch'> = {
  peaking: 'peak',
  lowShelf: 'shelf',
  highShelf: 'shelf',
  lowPass: 'pass',
  highPass: 'pass',
  notch: 'notch',
};

const filterNodeGlyphs: Record<EqFilterType, string> = {
  peaking: 'P',
  lowShelf: 'S',
  highShelf: 'S',
  lowPass: 'F',
  highPass: 'F',
  notch: 'N',
};

const bandToSvgPoint = (band: EqBand, axisLimitDb = defaultAxisLimitDb): { x: number; y: number } => {
  const basePoint = computeEqBandNodePoint(band);
  const gainDb = band.enabled === false || !isEqFilterGainEditable(band.filterType) ? 0 : band.gainDb;
  return {
    x: paddingLeft + basePoint.x * plotWidth,
    y: gainToY(gainDb, axisLimitDb),
  };
};

const resolveAxisLimitDb = (maxAbsGainDb: number): number => {
  const steppedLimitDb = axisLimitStepsDb.find((limitDb) => maxAbsGainDb <= limitDb - 0.5);
  if (steppedLimitDb) {
    return steppedLimitDb;
  }

  return Math.min(72, Math.ceil((maxAbsGainDb + 1) / 12) * 12);
};

const buildAxisGains = (axisLimitDb: number): number[] => {
  const stepDb = axisLimitDb <= 12 ? 3 : axisLimitDb <= 24 ? 6 : 12;
  const values: number[] = [];

  for (let gainDb = axisLimitDb; gainDb >= -axisLimitDb; gainDb -= stepDb) {
    values.push(gainDb);
  }

  if (!values.includes(0)) {
    values.push(0);
    values.sort((left, right) => right - left);
  }

  return values;
};

const frequencyAtNormalizedX = (normalized: number): number => {
  const minLog = Math.log10(eqMinFrequencyHz);
  const maxLog = Math.log10(eqMaxFrequencyHz);
  return 10 ** (minLog + clamp(normalized, 0, 1) * (maxLog - minLog));
};

const frequencyToSvgX = (frequencyHz: number): number => {
  const minLog = Math.log10(eqMinFrequencyHz);
  const maxLog = Math.log10(eqMaxFrequencyHz);
  const normalized = (Math.log10(clamp(frequencyHz, eqMinFrequencyHz, eqMaxFrequencyHz)) - minLog) / (maxLog - minLog);
  return paddingLeft + normalized * plotWidth;
};

const gainToY = (gainDb: number, axisLimitDb = defaultAxisLimitDb): number => {
  const minGainDb = -axisLimitDb;
  const maxGainDb = axisLimitDb;
  const normalized = (clamp(gainDb, minGainDb, maxGainDb) - minGainDb) / (maxGainDb - minGainDb);
  return paddingTop + (1 - normalized) * plotHeight;
};

const yToGain = (y: number, axisLimitDb = defaultAxisLimitDb): number => {
  const normalized = 1 - clamp((y - paddingTop) / plotHeight, 0, 1);
  const minGainDb = -axisLimitDb;
  const maxGainDb = axisLimitDb;
  return Math.round(clamp(minGainDb + normalized * (maxGainDb - minGainDb), eqMinGainDb, eqMaxGainDb) * 10) / 10;
};

const xToFrequency = (x: number): number => {
  const minLog = Math.log10(eqMinFrequencyHz);
  const maxLog = Math.log10(eqMaxFrequencyHz);
  const normalized = clamp((x - paddingLeft) / plotWidth, 0, 1);
  const frequencyHz = 10 ** (minLog + normalized * (maxLog - minLog));

  return frequencyHz < 1000 ? Math.round(frequencyHz) : Math.round(frequencyHz / 10) * 10;
};

const isStandardFrequencySlot = (band: EqBand, index: number): boolean => {
  const standardFrequency = eqFrequenciesHz[index];
  if (!standardFrequency) {
    return false;
  }

  return Math.abs(Math.log2(band.frequencyHz / standardFrequency)) < 0.025;
};

const isAudibleCurveBand = (band: EqBand): boolean => {
  if (band.enabled === false) {
    return false;
  }

  const filterType = band.filterType ?? 'peaking';
  return !isEqFilterGainEditable(filterType) || Math.abs(band.gainDb) > 0.05;
};

const buildXAxisLabelEntries = (
  entries: DisplayBandEntry[],
  axisLimitDb: number,
  selectedBandIndex: number,
  activeBand: number | null,
  hoverBand: number | null,
): Array<DisplayBandEntry & { x: number; y: number }> => {
  const candidates = entries.map((entry) => ({
    ...entry,
    ...bandToSvgPoint(entry.band, axisLimitDb),
  }));
  const prioritized = [...candidates].sort((left, right) => {
    const leftSelected = left.index === selectedBandIndex || left.index === activeBand || left.index === hoverBand;
    const rightSelected = right.index === selectedBandIndex || right.index === activeBand || right.index === hoverBand;
    if (leftSelected !== rightSelected) {
      return leftSelected ? -1 : 1;
    }

    const leftGain = isEqFilterGainEditable(left.band.filterType) ? Math.abs(left.band.gainDb) : defaultAxisLimitDb;
    const rightGain = isEqFilterGainEditable(right.band.filterType) ? Math.abs(right.band.gainDb) : defaultAxisLimitDb;
    return rightGain - leftGain || left.x - right.x;
  });
  const kept: Array<DisplayBandEntry & { x: number; y: number }> = [];
  const minimumDistance = 42;

  for (const candidate of prioritized) {
    if (kept.every((entry) => Math.abs(entry.x - candidate.x) >= minimumDistance)) {
      kept.push(candidate);
    }
  }

  return kept.sort((left, right) => left.x - right.x);
};

const clientPointToSvgPoint = (
  svg: SVGSVGElement | null,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null => {
  if (!svg) {
    return null;
  }

  const screenMatrix = svg.getScreenCTM?.();

  if (!screenMatrix) {
    return null;
  }

  const inverseMatrix = screenMatrix.inverse();
  const svgPoint = svg.createSVGPoint?.();

  if (svgPoint) {
    svgPoint.x = clientX;
    svgPoint.y = clientY;
    const transformedPoint = svgPoint.matrixTransform(inverseMatrix);
    return { x: transformedPoint.x, y: transformedPoint.y };
  }

  if (typeof DOMPoint === 'function') {
    const transformedPoint = new DOMPoint(clientX, clientY).matrixTransform(inverseMatrix);
    return { x: transformedPoint.x, y: transformedPoint.y };
  }

  return null;
};

const makeSmoothPath = (points: Array<{ x: number; y: number }>): string => {
  if (points.length === 0) {
    return '';
  }

  if (points.length === 1) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  }

  const commands = [`M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`];

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const previous = points[index - 1] ?? current;
    const afterNext = points[index + 2] ?? next;
    const cp1x = current.x + (next.x - previous.x) / 6;
    const cp1y = current.y + (next.y - previous.y) / 6;
    const cp2x = next.x - (afterNext.x - current.x) / 6;
    const cp2y = next.y - (afterNext.y - current.y) / 6;
    commands.push(`C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`);
  }

  return commands.join(' ');
};

export const EqCurveView = ({
  bands,
  enabled,
  frequencyUnlocked,
  selectedBandIndex,
  spectrumEnabled = false,
  analyzerMode = 'input',
  visualSpectrum,
  visualTelemetryState,
  onBandSelect,
  onBandChange,
  onBandCommit,
  onBandFrequencyChange,
  onBandFrequencyCommit,
}: EqCurveViewProps): JSX.Element => {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [activeBand, setActiveBand] = useState<number | null>(null);
  const [hoverBand, setHoverBand] = useState<number | null>(null);
  const [hoverReadout, setHoverReadout] = useState<HoverReadout | null>(null);
  const [fineEdit, setFineEdit] = useState(false);
  const [dragPreview, setDragPreview] = useState<{ index: number; band: EqBand } | null>(null);
  const displayBands = useMemo(
    () => (dragPreview ? bands.map((band, index) => (index === dragPreview.index ? dragPreview.band : band)) : bands),
    [bands, dragPreview],
  );
  const displayBandEntries = useMemo<DisplayBandEntry[]>(
    () => displayBands.map((band, index) => ({ band, index })),
    [displayBands],
  );
  const hasParametricLayout = useMemo(
    () => displayBandEntries.some(({ band, index }) => band.enabled !== false && !isStandardFrequencySlot(band, index)),
    [displayBandEntries],
  );
  const responsePoints = useMemo(
    () => Array.from({ length: responsePointCount }, (_unused, index) => {
      const normalized = index / (responsePointCount - 1);
      return {
        x: normalized,
        gainDb: computeEqResponseGainDbAtFrequency(displayBands, frequencyAtNormalizedX(normalized)),
      };
    }),
    [displayBands],
  );
  const axisLimitDb = useMemo(() => {
    const responseMaxAbsGainDb = responsePoints.reduce((maxGainDb, point) => Math.max(maxGainDb, Math.abs(point.gainDb)), defaultAxisLimitDb);
    const bandMaxAbsGainDb = displayBands.reduce((maxGainDb, band) => (
      band.enabled === false || !isEqFilterGainEditable(band.filterType) ? maxGainDb : Math.max(maxGainDb, Math.abs(band.gainDb))
    ), defaultAxisLimitDb);
    return resolveAxisLimitDb(Math.max(responseMaxAbsGainDb, bandMaxAbsGainDb));
  }, [displayBands, responsePoints]);
  const axisGains = useMemo(() => buildAxisGains(axisLimitDb), [axisLimitDb]);
  const points = useMemo(
    () => responsePoints.map((point) => ({
      x: paddingLeft + point.x * plotWidth,
      y: gainToY(point.gainDb, axisLimitDb),
    })),
    [axisLimitDb, responsePoints],
  );
  const path = makeSmoothPath(points);
  const zeroY = gainToY(0, axisLimitDb);
  const fillPath = path ? `${path} L ${paddingLeft + plotWidth} ${zeroY.toFixed(1)} L ${paddingLeft} ${zeroY.toFixed(1)} Z` : '';
  const readoutBandIndex = activeBand ?? hoverBand ?? selectedBandIndex;
  const selectedBand = displayBands[readoutBandIndex];
  const selectedPoint = selectedBand ? bandToSvgPoint(selectedBand, axisLimitDb) : null;
  const curveNodeEntries = useMemo(
    () => (hasParametricLayout
      ? displayBandEntries.filter(({ band, index }) => (
        isAudibleCurveBand(band) || index === selectedBandIndex || index === activeBand || index === hoverBand
      ))
      : displayBandEntries),
    [activeBand, displayBandEntries, hasParametricLayout, hoverBand, selectedBandIndex],
  );
  const xAxisLabelEntries = useMemo(
    () => buildXAxisLabelEntries(
      hasParametricLayout ? curveNodeEntries : displayBandEntries,
      axisLimitDb,
      selectedBandIndex,
      activeBand,
      hoverBand,
    ),
    [activeBand, axisLimitDb, curveNodeEntries, displayBandEntries, hasParametricLayout, hoverBand, selectedBandIndex],
  );
  const selectedBandPath = useMemo(
    () => {
      if (!selectedBand) {
        return '';
      }

      return makeSmoothPath(Array.from({ length: responsePointCount }, (_unused, index) => {
        const normalized = index / (responsePointCount - 1);
        return {
          x: paddingLeft + normalized * plotWidth,
          y: gainToY(computeEqResponseGainDbAtFrequency([selectedBand], frequencyAtNormalizedX(normalized)), axisLimitDb),
        };
      }));
    },
    [axisLimitDb, selectedBand],
  );
  const spectrumBars = useMemo(
    () => (spectrumEnabled ? computeEqSpectrumBars(visualSpectrum, displayBands, analyzerMode) : []),
    [analyzerMode, displayBands, spectrumEnabled, visualSpectrum],
  );
  const hasLiveSpectrum = spectrumBars.length > 0 && visualTelemetryState !== 'fallback';
  const selectedBandGainEditable = selectedBand ? isEqFilterGainEditable(selectedBand.filterType) : true;
  const selectedBandType = selectedBand?.filterType ?? 'peaking';
  const readoutModeLabel = fineEdit
    ? t('settings.eq.curve.fineEdit')
    : frequencyUnlocked
      ? t('settings.eq.curve.freeFrequency')
      : null;

  const quantizeGain = (gainDb: number, fine: boolean): number => {
    const step = fine ? 0.1 : 0.5;
    return Math.round(gainDb / step) * step;
  };

  const pointFromEvent = (event: ReactPointerEvent<SVGElement>): DragPoint => {
    const svgPoint = clientPointToSvgPoint(svgRef.current, event.clientX, event.clientY);
    const rect = svgRef.current?.getBoundingClientRect();
    const x = svgPoint?.x ?? (rect && rect.width > 0 ? (event.clientX - rect.left) * (width / rect.width) : paddingLeft);
    const y = svgPoint?.y ?? (rect && rect.height > 0 ? (event.clientY - rect.top) * (height / rect.height) : zeroY);
    const rawFrequencyHz = xToFrequency(x);
    setFineEdit(event.shiftKey);
    return {
      rawFrequencyHz,
      frequencyHz: resolveBandFrequency(rawFrequencyHz, frequencyUnlocked),
      gainDb: quantizeGain(yToGain(y, axisLimitDb), event.shiftKey),
    };
  };

  const updateHoverReadout = (event: ReactPointerEvent<SVGElement>): void => {
    const svgPoint = clientPointToSvgPoint(svgRef.current, event.clientX, event.clientY);
    const rect = svgRef.current?.getBoundingClientRect();
    const x = svgPoint?.x ?? (rect && rect.width > 0 ? (event.clientX - rect.left) * (width / rect.width) : paddingLeft);
    const y = svgPoint?.y ?? (rect && rect.height > 0 ? (event.clientY - rect.top) * (height / rect.height) : zeroY);
    const frequencyHz = xToFrequency(x);

    setHoverReadout({
      x: clamp(x, paddingLeft, paddingLeft + plotWidth),
      y: clamp(y, paddingTop, paddingTop + plotHeight),
      frequencyHz,
      totalGainDb: computeEqResponseGainDbAtFrequency(displayBands, frequencyHz),
      bandGainDb: computeEqBandGainDbAtFrequency(selectedBand, frequencyHz),
    });
  };

  const updateBandFromEvent = (event: ReactPointerEvent<SVGElement>, index: number): DragPoint => {
    const point = pointFromEvent(event);
    const previewFrequencyHz = frequencyUnlocked ? point.frequencyHz : point.rawFrequencyHz;
    const band = bands[index] ?? { frequencyHz: point.frequencyHz, gainDb: 0, q: 1, filterType: 'peaking' as const, enabled: true };
    const gainEditable = isEqFilterGainEditable(band.filterType);
    setDragPreview({
      index,
      band: {
        ...band,
        frequencyHz: previewFrequencyHz,
        gainDb: gainEditable ? point.gainDb : 0,
      },
    });
    if (gainEditable) {
      onBandChange(index, point.gainDb);
    }
    if (frequencyUnlocked && point.frequencyHz !== bands[index]?.frequencyHz) {
      onBandFrequencyChange(index, point.frequencyHz);
    }
    return point;
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGGElement>, index: number): void => {
    event.preventDefault();
    svgRef.current?.setPointerCapture?.(event.pointerId);
    setActiveBand(index);
    onBandSelect(index);
    updateBandFromEvent(event, index);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (activeBand === null) {
      updateHoverReadout(event);
      return;
    }

    updateBandFromEvent(event, activeBand);
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement | SVGGElement>): void => {
    if (activeBand === null) {
      return;
    }

    const point = updateBandFromEvent(event, activeBand);
    if (isEqFilterGainEditable(bands[activeBand]?.filterType)) {
      onBandCommit(activeBand, point.gainDb);
    }
    if (point.frequencyHz !== bands[activeBand]?.frequencyHz) {
      onBandFrequencyCommit(activeBand, point.frequencyHz);
    }
    const svg = svgRef.current;
    if (svg?.hasPointerCapture?.(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }
    setActiveBand(null);
    setDragPreview(null);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<SVGGElement>, index: number): void => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      return;
    }

    event.preventDefault();
    onBandSelect(index);

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (!isEqFilterGainEditable(bands[index].filterType)) {
        return;
      }

      const delta = event.shiftKey ? 0.1 : 0.5;
      const gainDb = Math.round(clamp(bands[index].gainDb + (event.key === 'ArrowUp' ? delta : -delta), eqMinGainDb, eqMaxGainDb) * 10) / 10;
      onBandChange(index, gainDb);
      onBandCommit(index, gainDb);
      return;
    }

    if (!frequencyUnlocked) {
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const currentFrequency = bands[index].frequencyHz;
      const currentIndex = eqFrequenciesHz.reduce((nearestIndex, candidate, candidateIndex) => {
        const currentDistance = Math.abs(Math.log2(currentFrequency / eqFrequenciesHz[nearestIndex]));
        const nextDistance = Math.abs(Math.log2(currentFrequency / candidate));
        return nextDistance < currentDistance ? candidateIndex : nearestIndex;
      }, 0);
      const frequencyHz = eqFrequenciesHz[clamp(currentIndex + direction, 0, eqFrequenciesHz.length - 1)] ?? currentFrequency;
      onBandFrequencyChange(index, frequencyHz);
      onBandFrequencyCommit(index, frequencyHz);
      return;
    }

    const ratio = event.shiftKey ? 2 ** (1 / 3) : 2 ** (1 / 12);
    const frequencyHz = Math.round(clamp(
      event.key === 'ArrowRight' ? bands[index].frequencyHz * ratio : bands[index].frequencyHz / ratio,
      eqMinFrequencyHz,
      eqMaxFrequencyHz,
    ));
    onBandFrequencyChange(index, frequencyHz);
    onBandFrequencyCommit(index, frequencyHz);
  };

  return (
    <div className="eq-curve-shell" data-enabled={enabled}>
      <svg
        className="eq-curve-view"
        data-parametric={hasParametricLayout}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t('settings.eq.curve.aria')}
        ref={svgRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => setHoverReadout(null)}
      >
        <defs>
          <linearGradient id="eqCurveStroke" x1="0%" x2="100%" y1="0%" y2="0%">
            <stop offset="0%" stopColor="#264a63" />
            <stop offset="50%" stopColor="#2e7168" />
            <stop offset="100%" stopColor="#8a6235" />
          </linearGradient>
          <linearGradient id="eqCurveFill" x1="0%" x2="0%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(46, 113, 104, 0.18)" />
            <stop offset="100%" stopColor="rgba(46, 113, 104, 0.03)" />
          </linearGradient>
        </defs>

        {axisGains.map((gainDb) => {
          const y = gainToY(gainDb, axisLimitDb);
          return (
            <g key={gainDb}>
              <line className="eq-grid-line" data-major={gainDb % 6 === 0} x1={paddingLeft} x2={paddingLeft + plotWidth} y1={y} y2={y} />
              <text className="eq-y-label" x={width - paddingRight + 10} y={y + 4}>
                {`${gainDb > 0 ? '+' : ''}${gainDb} dB`}
              </text>
            </g>
          );
        })}

        {hasParametricLayout ? (
          <g className="eq-frequency-axis" aria-hidden="true">
            {axisFrequenciesHz.map((frequencyHz) => {
              const x = frequencyToSvgX(frequencyHz);
              return (
                <g key={frequencyHz}>
                  <line className="eq-grid-line eq-grid-line--frequency" x1={x} x2={x} y1={paddingTop} y2={paddingTop + plotHeight} />
                  <text className="eq-x-label eq-x-label--axis" x={x} y={height - 14}>
                    {formatFrequencyLabel(frequencyHz)}
                  </text>
                </g>
              );
            })}
          </g>
        ) : null}

        <line className="eq-zero-line" x1={paddingLeft} x2={paddingLeft + plotWidth} y1={zeroY} y2={zeroY} />
        {spectrumEnabled ? (
          <g className="eq-spectrum-overlay" data-state={visualTelemetryState ?? 'fallback'} aria-label={t('settings.eq.analyzer.overlayAria')}>
            {spectrumBars.map((bar, index) => {
              const x = paddingLeft + bar.x * plotWidth;
              const barHeight = Math.max(2, bar.value * plotHeight * 0.58);
              return (
                <line
                  className="eq-spectrum-bar"
                  data-live={hasLiveSpectrum}
                  data-mode={analyzerMode}
                  key={`${index}-${bar.value.toFixed(3)}`}
                  x1={x.toFixed(1)}
                  x2={x.toFixed(1)}
                  y1={(paddingTop + plotHeight).toFixed(1)}
                  y2={(paddingTop + plotHeight - barHeight).toFixed(1)}
                />
              );
            })}
          </g>
        ) : null}
        <path className="eq-curve-fill" d={fillPath} />
        {selectedBandPath ? <path className="eq-curve-selected-band" d={selectedBandPath} /> : null}
        <path className="eq-curve-stroke" d={path} />
        <path className="eq-curve-hit-area" d={path} />

        {curveNodeEntries.map(({ band, index }) => {
          const point = bandToSvgPoint(band, axisLimitDb);
          const selected = selectedBandIndex === index;
          return (
            <g
              className="eq-curve-node-group"
              aria-label={t('settings.eq.curve.dragBand', { frequency: formatFrequencyLabel(band.frequencyHz) })}
              data-active={selected}
              data-bypassed={band.enabled === false}
              data-dragging={activeBand === index}
              data-filter-kind={filterNodeKinds[band.filterType ?? 'peaking']}
              data-testid={`eq-curve-node-${index}`}
              key={`${band.frequencyHz}-${index}`}
              tabIndex={0}
              transform={`translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`}
              onClick={() => onBandSelect(index)}
              onFocus={() => onBandSelect(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              onPointerEnter={() => setHoverBand(index)}
              onPointerLeave={() => setHoverBand((current) => (current === index ? null : current))}
              onPointerDown={(event) => handlePointerDown(event, index)}
            >
              <title>
                {`${t(eqFilterLabelKeys[band.filterType ?? 'peaking'])} / ${formatFrequencyLabel(band.frequencyHz)} / ${isEqFilterGainEditable(band.filterType) ? formatDb(band.gainDb) : t('settings.eq.band.gainFixed')} / Q ${Number(band.q ?? 1).toFixed(1)}`}
              </title>
              <circle className="eq-curve-node-hit" r="16" />
              <circle className="eq-curve-node" r={hasParametricLayout ? (selected ? 7 : 5.8) : (selected ? 9 : 7.5)} />
              <text className="eq-curve-node-type" y={hasParametricLayout ? 3 : -10}>
                {filterNodeGlyphs[band.filterType ?? 'peaking']}
              </text>
              {!hasParametricLayout ? (
                <text className="eq-curve-node-number" y="3.5">
                  {formatFrequencyLabel(band.frequencyHz)}
                </text>
              ) : null}
            </g>
          );
        })}

        {!hasParametricLayout && xAxisLabelEntries.map(({ band, index, x }) => {
          return (
            <text className="eq-x-label" x={x} y={height - 14} key={`${band.frequencyHz}-${index}-label`}>
              {formatFrequencyLabel(band.frequencyHz)}
            </text>
          );
        })}

        {selectedBand && selectedPoint ? (
          <g className="eq-selected-readout" transform={`translate(${selectedPoint.x.toFixed(1)} ${(selectedPoint.y - 22).toFixed(1)})`}>
            <text className="eq-selected-readout-frequency" y="-4">
              {`${formatFrequencyLabel(selectedBand.frequencyHz)} / Q ${Number(selectedBand.q ?? 1).toFixed(1)} / ${t(eqFilterLabelKeys[selectedBandType])}`}
            </text>
            <text className="eq-selected-readout-gain" x="28" y="16">
              {selectedBandGainEditable ? formatDb(selectedBand.gainDb) : t('settings.eq.band.gainFixed')}
            </text>
            {readoutModeLabel ? (
              <text className="eq-selected-readout-mode" x="-28" y="16">
                {readoutModeLabel}
              </text>
            ) : null}
          </g>
        ) : null}
        {hoverReadout ? (
          <g className="eq-hover-readout" transform={`translate(${hoverReadout.x.toFixed(1)} ${Math.max(paddingTop + 22, hoverReadout.y - 30).toFixed(1)})`}>
            <line x1="0" x2="0" y1={(paddingTop - hoverReadout.y).toFixed(1)} y2={(paddingTop + plotHeight - hoverReadout.y).toFixed(1)} />
            <rect x="-64" y="-22" width="128" height="32" rx="7" />
            <text y="-8">
              {`${formatFrequencyLabel(hoverReadout.frequencyHz)} / ${formatDb(hoverReadout.totalGainDb)}`}
            </text>
            <text y="5">
              {`${t(eqFilterLabelKeys[selectedBandType])} ${formatDb(hoverReadout.bandGainDb)}`}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
};
