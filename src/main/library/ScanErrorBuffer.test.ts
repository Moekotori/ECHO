import { describe, expect, it } from 'vitest';
import { createScanErrorBuffer, getScanErrorTotals } from './ScanErrorBuffer';

describe('scan error memory budget', () => {
  it('retains only samples while counting and classifying every failure', () => {
    const errors = createScanErrorBuffer(error => error.startsWith('cover') ? 'cover' : 'metadata', 200);
    for (let index = 0; index < 10_000; index += 1) errors.push(`${index % 2 ? 'cover' : 'metadata'}: failed ${index}`);
    expect(errors).toHaveLength(200);
    expect(getScanErrorTotals(errors)).toEqual({ count: 10_000, kinds: new Map([['metadata', 5000], ['cover', 5000]]) });
    expect(JSON.parse(JSON.stringify(errors))).toHaveLength(200);
  });
});
