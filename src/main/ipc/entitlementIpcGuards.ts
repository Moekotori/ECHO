import type { IpcMainInvokeEvent } from 'electron';
import type { PrivateFeatureId } from '../plugins/privateEntitlements';
import { getConnectDonatorUnlockService } from '../plugins/ConnectDonatorUnlockService';
import { getDownloadFeatureUnlockService } from '../plugins/DownloadFeatureUnlockService';
import { requireEchoProFeature } from '../plugins/ProFeatureGate';
import { requirePrivateFeature } from '../plugins/privateEntitlements';
import { requireLocalPro, type LocalProFeature } from '../plugins/LocalProEntitlements';
import {
  createPublicAuthorizationRequiredError,
  isAuthorizationFailure,
  publicAuthorizationRequiredMessage,
} from '../../shared/ipcAuthorizationFailure';

export {
  createPublicAuthorizationRequiredError,
  isAuthorizationFailure,
  publicAuthorizationRequiredMessage,
} from '../../shared/ipcAuthorizationFailure';

type IpcInvokeHandler<Args extends unknown[], Result> = (
  event: IpcMainInvokeEvent,
  ...args: Args
) => Result | Promise<Result>;

type MainFeatureGuard<Args extends unknown[]> = (event: IpcMainInvokeEvent, ...args: Args) => void | Promise<void>;

const throwPublicAuthorizationRequired = (): never => {
  throw createPublicAuthorizationRequiredError();
};

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

export const requireLocalProFeatureThen = <Args extends unknown[], Result>(
  feature: LocalProFeature,
  handler: IpcInvokeHandler<Args, Result>,
): IpcInvokeHandler<Args, Result> => requireSyncMainFeatureThen<Args, Result>(() => requireLocalPro(feature), handler);
