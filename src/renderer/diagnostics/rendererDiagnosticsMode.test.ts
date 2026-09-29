import { describe, expect, it } from 'vitest';
import { resolveHeavyRendererDiagnosticsEnabled } from './rendererDiagnosticsMode';

describe('rendererDiagnosticsMode', () => {
  it('keeps heavy diagnostics off by default in production', () => {
    expect(resolveHeavyRendererDiagnosticsEnabled({ nodeEnv: 'production' })).toBe(false);
    expect(resolveHeavyRendererDiagnosticsEnabled({})).toBe(false);
  });

  it('enables diagnostics during development or through an explicit opt-in', () => {
    expect(resolveHeavyRendererDiagnosticsEnabled({ nodeEnv: 'development' })).toBe(true);
    expect(resolveHeavyRendererDiagnosticsEnabled({ nodeEnv: 'production', explicitValue: '1' })).toBe(true);
    expect(resolveHeavyRendererDiagnosticsEnabled({ nodeEnv: 'production', queryValue: 'true' })).toBe(true);
    expect(resolveHeavyRendererDiagnosticsEnabled({ nodeEnv: 'production', storedValue: '1' })).toBe(true);
  });

  it('lets an explicit off value override development defaults', () => {
    expect(resolveHeavyRendererDiagnosticsEnabled({ nodeEnv: 'development', explicitValue: '0' })).toBe(false);
  });
});
