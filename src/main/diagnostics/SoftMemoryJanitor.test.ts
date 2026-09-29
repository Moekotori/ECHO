import { afterEach, describe, expect, it } from 'vitest';
import {
  createSoftMemoryCleanupLogFields,
  registerSoftMemoryCleanupTask,
  releaseSoftMemoryPressure,
  resetSoftMemoryJanitorForTests,
} from './SoftMemoryJanitor';

afterEach(() => {
  resetSoftMemoryJanitorForTests();
});

describe('SoftMemoryJanitor', () => {
  it('runs registered cleanup tasks without throwing through failures', async () => {
    registerSoftMemoryCleanupTask('expired-cache', () => ({
      task: 'expired-cache',
      beforeEntries: 3,
      afterEntries: 1,
      removedEntries: 2,
    }));
    registerSoftMemoryCleanupTask('broken-cache', () => {
      throw new Error('cleanup failed');
    });

    const summary = await releaseSoftMemoryPressure({ cooldownMs: 0, nowMs: 1000, reason: 'test-pressure' });

    expect(summary).toMatchObject({
      reason: 'test-pressure',
      ran: true,
      skipped: false,
      cooldownHit: false,
      cooldownRemainingMs: 0,
      taskCount: 1,
      removedEntries: 2,
      errorCount: 1,
    });
    expect(summary.tasks).toHaveLength(1);
    expect(summary.errors).toEqual([{ task: 'broken-cache', message: 'cleanup failed' }]);
    expect(createSoftMemoryCleanupLogFields(summary)).toEqual({
      reason: 'test-pressure',
      ran: true,
      skippedReason: null,
      cooldownHit: false,
      cooldownRemainingMs: 0,
      taskCount: 1,
      removedEntries: 2,
      errorCount: 1,
    });
  });

  it('honors cooldown and unregisters tasks', async () => {
    let calls = 0;
    const unregister = registerSoftMemoryCleanupTask('cache', () => {
      calls += 1;
      return { task: 'cache', removedEntries: 1 };
    });

    await releaseSoftMemoryPressure({ cooldownMs: 5000, nowMs: 1000 });
    const cooldownSummary = await releaseSoftMemoryPressure({ cooldownMs: 5000, nowMs: 2000 });
    unregister();
    const emptySummary = await releaseSoftMemoryPressure({ cooldownMs: 0, nowMs: 7000 });

    expect(calls).toBe(1);
    expect(cooldownSummary).toMatchObject({
      ran: false,
      skipped: true,
      skippedReason: 'cooldown',
      cooldownHit: true,
      cooldownRemainingMs: 4000,
      errorCount: 0,
    });
    expect(createSoftMemoryCleanupLogFields(cooldownSummary)).toMatchObject({
      skippedReason: 'cooldown',
      cooldownHit: true,
      cooldownRemainingMs: 4000,
      removedEntries: 0,
      errorCount: 0,
    });
    expect(emptySummary).toMatchObject({
      ran: false,
      skipped: true,
      skippedReason: 'empty',
      cooldownHit: false,
      cooldownRemainingMs: 0,
      errorCount: 0,
    });
  });
});
