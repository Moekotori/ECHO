type ErrorTotals = { count: number; kinds: Map<string, number> };
const totals = new WeakMap<string[], ErrorTotals>();

/** Keep samples bounded while counting every error incrementally. */
export function createScanErrorBuffer(classify: (error: string) => string, limit: number): string[] {
  const samples: string[] = [];
  const state: ErrorTotals = { count: 0, kinds: new Map() };
  totals.set(samples, state);
  Object.defineProperty(samples, 'push', { value: (...errors: string[]): number => {
    for (const error of errors) {
      state.count += 1;
      const kind = classify(error);
      state.kinds.set(kind, (state.kinds.get(kind) ?? 0) + 1);
      if (samples.length < limit) Array.prototype.push.call(samples, error);
    }
    return samples.length;
  } });
  return samples;
}

export const getScanErrorTotals = (errors: string[]): ErrorTotals | undefined => totals.get(errors);
