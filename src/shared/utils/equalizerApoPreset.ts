import {
  eqBandCount,
  eqFilterTypes,
  eqFrequenciesHz,
  eqMaxFrequencyHz,
  eqMaxGainDb,
  eqMaxPreampDb,
  eqMaxQ,
  eqMinFrequencyHz,
  eqMinGainDb,
  eqMinPreampDb,
  eqMinQ,
  type EqBand,
  type EqFilterType,
  type EqSavePresetRequest,
} from '../types/eq';

export type EqualizerApoImportResult = EqSavePresetRequest & {
  source: 'equalizer-apo';
  importedFilterCount: number;
  skippedFilterCount: number;
  graphicEqPointCount: number;
  unsupportedDirectiveCount: number;
  unsupportedDirectiveSummary: Record<string, number>;
  channelScopedFilterCount: number;
  bandwidthFilterCount: number;
  warnings: string[];
};

export type EqualizerApoIncludeContext = {
  sourcePath?: string;
  depth: number;
};

export type EqualizerApoIncludeLoadResult = string | {
  content: string;
  sourcePath?: string;
} | null | undefined;

export type EqualizerApoIncludeExpansionResult = {
  content: string;
  includedFileCount: number;
  skippedIncludeCount: number;
  warnings: string[];
};

const equalizerApoFilterTypeText = (filterType: EqFilterType): string => {
  switch (filterType) {
    case 'lowShelf':
      return 'LS';
    case 'highShelf':
      return 'HS';
    case 'lowPass':
      return 'LP';
    case 'highPass':
      return 'HP';
    case 'notch':
      return 'NO';
    case 'peaking':
    default:
      return 'PK';
  }
};

const formatApoNumber = (value: number, digits = 2): string => {
  if (!Number.isFinite(value)) {
    return '0';
  }

  return Number(value.toFixed(digits)).toString();
};

export const formatEqualizerApoPreset = (preset: EqSavePresetRequest): string => {
  const lines = [
    '# Exported by ECHO Next',
    `Preamp: ${formatApoNumber(clamp(Number(preset.preampDb ?? 0), eqMinPreampDb, eqMaxPreampDb), 2)} dB`,
  ];

  preset.bands.forEach((band, index) => {
    const filterType = band.filterType ?? 'peaking';
    const status = band.enabled === false ? 'OFF' : 'ON';
    const frequencyHz = formatApoNumber(clamp(Number(band.frequencyHz), eqMinFrequencyHz, eqMaxFrequencyHz), 2);
    const q = formatApoNumber(clamp(Number(band.q ?? 1), eqMinQ, eqMaxQ), 3);
    const gainPart = isGainEditableFilter(filterType)
      ? ` Gain ${formatApoNumber(clamp(Number(band.gainDb ?? 0), eqMinGainDb, eqMaxGainDb), 2)} dB`
      : '';

    lines.push(`Filter ${index + 1}: ${status} ${equalizerApoFilterTypeText(filterType)} Fc ${frequencyHz} Hz${gainPart} Q ${q}`);
  });

  return `${lines.join('\n')}\n`;
};

export const formatEqualizerApoGraphicEqPreset = (preset: EqSavePresetRequest): string => {
  const points = preset.bands
    .map((band, index) => {
      const frequencyHz = clamp(Number(band.frequencyHz ?? eqFrequenciesHz[index] ?? 1000), eqMinFrequencyHz, eqMaxFrequencyHz);
      const gainDb = band.enabled === false ? 0 : clamp(Number(band.gainDb ?? 0), eqMinGainDb, eqMaxGainDb);
      return `${formatApoNumber(frequencyHz, 2)} ${formatApoNumber(gainDb, 2)}`;
    })
    .join('; ');

  return [
    '# Exported by ECHO Next',
    `Preamp: ${formatApoNumber(clamp(Number(preset.preampDb ?? 0), eqMinPreampDb, eqMaxPreampDb), 2)} dB`,
    `GraphicEQ: ${points}`,
    '',
  ].join('\n');
};

type GraphicEqPoint = {
  frequencyHz: number;
  gainDb: number;
};

const numberPattern = String.raw`[-+]?\d+(?:[.,]\d+)?`;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const parseNumber = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

const stripComment = (line: string): string => line.replace(/#.*/, '').trim();

const readIncludePath = (line: string): string | null => {
  const match = line.match(/^\s*Include\s*:\s*(.+)$/i);
  if (!match) {
    return null;
  }

  const value = match[1].trim();
  const unquoted = value.match(/^"(.+)"$/)?.[1] ?? value.match(/^'(.+)'$/)?.[1] ?? value;
  return unquoted.trim() || null;
};

const readDirectiveName = (line: string): string | null => {
  const match = line.match(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:/);
  return match?.[1]?.toLowerCase() ?? null;
};

const unsupportedApoDirectives = new Set([
  'channel',
  'copy',
  'device',
  'delay',
  'convolution',
  'vstplugin',
  'voicemeeter',
  'stage',
]);

const normalizeDirectiveLabel = (directiveName: string): string =>
  directiveName.slice(0, 1).toUpperCase() + directiveName.slice(1).toLowerCase();

const isGlobalChannelSelection = (body: string): boolean => {
  const normalized = body
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ');
  if (!normalized || normalized === 'ALL' || normalized === '*' || normalized === 'ANY') {
    return true;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const tokenSet = new Set(tokens);
  return tokenSet.has('L') && tokenSet.has('R') && tokens.every((token) => token === 'L' || token === 'R');
};

export const expandEqualizerApoIncludes = (
  content: string,
  loadInclude: (includePath: string, context: EqualizerApoIncludeContext) => EqualizerApoIncludeLoadResult,
  options: { sourcePath?: string; maxDepth?: number } = {},
): EqualizerApoIncludeExpansionResult => {
  const maxDepth = Math.max(0, Math.floor(options.maxDepth ?? 8));
  const warnings: string[] = [];
  let includedFileCount = 0;
  let skippedIncludeCount = 0;

  const expand = (input: string, sourcePath: string | undefined, depth: number, stack: string[]): string => {
    const outputLines: string[] = [];

    for (const rawLine of input.replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const includePath = readIncludePath(stripComment(rawLine));
      if (!includePath) {
        outputLines.push(rawLine);
        continue;
      }

      if (depth >= maxDepth) {
        skippedIncludeCount += 1;
        warnings.push(`Skipped Equalizer APO Include "${includePath}" because maximum include depth ${maxDepth} was reached.`);
        continue;
      }

      let loaded: EqualizerApoIncludeLoadResult;
      try {
        loaded = loadInclude(includePath, { sourcePath, depth: depth + 1 });
      } catch (error) {
        skippedIncludeCount += 1;
        warnings.push(`Skipped Equalizer APO Include "${includePath}": ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      if (!loaded) {
        skippedIncludeCount += 1;
        warnings.push(`Skipped Equalizer APO Include "${includePath}" because the file could not be read.`);
        continue;
      }

      const loadedContent = typeof loaded === 'string' ? loaded : loaded.content;
      const loadedSourcePath = typeof loaded === 'string' ? includePath : loaded.sourcePath ?? includePath;
      if (stack.includes(loadedSourcePath)) {
        skippedIncludeCount += 1;
        warnings.push(`Skipped circular Equalizer APO Include "${includePath}".`);
        continue;
      }

      includedFileCount += 1;
      outputLines.push(`# Begin Include: ${includePath}`);
      outputLines.push(expand(loadedContent, loadedSourcePath, depth + 1, [...stack, loadedSourcePath]));
      outputLines.push(`# End Include: ${includePath}`);
    }

    return outputLines.join('\n');
  };

  return {
    content: expand(content, options.sourcePath, 0, options.sourcePath ? [options.sourcePath] : []),
    includedFileCount,
    skippedIncludeCount,
    warnings,
  };
};

const readLabeledNumber = (text: string, label: string): number | null => {
  const match = text.match(new RegExp(String.raw`\b${label}\s*(${numberPattern})`, 'i'));
  return parseNumber(match?.[1]);
};

const readBandwidthNumber = (text: string): number | null => {
  const directBandwidth = readLabeledNumber(text, 'BW') ?? readLabeledNumber(text, 'Bandwidth');
  if (directBandwidth !== null) {
    return directBandwidth;
  }

  const labelFirstMatch = text.match(new RegExp(String.raw`\b(?:BW|Bandwidth)\s+Oct(?:aves?)?\s+(${numberPattern})`, 'i'));
  if (labelFirstMatch) {
    return parseNumber(labelFirstMatch[1]);
  }

  const valueFirstMatch = text.match(new RegExp(String.raw`\b(?:BW|Bandwidth)\s+(${numberPattern})\s+Oct(?:aves?)?`, 'i'));
  return parseNumber(valueFirstMatch?.[1]);
};

const bandwidthOctavesToQ = (bandwidthOctaves: number): number => {
  const power = 2 ** bandwidthOctaves;
  const denominator = power - 1;
  if (!Number.isFinite(power) || denominator <= 0) {
    return 1;
  }

  return Math.sqrt(power) / denominator;
};

const isGainEditableFilter = (filterType: EqFilterType): boolean =>
  filterType === 'peaking' || filterType === 'lowShelf' || filterType === 'highShelf';

const defaultBand = (index: number): EqBand => ({
  frequencyHz: eqFrequenciesHz[index] ?? eqFrequenciesHz[eqFrequenciesHz.length - 1],
  gainDb: 0,
  q: 1,
  filterType: 'peaking',
  enabled: true,
});

const normalizeFilterType = (value: string): EqFilterType | null => {
  const normalized = value.trim().toUpperCase();

  if (normalized.startsWith('PK') || normalized === 'PEAKING') {
    return 'peaking';
  }
  if (normalized.startsWith('LS')) {
    return 'lowShelf';
  }
  if (normalized.startsWith('HS')) {
    return 'highShelf';
  }
  if (normalized.startsWith('LP')) {
    return 'lowPass';
  }
  if (normalized.startsWith('HP')) {
    return 'highPass';
  }
  if (normalized.startsWith('NO') || normalized === 'NOTCH') {
    return 'notch';
  }

  return null;
};

const parseFilterLine = (line: string): { band: EqBand; usedBandwidth: boolean } | null => {
  const match = line.match(/^\s*Filter(?:\s+\d+)?\s*:\s*(ON|OFF)\s+([A-Za-z0-9]+)\b(.*)$/i);
  if (!match) {
    return null;
  }

  const filterType = normalizeFilterType(match[2]);
  if (!filterType || !eqFilterTypes.includes(filterType)) {
    return null;
  }

  const body = match[3] ?? '';
  const frequencyHz = readLabeledNumber(body, 'Fc');
  if (frequencyHz === null) {
    return null;
  }

  const rawQ = readLabeledNumber(body, 'Q');
  const rawBandwidth = rawQ === null ? readBandwidthNumber(body) : null;
  const q = rawQ ?? (rawBandwidth === null ? 1 : bandwidthOctavesToQ(rawBandwidth));
  const rawGain = readLabeledNumber(body, 'Gain') ?? 0;
  const gainDb = isGainEditableFilter(filterType) ? clamp(rawGain, eqMinGainDb, eqMaxGainDb) : 0;

  return {
    band: {
      frequencyHz: clamp(frequencyHz, eqMinFrequencyHz, eqMaxFrequencyHz),
      gainDb,
      q: clamp(q, eqMinQ, eqMaxQ),
      filterType,
      enabled: match[1].toUpperCase() === 'ON',
    },
    usedBandwidth: rawBandwidth !== null,
  };
};

const parseGraphicEqPoints = (line: string): GraphicEqPoint[] => {
  const match = line.match(/^\s*GraphicEQ\s*:\s*(.+)$/i);
  if (!match) {
    return [];
  }

  const points: GraphicEqPoint[] = [];
  const pairMatcher = new RegExp(String.raw`(${numberPattern})\s+(${numberPattern})`, 'gi');
  let pair: RegExpExecArray | null;

  while ((pair = pairMatcher.exec(match[1])) !== null) {
    const frequencyHz = parseNumber(pair[1]);
    const gainDb = parseNumber(pair[2]);
    if (frequencyHz !== null && gainDb !== null && frequencyHz > 0) {
      points.push({
        frequencyHz: clamp(frequencyHz, eqMinFrequencyHz, eqMaxFrequencyHz),
        gainDb: clamp(gainDb, eqMinGainDb, eqMaxGainDb),
      });
    }
  }

  return points;
};

const hasGraphicEqPointPair = (line: string): boolean =>
  new RegExp(String.raw`${numberPattern}\s+${numberPattern}`, 'i').test(line);

const interpolateGraphicGain = (points: GraphicEqPoint[], targetFrequencyHz: number): number => {
  const sorted = [...points].sort((left, right) => left.frequencyHz - right.frequencyHz);
  if (sorted.length === 0) {
    return 0;
  }
  if (targetFrequencyHz <= sorted[0].frequencyHz) {
    return sorted[0].gainDb;
  }
  if (targetFrequencyHz >= sorted[sorted.length - 1].frequencyHz) {
    return sorted[sorted.length - 1].gainDb;
  }

  const highIndex = sorted.findIndex((point) => point.frequencyHz >= targetFrequencyHz);
  const low = sorted[Math.max(0, highIndex - 1)];
  const high = sorted[highIndex];
  if (!low || !high || low.frequencyHz === high.frequencyHz) {
    return high?.gainDb ?? low?.gainDb ?? 0;
  }

  const lowLog = Math.log2(low.frequencyHz);
  const highLog = Math.log2(high.frequencyHz);
  const targetLog = Math.log2(targetFrequencyHz);
  const amount = (targetLog - lowLog) / (highLog - lowLog);
  return low.gainDb + (high.gainDb - low.gainDb) * amount;
};

const bandsFromGraphicEq = (points: GraphicEqPoint[]): EqBand[] =>
  eqFrequenciesHz.map((frequencyHz) => ({
    frequencyHz,
    gainDb: Math.round(interpolateGraphicGain(points, frequencyHz) * 10) / 10,
    q: 1,
    filterType: 'peaking',
    enabled: true,
  }));

export const parseEqualizerApoPreset = (content: string, options: { name?: string } = {}): EqualizerApoImportResult => {
  const warnings: string[] = [];
  let preampDb = 0;
  let sawPreamp = false;
  const filters: EqBand[] = [];
  let skippedFilterCount = 0;
  let graphicEqPoints: GraphicEqPoint[] = [];
  let unsupportedDirectiveCount = 0;
  const unsupportedDirectiveSummary: Record<string, number> = {};
  let channelScopedFilterCount = 0;
  let bandwidthFilterCount = 0;
  let channelScopeActive = false;

  const recordUnsupportedDirective = (directiveName: string): void => {
    const label = normalizeDirectiveLabel(directiveName);
    unsupportedDirectiveCount += 1;
    unsupportedDirectiveSummary[label] = (unsupportedDirectiveSummary[label] ?? 0) + 1;
  };

  const rawLines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex += 1) {
    const rawLine = rawLines[lineIndex];
    const line = stripComment(rawLine);
    if (!line) {
      continue;
    }

    const channelMatch = line.match(/^\s*Channel\s*:\s*(.+)$/i);
    if (channelMatch) {
      recordUnsupportedDirective('channel');
      channelScopeActive = !isGlobalChannelSelection(channelMatch[1] ?? '');
      continue;
    }

    const preampMatch = line.match(new RegExp(String.raw`^\s*Preamp\s*:\s*(${numberPattern})\s*dB\b`, 'i'));
    if (preampMatch) {
      const parsedPreamp = parseNumber(preampMatch[1]);
      if (parsedPreamp !== null) {
        preampDb = clamp(parsedPreamp, eqMinPreampDb, eqMaxPreampDb);
        sawPreamp = true;
      }
      continue;
    }

    if (/^\s*GraphicEQ\s*:/i.test(line)) {
      const graphicEqLines = [line];
      while (lineIndex + 1 < rawLines.length) {
        const nextLine = stripComment(rawLines[lineIndex + 1]);
        if (!nextLine || readDirectiveName(nextLine) || !hasGraphicEqPointPair(nextLine)) {
          break;
        }

        graphicEqLines.push(nextLine);
        lineIndex += 1;
      }

      graphicEqPoints = parseGraphicEqPoints(graphicEqLines.join(' '));
      continue;
    }

    if (/^\s*Filter(?:\s+\d+)?\s*:/i.test(line)) {
      const parsedFilter = parseFilterLine(line);
      if (parsedFilter) {
        if (parsedFilter.usedBandwidth) {
          bandwidthFilterCount += 1;
        }
        if (channelScopeActive) {
          channelScopedFilterCount += 1;
          skippedFilterCount += 1;
        } else {
          filters.push(parsedFilter.band);
        }
      } else {
        skippedFilterCount += 1;
      }
      continue;
    }

    const directiveName = readDirectiveName(line);
    if (directiveName && unsupportedApoDirectives.has(directiveName)) {
      recordUnsupportedDirective(directiveName);
    }
  }

  if (!sawPreamp && filters.length === 0 && graphicEqPoints.length === 0) {
    throw new Error('invalid_equalizer_apo_preset');
  }

  const bands = filters.length > 0
    ? Array.from({ length: eqBandCount }, (_, index) => filters[index] ?? defaultBand(index))
    : bandsFromGraphicEq(graphicEqPoints);

  if (filters.length > eqBandCount) {
    skippedFilterCount += filters.length - eqBandCount;
    warnings.push(`Only the first ${eqBandCount} Equalizer APO filters were imported.`);
  }
  if (graphicEqPoints.length > 0 && filters.length > 0) {
    warnings.push('GraphicEQ was ignored because parametric Filter lines were present.');
  }
  if (unsupportedDirectiveCount > 0) {
    warnings.push(`${unsupportedDirectiveCount} Equalizer APO routing or processing directives were recognized but not imported.`);
  }
  if (channelScopedFilterCount > 0) {
    warnings.push(`${channelScopedFilterCount} channel-scoped Equalizer APO filters were skipped to avoid applying one-channel tuning globally.`);
  }
  if (bandwidthFilterCount > 0) {
    warnings.push(`${bandwidthFilterCount} Equalizer APO BW/Bandwidth filters were converted to Q values.`);
  }

  return {
    source: 'equalizer-apo',
    name: options.name?.trim() || 'Equalizer APO Import',
    preampDb,
    bands,
    importedFilterCount: Math.min(filters.length, eqBandCount),
    skippedFilterCount,
    graphicEqPointCount: graphicEqPoints.length,
    unsupportedDirectiveCount,
    unsupportedDirectiveSummary,
    channelScopedFilterCount,
    bandwidthFilterCount,
    warnings,
  };
};
