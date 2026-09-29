import { getAudioSession } from '../../audioPublicApi';

export type StageVisualTelemetrySnapshot = {
  visualEnergy: number;
  visualTransient: number;
  visualSpectrum: number[];
};

export type StageVisualTelemetrySource = {
  read: () => StageVisualTelemetrySnapshot;
};

const emptySpectrum = (): number[] => Array.from({ length: 32 }, () => 0);

export const createAudioSessionStageVisualTelemetrySource = (): StageVisualTelemetrySource => ({
  read: () => {
    const levels = getAudioSession().getStatus().audioLevels;
    return {
      visualEnergy: levels?.visualEnergy ?? 0,
      visualTransient: levels?.visualTransient ?? 0,
      visualSpectrum: Array.isArray(levels?.visualSpectrum) ? [...levels.visualSpectrum] : emptySpectrum(),
    };
  },
});
