import { setImmediate as yieldToMainLoop } from 'node:timers/promises';

export function runSteps<T>(steps: Generator<void, T, void>): T {
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}

/** Keep transactions inside each step; never hold a transaction over an await. */
export async function runCooperativeSteps<T>(
  steps: Generator<void, T, void>,
  check: () => void = () => undefined,
  afterStep: () => void = () => undefined,
): Promise<T> {
  try {
    for (;;) {
      await yieldToMainLoop();
      check();
      const result = steps.next();
      afterStep();
      if (result.done) return result.value;
    }
  } finally {
    steps.return(undefined as never);
  }
}
