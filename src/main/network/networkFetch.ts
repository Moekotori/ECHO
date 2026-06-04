const normalizeReferrer = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
};

const sameOriginReferrer = (input: RequestInfo | URL, referrer: string): string | null => {
  try {
    const requestUrl = new URL(input instanceof Request ? input.url : input.toString());
    const referrerUrl = new URL(referrer);
    return requestUrl.origin === referrerUrl.origin ? referrerUrl.toString() : null;
  } catch {
    return null;
  }
};

const initForElectronNetFetch = (input: RequestInfo | URL, init?: RequestInit): RequestInit | undefined => {
  if (!init) {
    return init;
  }

  const headers = new Headers(init.headers);
  const headerReferrer = normalizeReferrer(headers.get('referer') ?? headers.get('referrer'));
  const explicitReferrer = normalizeReferrer(typeof init.referrer === 'string' ? init.referrer : null);
  const referrer = explicitReferrer
    ? sameOriginReferrer(input, explicitReferrer)
    : headerReferrer
      ? sameOriginReferrer(input, headerReferrer)
      : null;
  headers.delete('referer');
  headers.delete('referrer');

  const nextInit: RequestInit = {
    ...init,
    headers,
  };

  delete nextInit.referrer;
  delete nextInit.referrerPolicy;

  if (referrer) {
    nextInit.referrer = referrer;
    nextInit.referrerPolicy = init.referrerPolicy ?? 'unsafe-url';
  }

  return nextInit;
};

export const fetchWithNetworkProxy = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const requestInput = input instanceof URL ? input.toString() : input;

  if (process.env.VITEST === 'true') {
    return fetch(requestInput, init);
  }

  try {
    const electron = await import('electron');
    if (electron.app?.isReady?.() && electron.net?.fetch) {
      return electron.net.fetch(requestInput, initForElectronNetFetch(requestInput, init));
    }
  } catch {
    // Fall back to Node fetch when Electron net is unavailable, such as in unit tests.
  }

  return fetch(requestInput, init);
};
