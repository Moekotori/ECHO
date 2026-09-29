export type PrivateOverlayRuntimeInstallResult = {
  installed: boolean;
  source: 'public-stub' | 'private-overlay';
  features: string[];
};

export const installPrivateOverlayRuntime = (): PrivateOverlayRuntimeInstallResult => ({
  installed: false,
  source: 'public-stub',
  features: [],
});
