function isTruthy(value: unknown): boolean {
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
  if (typeof value === 'number') return value === 1;
  return false;
}

export type ErrorInterceptorPolicy = {
  enabled: boolean;
  source: 'env' | 'url' | 'default';
};

export function resolveErrorInterceptorPolicy(): ErrorInterceptorPolicy {
  if (typeof process !== 'undefined' && isTruthy(process.env.ECHO_DISABLE_ERROR_INTERCEPTOR)) return { enabled: false, source: 'env' };
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.has('noErrorInterceptor')) return { enabled: false, source: 'url' };
  }
  return { enabled: true, source: 'default' };
}
