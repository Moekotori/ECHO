export const windowsAudioRuntimeComponentId = 'audio-win-x64' as const;

export type RuntimeAudioComponentState = 'installed' | 'missing' | 'invalid' | 'unsupported';

export type RuntimeAudioComponentStatus = {
  componentId: typeof windowsAudioRuntimeComponentId;
  displayName: string;
  state: RuntimeAudioComponentState;
  installed: boolean;
  version: string | null;
  downloadPageUrl: string;
  estimatedInstalledBytes: number;
  error: string | null;
};

export type RuntimeAudioComponentImportResult = {
  outcome: 'installed' | 'cancelled';
  status: RuntimeAudioComponentStatus;
};
