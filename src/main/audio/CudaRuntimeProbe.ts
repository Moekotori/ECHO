import { existsSync as nodeExistsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync as nodeExecFileSync } from 'node:child_process';
import type { AudioCudaRuntimeStatus } from '../../shared/types/audio';

export type CudaRuntimeProbeDependencies = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  existsSync?: (path: string) => boolean;
  execFileSync?: typeof nodeExecFileSync;
};

const cudaProbeTimeoutMs = 2_000;
let cachedStatus: AudioCudaRuntimeStatus | null = null;

const missingStatus = (error = 'nvidia_smi_missing'): AudioCudaRuntimeStatus => ({
  available: false,
  source: 'missing',
  deviceName: null,
  memoryTotalMiB: null,
  driverVersion: null,
  cudaVersion: null,
  error,
});

const errorStatus = (error: unknown): AudioCudaRuntimeStatus => ({
  available: false,
  source: 'error',
  deviceName: null,
  memoryTotalMiB: null,
  driverVersion: null,
  cudaVersion: null,
  error: error instanceof Error ? error.message : String(error),
});

const normalizeText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const collectNvidiaSmiCandidates = (
  dependencies: CudaRuntimeProbeDependencies,
): string[] => {
  const env = dependencies.env ?? process.env;
  const platform = dependencies.platform ?? process.platform;
  const candidates = [
    normalizeText(env.ECHO_CUDA_NVIDIA_SMI_PATH),
    platform === 'win32' ? join(env.ProgramW6432 ?? 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe') : null,
    platform === 'win32' ? join(env['ProgramFiles'] ?? 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe') : null,
    platform === 'win32' ? 'nvidia-smi.exe' : 'nvidia-smi',
  ];
  const seen = new Set<string>();

  return candidates.filter((candidate): candidate is string => {
    if (!candidate || seen.has(candidate)) {
      return false;
    }

    seen.add(candidate);
    return true;
  });
};

const parseCudaVersion = (output: string): string | null => {
  const match = output.match(/CUDA(?:\s+UMD)?\s+Version:\s*([0-9.]+)/iu);
  return match?.[1] ?? null;
};

const parseNvidiaSmiCsv = (output: string, fullOutput: string): AudioCudaRuntimeStatus | null => {
  const line = output.split(/\r?\n/u).map((item) => item.trim()).find(Boolean);
  if (!line) {
    return null;
  }

  const [deviceName, driverVersion, memoryTotalMiBText] = line.split(',').map((item) => item.trim());
  if (!deviceName || !driverVersion) {
    return null;
  }
  const memoryTotalMiB = Number(memoryTotalMiBText);

  return {
    available: true,
    source: 'nvidia-smi',
    deviceName,
    memoryTotalMiB: Number.isFinite(memoryTotalMiB) && memoryTotalMiB > 0 ? Math.round(memoryTotalMiB) : null,
    driverVersion,
    cudaVersion: parseCudaVersion(fullOutput),
    error: null,
  };
};

export const resolveCudaRuntimeStatus = (
  dependencies: CudaRuntimeProbeDependencies = {},
): AudioCudaRuntimeStatus => {
  if (cachedStatus && !dependencies.execFileSync) {
    return cachedStatus;
  }

  const execFileSync = dependencies.execFileSync ?? nodeExecFileSync;
  const existsSync = dependencies.existsSync ?? nodeExistsSync;
  const candidates = collectNvidiaSmiCandidates(dependencies);
  let lastError: unknown = null;

  for (const candidate of candidates) {
    if (candidate.includes('\\') || candidate.includes('/')) {
      try {
        if (!existsSync(candidate)) {
          continue;
        }
      } catch {
        continue;
      }
    }

    try {
      const output = execFileSync(
        candidate,
        ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader,nounits'],
        {
          encoding: 'utf8',
          timeout: cudaProbeTimeoutMs,
          windowsHide: true,
        },
      ) as string;
      const fullOutput = execFileSync(candidate, [], {
        encoding: 'utf8',
        timeout: cudaProbeTimeoutMs,
        windowsHide: true,
      }) as string;
      const parsed = parseNvidiaSmiCsv(output, fullOutput);
      if (parsed) {
        cachedStatus = parsed;
        return parsed;
      }

      lastError = 'nvidia_smi_parse_failed';
    } catch (error) {
      lastError = error;
    }
  }

  cachedStatus = lastError ? errorStatus(lastError) : missingStatus();
  return cachedStatus;
};

export const clearCudaRuntimeStatusCache = (): void => {
  cachedStatus = null;
};
