import { describe, expect, it, vi } from 'vitest';
import { isCleanProcessGoneReason, isClosedPipeWriteError } from './crashHandlers';

vi.mock('electron', () => ({
  app: { on: vi.fn() },
}));

vi.mock('./CrashReportService', () => ({
  getCrashReportService: () => ({
    getLogger: () => ({ warn: vi.fn(), error: vi.fn() }),
    reportCrash: vi.fn(),
  }),
}));

vi.mock('./CrashRecoveryDialog', () => ({
  showCrashRecoveryDialog: vi.fn(),
}));

vi.mock('./RuntimeSelfHeal', () => ({
  recoverClosedHelperPipe: vi.fn(),
}));

describe('crashHandlers', () => {
  it('classifies closed helper pipe writes as non-fatal', () => {
    expect(isClosedPipeWriteError(new Error('write EOF'))).toBe(true);
    expect(isClosedPipeWriteError(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).toBe(true);
    expect(isClosedPipeWriteError(Object.assign(new Error('write ECANCELED'), { code: 'ECANCELED' }))).toBe(true);
    expect(isClosedPipeWriteError(new Error('write ECANCELED'))).toBe(true);
    expect(isClosedPipeWriteError(Object.assign(new Error('stream was destroyed'), { code: 'ERR_STREAM_DESTROYED' }))).toBe(true);
    expect(isClosedPipeWriteError(Object.assign(new Error('write after end'), { code: 'ERR_STREAM_WRITE_AFTER_END' }))).toBe(true);
    expect(isClosedPipeWriteError(new Error('Cannot call write after a stream was destroyed'))).toBe(true);
  });

  it('does not classify unrelated exceptions as pipe writes', () => {
    expect(isClosedPipeWriteError(new Error('database disk image is malformed'))).toBe(false);
  });

  it('treats clean Electron process exits as non-crashes', () => {
    expect(isCleanProcessGoneReason('clean-exit')).toBe(true);
    expect(isCleanProcessGoneReason('crashed')).toBe(false);
    expect(isCleanProcessGoneReason('oom')).toBe(false);
  });
});
