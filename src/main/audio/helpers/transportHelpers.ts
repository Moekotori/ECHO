import type { AudioTransportFadeCurve } from '../../../shared/types/appSettings';

export type TransportFadeDirection = 'in' | 'out';

export type TransportFadeSettings = {
  enabled: boolean;
  durationMs: number;
  stepMs: number;
  curve: AudioTransportFadeCurve;
};

export const defaultTransportFadeDurationMs = 80;
export const defaultTransportFadeStepMs = 10;
export const defaultTransportFadeCurve: AudioTransportFadeCurve = 'smooth';
export const transportFadeCurves = new Set<AudioTransportFadeCurve>(['linear', 'smooth', 'equalPower']);

export const normalizeTransportFadeDurationMs = (value: unknown, fallback = defaultTransportFadeDurationMs): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.round(Math.max(0, Math.min(2000, numeric)))
    : fallback;
};

export const normalizeTransportFadeCurve = (value: unknown): AudioTransportFadeCurve =>
  transportFadeCurves.has(value as AudioTransportFadeCurve)
    ? (value as AudioTransportFadeCurve)
    : defaultTransportFadeCurve;

export const applyTransportFadeCurve = (progress: number, curve: AudioTransportFadeCurve): number => {
  const clamped = Math.max(0, Math.min(1, progress));
  if (curve === 'equalPower') {
    return Math.sin((clamped * Math.PI) / 2);
  }
  if (curve === 'smooth') {
    return clamped * clamped * (3 - (2 * clamped));
  }

  return clamped;
};
