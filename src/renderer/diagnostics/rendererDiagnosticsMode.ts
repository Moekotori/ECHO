const diagnosticsEnvironmentVariable = 'ECHO_RENDERER_PERF_DIAGNOSTICS';
const diagnosticsQueryParameter = 'echoDiagnostics';
const diagnosticsStorageKey = 'echo-next.renderer-performance-diagnostics';

type RendererDiagnosticsModeInputs = {
  explicitValue?: string;
  nodeEnv?: string;
  queryValue?: string | null;
  storedValue?: string | null;
};

const isEnabledValue = (value: string | null | undefined): boolean => value === '1' || value === 'true';

export const resolveHeavyRendererDiagnosticsEnabled = ({
  explicitValue,
  nodeEnv,
  queryValue,
  storedValue,
}: RendererDiagnosticsModeInputs): boolean => {
  if (explicitValue !== undefined) {
    return isEnabledValue(explicitValue);
  }
  if (queryValue !== null && queryValue !== undefined) {
    return isEnabledValue(queryValue);
  }
  if (storedValue !== null && storedValue !== undefined) {
    return isEnabledValue(storedValue);
  }
  return nodeEnv === 'development';
};

const readRendererEnvironment = (name: string): string | undefined => {
  const maybeProcess = typeof process !== 'undefined' ? process : undefined;
  return maybeProcess?.env?.[name];
};

export const shouldStartHeavyRendererDiagnostics = (): boolean => {
  const queryValue = typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get(diagnosticsQueryParameter);
  let storedValue: string | null = null;
  try {
    storedValue = typeof window === 'undefined' ? null : window.localStorage.getItem(diagnosticsStorageKey);
  } catch {
    storedValue = null;
  }

  return resolveHeavyRendererDiagnosticsEnabled({
    explicitValue: readRendererEnvironment(diagnosticsEnvironmentVariable),
    nodeEnv: readRendererEnvironment('NODE_ENV'),
    queryValue,
    storedValue,
  });
};
