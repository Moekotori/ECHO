export const publicAuthorizationRequiredMessage = 'echo_authorization_required';

const authorizationFailurePattern =
  /\b(?:echo_authorization_required|echo_pro_required|echo_pro_private_overlay_unavailable|connect_donator_unlock_required|connect_hwid_not_allowed|downloads_plugin_unlock_required)\b/iu;
const echoProPackageFailurePattern = /\becho_pro_(?:license|package)_[a-z0-9_-]+\b/iu;

const getErrorCodeOrMessage = (error: unknown): string => {
  if (error instanceof Error) {
    const maybeCode = (error as { code?: unknown }).code;
    const code = typeof maybeCode === 'string' ? maybeCode : '';
    return `${code} ${error.message}`;
  }
  return typeof error === 'string' ? error : '';
};

export const isAuthorizationFailure = (error: unknown): boolean => {
  const message = getErrorCodeOrMessage(error);
  return authorizationFailurePattern.test(message) || echoProPackageFailurePattern.test(message);
};

export const createPublicAuthorizationRequiredError = (): Error => {
  const error = new Error(publicAuthorizationRequiredMessage) as Error & { code?: string };
  error.code = publicAuthorizationRequiredMessage;
  return error;
};
