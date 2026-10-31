import { LastFmService } from './LastFmService';

let lastFmService: LastFmService | null = null;

export const getLastFmService = (): LastFmService => {
  lastFmService ??= new LastFmService();
  return lastFmService;
};

export const resetLastFmServiceForTests = (): void => {
  void lastFmService?.dispose();
  lastFmService = null;
};
