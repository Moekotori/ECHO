import { describe, expect, it, afterEach } from 'vitest';
import { resolveErrorInterceptorPolicy, type ErrorInterceptorPolicy } from './errorInterceptorPolicy';

describe('resolveErrorInterceptorPolicy', () => {
  const KEY = 'ECHO_DISABLE_ERROR_INTERCEPTOR';
  const savedEnv = process.env[KEY];

  afterEach(() => {
    delete process.env[KEY];
    if (savedEnv !== undefined) {
      process.env[KEY] = savedEnv;
    }
  });

  it('default: enabled when no toggle set', () => {
    delete process.env[KEY];
    expect(resolveErrorInterceptorPolicy()).toEqual<ErrorInterceptorPolicy>({
      enabled: true,
      source: 'default',
    });
  });

  it('env var "1" → disabled, source=env', () => {
    process.env[KEY] = '1';
    expect(resolveErrorInterceptorPolicy()).toEqual<ErrorInterceptorPolicy>({
      enabled: false,
      source: 'env',
    });
  });

  it('env var "true" → disabled', () => {
    process.env[KEY] = 'true';
    expect(resolveErrorInterceptorPolicy().enabled).toBe(false);
  });

  it('env var "TRUE" → disabled (case insensitive)', () => {
    process.env[KEY] = 'TRUE';
    expect(resolveErrorInterceptorPolicy().enabled).toBe(false);
  });

  it('env var "0" → enabled (not truthy)', () => {
    process.env[KEY] = '0';
    expect(resolveErrorInterceptorPolicy().enabled).toBe(true);
  });

  it('env var "no" → enabled (not truthy)', () => {
    process.env[KEY] = 'no';
    expect(resolveErrorInterceptorPolicy().enabled).toBe(true);
  });

  it('env var takes priority over default', () => {
    // When env var is set, it overrides the default 'enabled' state
    process.env[KEY] = '1';
    const result = resolveErrorInterceptorPolicy();
    expect(result.source).toBe('env');
    expect(result.enabled).toBe(false);
  });
});
