import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireBackgroundPauseLease,
  configureBackgroundPauseLeaseApplier,
  getBackgroundPauseLeaseSnapshot,
  reapplyBackgroundPauseLeases,
  releaseBackgroundPauseLease,
  resetBackgroundPauseLeasesForTests,
} from './backgroundPauseLeases';

afterEach(resetBackgroundPauseLeasesForTests);

describe('background pause leases', () => {
  it('resumes only after every pause owner releases its lease', async () => {
    const apply = vi.fn();
    configureBackgroundPauseLeaseApplier(apply);
    await acquireBackgroundPauseLease('tray-hidden');
    await acquireBackgroundPauseLease('manual-ultralite');
    await releaseBackgroundPauseLease('tray-hidden');
    expect(getBackgroundPauseLeaseSnapshot()).toEqual({ paused: true, reasons: ['manual-ultralite'] });
    expect(apply.mock.calls).toEqual([[true]]);
    await releaseBackgroundPauseLease('manual-ultralite');
    expect(apply.mock.calls).toEqual([[true], [false]]);
  });

  it('is idempotent for duplicate acquire and release operations', async () => {
    const apply = vi.fn();
    configureBackgroundPauseLeaseApplier(apply);
    await acquireBackgroundPauseLease('minimized');
    await acquireBackgroundPauseLease('minimized');
    await releaseBackgroundPauseLease('minimized');
    await releaseBackgroundPauseLease('minimized');
    expect(apply.mock.calls).toEqual([[true], [false]]);
  });

  it('can reassert an existing pause after an interrupted partial resume', async () => {
    const apply = vi.fn();
    configureBackgroundPauseLeaseApplier(apply);
    await acquireBackgroundPauseLease('tray-hidden');
    await reapplyBackgroundPauseLeases();

    expect(getBackgroundPauseLeaseSnapshot().reasons).toEqual(['tray-hidden']);
    expect(apply.mock.calls).toEqual([[true], [true]]);
  });
});
