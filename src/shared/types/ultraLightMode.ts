export type UltraLightModePhase = 'inactive' | 'entering' | 'active' | 'restoring';

export const ultraLightRendererRestoreQueryKey = 'echoUltraLightRestore';

export const isUltraLightRendererRestore = (search: string): boolean =>
  new URLSearchParams(search).get(ultraLightRendererRestoreQueryKey) === '1';

export type UltraLightModeStatus = {
  phase: UltraLightModePhase;
  active: boolean;
  restoreAccelerator: string;
  error: string | null;
};
