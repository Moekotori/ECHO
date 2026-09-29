import { describe, expect, it } from 'vitest';
import { classifyCapturedConsoleLevel } from './CapturedConsoleLevel';

describe('captured performance console levels', () => {
  it('keeps successful slow calls at warning level even on stderr', () => {
    expect(classifyCapturedConsoleLevel('stderr', 'error', '[ipc-perf] library:get-tracks 445ms SLOW actionHint=check handler work')).toBe('warn');
    expect(classifyCapturedConsoleLevel('stderr', 'error', '[playback-perf] playLocalTrack:autoSearchMv 777ms SLOW')).toBe('warn');
  });
  it('retains failed IPC and actual native errors as errors', () => {
    expect(classifyCapturedConsoleLevel('stderr', 'error', '[ipc-perf] audio:set-output 699ms SLOW failed=true')).toBe('error');
    expect(classifyCapturedConsoleLevel('stderr', 'error', 'Error: rpc_bridge_not_open')).toBe('error');
  });
});
