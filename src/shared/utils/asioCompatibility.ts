import type { AsioCompatibilityProfile } from '../types/audio';

export const detectAsioCompatibilityProfile = (deviceName: unknown): AsioCompatibilityProfile | null => {
  return typeof deviceName === 'string' && deviceName.toLocaleLowerCase().includes('asio4all') ? 'asio4all' : null;
};
