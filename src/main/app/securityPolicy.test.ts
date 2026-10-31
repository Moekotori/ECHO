import { describe, expect, it } from 'vitest';
import { areDeveloperToolsAllowed } from './securityPolicy';

describe('areDeveloperToolsAllowed', () => {
  it('allows DevTools in development builds', () => {
    expect(areDeveloperToolsAllowed(false, {})).toBe(true);
  });

  it('blocks DevTools by default in packaged builds', () => {
    expect(areDeveloperToolsAllowed(true, {})).toBe(false);
  });

  it('keeps an explicit packaged-build escape hatch for field diagnostics', () => {
    expect(areDeveloperToolsAllowed(true, { ECHO_ENABLE_DEVTOOLS: '1' })).toBe(true);
  });

  it('does not treat loose packaged-build env values as explicit DevTools consent', () => {
    expect(areDeveloperToolsAllowed(true, { ECHO_ENABLE_DEVTOOLS: 'true' })).toBe(false);
    expect(areDeveloperToolsAllowed(true, { ECHO_ENABLE_DEVTOOLS: '0' })).toBe(false);
  });
});
