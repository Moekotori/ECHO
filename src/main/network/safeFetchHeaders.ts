type SafeFetchHeaderIssueReason =
  | 'invalid_header_name'
  | 'non_string_header_value'
  | 'invalid_header_value_character'
  | 'non_byte_string_header_value'
  | 'headers_set_failed';

type SafeFetchHeaderIssue = {
  headerName: string;
  reason: SafeFetchHeaderIssueReason;
  sensitive: boolean;
  valueLength?: number;
  codePoint?: number;
  index?: number;
  error?: string;
};

type SafeFetchHeaderLogger = (message: string, payload?: Record<string, unknown>) => void;

type SafeFetchHeaderOptions = {
  context?: string;
  targetHost?: string | null;
  logger?: SafeFetchHeaderLogger;
};

const requestHeaderNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const sensitiveHeaderNames = new Set(['authorization', 'cookie', 'proxy-authorization', 'set-cookie', 'x-api-key', 'x-auth-token']);

const defaultLogger: SafeFetchHeaderLogger = (message, payload) => console.warn(message, payload ?? '');

const isSensitiveHeaderName = (name: string): boolean => sensitiveHeaderNames.has(name.toLocaleLowerCase());

const invalidHeaderValue = (
  value: string,
): { reason: 'invalid_header_value_character' | 'non_byte_string_header_value'; codePoint: number; index: number } | null => {
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }

    if (codePoint > 0xff) {
      return { reason: 'non_byte_string_header_value', codePoint, index };
    }
    if ((codePoint < 0x20 && codePoint !== 0x09) || codePoint === 0x7f) {
      return { reason: 'invalid_header_value_character', codePoint, index };
    }

    index += codePoint > 0xffff ? 2 : 1;
  }

  return null;
};

const headersInitEntries = (headers: HeadersInit | null | undefined): Array<[string, unknown]> => {
  if (!headers) {
    return [];
  }

  if (headers instanceof Headers) {
    return Array.from(headers.entries());
  }

  if (Array.isArray(headers)) {
    return headers.map(([name, value]) => [name, value]);
  }

  return Object.entries(headers as Record<string, unknown>);
};

const reportDroppedHeaders = (issues: SafeFetchHeaderIssue[], options: SafeFetchHeaderOptions): void => {
  if (issues.length === 0) {
    return;
  }

  const logger = options.logger ?? defaultLogger;
  logger('[network] Dropped invalid request header(s) before fetch.', {
    context: options.context ?? 'request',
    targetHost: options.targetHost ?? undefined,
    droppedHeaders: issues,
  });
};

export const createSafeFetchHeaders = (headers: HeadersInit | null | undefined, options: SafeFetchHeaderOptions = {}): Headers => {
  const safeHeaders = new Headers();
  const droppedHeaders: SafeFetchHeaderIssue[] = [];

  for (const [rawName, rawValue] of headersInitEntries(headers)) {
    const headerName = rawName;
    const sensitive = isSensitiveHeaderName(headerName);
    if (!requestHeaderNamePattern.test(headerName)) {
      droppedHeaders.push({
        headerName,
        reason: 'invalid_header_name',
        sensitive,
      });
      continue;
    }

    if (typeof rawValue !== 'string') {
      droppedHeaders.push({
        headerName,
        reason: 'non_string_header_value',
        sensitive,
      });
      continue;
    }

    const invalidValue = invalidHeaderValue(rawValue);
    if (invalidValue) {
      droppedHeaders.push({
        headerName,
        reason: invalidValue.reason,
        sensitive,
        valueLength: rawValue.length,
        codePoint: invalidValue.codePoint,
        index: invalidValue.index,
      });
      continue;
    }

    try {
      safeHeaders.set(headerName, rawValue);
    } catch (error) {
      droppedHeaders.push({
        headerName,
        reason: 'headers_set_failed',
        sensitive,
        valueLength: rawValue.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  reportDroppedHeaders(droppedHeaders, options);
  return safeHeaders;
};

export const createSafeFetchHeaderRecord = (
  headers: HeadersInit | null | undefined,
  options: SafeFetchHeaderOptions = {},
): Record<string, string> => Object.fromEntries(createSafeFetchHeaders(headers, options).entries());
