export type BackgroundPauseReason =
  | 'tray-hidden'
  | 'minimized'
  | 'memory-pressure'
  | 'manual-ultralite'
  | 'playback-critical'
  | 'application-shutdown';

export type BackgroundPauseLeaseSnapshot = {
  paused: boolean;
  reasons: readonly BackgroundPauseReason[];
};

type PauseApplier = (paused: boolean) => void | Promise<void>;

const reasons = new Set<BackgroundPauseReason>();
let appliedPaused = false;
let applier: PauseApplier | null = null;
let operation = Promise.resolve();

const reconcile = (force = false): Promise<void> => {
  const desiredPaused = reasons.size > 0;
  operation = operation.catch(() => undefined).then(async () => {
    if (!force && desiredPaused === appliedPaused) return;
    await applier?.(desiredPaused);
    appliedPaused = desiredPaused;
  });
  return operation;
};

export const configureBackgroundPauseLeaseApplier = (nextApplier: PauseApplier): void => {
  applier = nextApplier;
  // A recreated main-window controller may attach after a lease was acquired.
  // Re-apply the current truth to the new sink instead of trusting stale local
  // knowledge from the previous controller instance.
  appliedPaused = false;
  if (reasons.size > 0) void reconcile();
};

export const acquireBackgroundPauseLease = async (reason: BackgroundPauseReason): Promise<BackgroundPauseLeaseSnapshot> => {
  reasons.add(reason);
  await reconcile();
  return getBackgroundPauseLeaseSnapshot();
};

export const releaseBackgroundPauseLease = async (reason: BackgroundPauseReason): Promise<BackgroundPauseLeaseSnapshot> => {
  reasons.delete(reason);
  await reconcile();
  return getBackgroundPauseLeaseSnapshot();
};

/**
 * Reassert the current lease truth after a partially completed foreground
 * resume ramp is interrupted. This does not create a new owner; it only asks
 * the configured producer sink to return to the state already represented by
 * the reason set.
 */
export const reapplyBackgroundPauseLeases = async (): Promise<BackgroundPauseLeaseSnapshot> => {
  await reconcile(true);
  return getBackgroundPauseLeaseSnapshot();
};

export const hasBackgroundPauseReason = (reason: BackgroundPauseReason): boolean => reasons.has(reason);

export const getBackgroundPauseLeaseSnapshot = (): BackgroundPauseLeaseSnapshot => ({
  paused: reasons.size > 0,
  reasons: [...reasons].sort(),
});

export const resetBackgroundPauseLeasesForTests = (): void => {
  reasons.clear();
  appliedPaused = false;
  applier = null;
  operation = Promise.resolve();
};
