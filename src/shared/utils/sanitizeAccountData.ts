const sensitiveKeyPattern = /cookie|token|session|csrf|authorization|password/i;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const sanitizeAccountData = (value: unknown, keyHint = ''): unknown => {
  if (sensitiveKeyPattern.test(keyHint)) {
    return '[redacted]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAccountData(item, keyHint));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, sanitizeAccountData(nestedValue, key)]));
  }

  if (typeof value === 'string') {
    return value
      .replace(/bearer\s+[a-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
      .replace(/(cookie|token|session|csrf|authorization|password)=([^&\s;]+)/gi, '$1=[redacted]');
  }

  return value;
};
