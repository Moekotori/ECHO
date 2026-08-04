import { cpus } from 'node:os';
import type { NativeHostNotificationEvent } from '../audioTypes';

export const normalizeCpuModel = (model: unknown): string | null => {
  if (typeof model !== 'string') {
    return null;
  }

  const normalized = model.replace(/\s+/gu, ' ').trim();
  return normalized ? normalized.slice(0, 120) : null;
};

export const runtimeCpuModel = (() => {
  try {
    return normalizeCpuModel(cpus()[0]?.model);
  } catch {
    return null;
  }
})();

export const nativeHostNotificationEvents = new Set<NativeHostNotificationEvent['event']>([
  'default_device_changed',
  'device_state_changed',
  'device_removed',
  'audio_session_disconnected',
]);

export const inactiveDeviceReasons = new Set(['disabled', 'not_present', 'unplugged', 'removed']);

export const isNativeHostNotificationEvent = (event: unknown): event is NativeHostNotificationEvent => {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return false;
  }

  const name = (event as { event?: unknown }).event;
  return typeof name === 'string' && nativeHostNotificationEvents.has(name as NativeHostNotificationEvent['event']);
};
