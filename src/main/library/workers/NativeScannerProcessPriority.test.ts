import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logLibraryScanPerf } from '../../diagnostics/LibraryScanPerfDiagnostics';
import { setNativeScannerProcessPriority } from './NativeScannerProcessPriority';

const setPriorityMock = vi.hoisted(() => vi.fn());

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    constants: {
      ...actual.constants,
      priority: {
        ...actual.constants.priority,
        PRIORITY_LOW: 19,
        PRIORITY_BELOW_NORMAL: 10,
        PRIORITY_NORMAL: 0,
      },
    },
    setPriority: setPriorityMock,
  };
});

vi.mock('../../diagnostics/LibraryScanPerfDiagnostics', () => ({
  logLibraryScanPerf: vi.fn(),
}));

describe('NativeScannerProcessPriority', () => {
  beforeEach(() => {
    setPriorityMock.mockReset();
    vi.mocked(logLibraryScanPerf).mockReset();
  });

  it.each([
    ['low', 19],
    ['balanced', 10],
    ['performance', 0],
    ['ultra', 0],
  ] as const)('maps %s scan mode to process priority %s', (mode, expectedPriority) => {
    const child = { pid: 1234 } as ChildProcessWithoutNullStreams;

    expect(setNativeScannerProcessPriority(child, 'nativeMetadataReader', mode)).toBe(true);
    expect(setPriorityMock).toHaveBeenCalledWith(1234, expectedPriority);
  });

  it('leaves processes unchanged when the OS rejects reprioritization', () => {
    setPriorityMock.mockImplementation(() => {
      throw new Error('access denied');
    });

    expect(setNativeScannerProcessPriority(
      { pid: 1234 } as ChildProcessWithoutNullStreams,
      'nativeMetadataReader',
      'ultra',
    )).toBe(false);
    expect(logLibraryScanPerf).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.stringContaining('process_priority=unchanged;requested=ultra'),
    }));
  });
});
