import type { IpcMainInvokeEvent } from 'electron';
import type { PrivateFeatureId } from '../plugins/privateEntitlements';
import { getConnectDonatorUnlockService } from '../plugins/ConnectDonatorUnlockService';
import { getDownloadFeatureUnlockService } from '../plugins/DownloadFeatureUnlockService';
import { requireEchoProFeature } from '../plugins/ProFeatureGate';
import { requirePrivateFeature } from '../plugins/privateEntitlements';

type IpcInvokeHandler<Args extends unknown[], Result> = (
  event: IpcMainInvokeEvent,
  ...args: Args
) => Result | Promise<Result>;

type MainFeatureGuard<Args extends unknown[]> = (event: IpcMainInvokeEvent, ...args: Args) => void | Promise<void>;

export const publicAuthorizationRequiredMessage = 'echo_authorization_required';

export const createPublicAuthorizationRequiredError = (): Error => {
  const error = new Error(publicAuthorizationRequiredMessage) as Error & { code?: string };
  error.code = publicAuthorizationRequiredMessage;
  return error;
};

const throwPublicAuthorizationRequired = (): never => {
  throw createPublicAuthorizationRequiredError();
};

const getErrorCodeOrMessage = (error: unknown): string => {
  if (error instanceof Error) {
    const maybeCode = (error as { code?: unknown }).code;
    const code = typeof maybeCode === 'string' ? maybeCode : '';
    return `${code} ${error.message}`;
  }
  return typeof error === 'string' ? error : '';
};

export const isAuthorizationFailure = (error: unknown): boolean =>
  /\b(?:echo_authorization_required|echo_pro_required|echo_pro_private_overlay_unavailable|connect_donator_unlock_required|connect_hwid_not_allowed|downloads_plugin_unlock_required)\b/iu.test(
    getErrorCodeOrMessage(error),
  ) ||
  /\becho_pro_(?:license|package)_[a-z0-9_-]+\b/iu.test(getErrorCodeOrMessage(error));

export const requireMainFeatureThen = <Args extends unknown[], Result>(
  requireFeature: MainFeatureGuard<Args>,
  handler: IpcInvokeHandler<Args, Result>,
): IpcInvokeHandler<Args, Result> => async (event, ...args) => {
  try {
    await requireFeature(event, ...args);
  } catch (error) {
    if (!isAuthorizationFailure(error)) {
      throw error;
    }
    throwPublicAuthorizationRequired();
  }
  return handler(event, ...args);
};

export const requireSyncMainFeatureThen = <Args extends unknown[], Result>(
  requireFeature: (event: IpcMainInvokeEvent, ...args: Args) => void,
  handler: IpcInvokeHandler<Args, Result>,
): IpcInvokeHandler<Args, Result> => (event, ...args) => {
  try {
    requireFeature(event, ...args);
  } catch (error) {
    if (!isAuthorizationFailure(error)) {
      throw error;
    }
    throwPublicAuthorizationRequired();
  }
  return handler(event, ...args);
};

export const requireConnectDonatorFeatureThen = <Args extends unknown[], Result>(
  handler: IpcInvokeHandler<Args, Result>,
): IpcInvokeHandler<Args, Result> =>
  requireSyncMainFeatureThen<Args, Result>(() => {
    getConnectDonatorUnlockService().assertUnlocked();
  }, handler);

export const requireDownloadsFeatureThen = <Args extends unknown[], Result>(
  handler: IpcInvokeHandler<Args, Result>,
): IpcInvokeHandler<Args, Result> =>
  requireSyncMainFeatureThen<Args, Result>(() => {
    getDownloadFeatureUnlockService().assertUnlocked();
  }, handler);

export const requireEchoProFeatureThen = <Args extends unknown[], Result>(
  handler: IpcInvokeHandler<Args, Result>,
): IpcInvokeHandler<Args, Result> => requireMainFeatureThen<Args, Result>(() => requireEchoProFeature(), handler);

export const requirePrivateFeatureThen = <Args extends unknown[], Result>(
  feature: PrivateFeatureId,
  handler: IpcInvokeHandler<Args, Result>,
): IpcInvokeHandler<Args, Result> => requireMainFeatureThen<Args, Result>(() => requirePrivateFeature(feature), handler);
