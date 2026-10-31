import { describe, expect, it, vi, beforeEach } from 'vitest';
import { clearCudaRuntimeStatusCache, resolveCudaRuntimeStatus } from './CudaRuntimeProbe';

describe('CudaRuntimeProbe', () => {
  beforeEach(() => {
    clearCudaRuntimeStatusCache();
  });

  it('detects NVIDIA CUDA through nvidia-smi CSV output', () => {
    const execFileSync = vi
      .fn()
      .mockReturnValueOnce('NVIDIA GeForce RTX 4090, 555.99, 24564\n')
      .mockReturnValueOnce('| NVIDIA-SMI 555.99        CUDA Version: 12.5     |\n');

    const status = resolveCudaRuntimeStatus({
      platform: 'win32',
      env: { ECHO_CUDA_NVIDIA_SMI_PATH: 'C:\\NVIDIA\\nvidia-smi.exe' },
      existsSync: () => true,
      execFileSync: execFileSync as never,
    });

    expect(status).toEqual({
      available: true,
      source: 'nvidia-smi',
      deviceName: 'NVIDIA GeForce RTX 4090',
      memoryTotalMiB: 24564,
      driverVersion: '555.99',
      cudaVersion: '12.5',
      error: null,
    });
    expect(execFileSync).toHaveBeenCalledWith(
      'C:\\NVIDIA\\nvidia-smi.exe',
      ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader,nounits'],
      expect.objectContaining({ timeout: 2000, windowsHide: true }),
    );
  });

  it('returns unavailable when nvidia-smi cannot be found', () => {
    const status = resolveCudaRuntimeStatus({
      platform: 'win32',
      env: {},
      existsSync: () => false,
      execFileSync: vi.fn(() => {
        throw new Error('ENOENT');
      }) as never,
    });

    expect(status.available).toBe(false);
    expect(status.source).toBe('error');
    expect(status.error).toContain('ENOENT');
  });
});
