import * as os from 'node:os';

export type ScanPerformanceMode = 'low' | 'balanced' | 'performance' | 'custom';

export type ScanConcurrencyRecommendation = {
  metadataConcurrency: number;
  coverConcurrency: number;
  cpuCount: number;
  mode: ScanPerformanceMode;
};

export type ScanConcurrencyOptions = {
  mode?: ScanPerformanceMode;
  metadataConcurrency?: number;
  coverConcurrency?: number;
  cpuCount?: number;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Math.floor(value)));

const readCpuCount = (): number => {
  try {
    return os.availableParallelism?.() ?? os.cpus().length;
  } catch {
    return 0;
  }
};

const normalizeCpuCount = (cpuCount: number): number => (Number.isFinite(cpuCount) ? Math.max(0, Math.floor(cpuCount)) : 0);

export const getRecommendedScanConcurrency = (options: ScanConcurrencyOptions = {}): ScanConcurrencyRecommendation => {
  const mode = options.mode ?? 'balanced';
  const cpuCount = normalizeCpuCount(options.cpuCount ?? readCpuCount());

  if (mode === 'custom') {
    return {
      metadataConcurrency: clamp(options.metadataConcurrency ?? 2, 1, 8),
      coverConcurrency: clamp(options.coverConcurrency ?? 1, 1, 4),
      cpuCount,
      mode,
    };
  }

  if (cpuCount < 2) {
    return {
      metadataConcurrency: 2,
      coverConcurrency: 1,
      cpuCount,
      mode,
    };
  }

  if (mode === 'low') {
    return {
      metadataConcurrency: cpuCount >= 4 ? 2 : 1,
      coverConcurrency: 1,
      cpuCount,
      mode,
    };
  }

  if (mode === 'performance') {
    return {
      metadataConcurrency: clamp(Math.floor(cpuCount * 0.75), 3, 6),
      coverConcurrency: clamp(Math.floor(cpuCount / 3), 2, 4),
      cpuCount,
      mode,
    };
  }

  return {
    metadataConcurrency: clamp(Math.floor(cpuCount / 2), 2, 4),
    coverConcurrency: clamp(Math.floor(cpuCount / 3), 1, 3),
    cpuCount,
    mode: 'balanced',
  };
};
