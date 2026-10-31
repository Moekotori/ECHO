// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
import type { LibraryTrack } from '../../shared/types/library';
import { RouteActivityProvider } from '../components/ui/RouteActivityContext';
import { useRemoteCoverPreloader } from './useRemoteCoverPreloader';

vi.mock('../utils/echoBridge', () => ({ getAppBridge: () => undefined }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('stops hidden route preloads and restarts unfinished requests when returning', () => {
  vi.useFakeTimers();
  const images: Array<{ src: string; onload: unknown; onerror: unknown }> = [];
  vi.stubGlobal('Image', class {
    src = ''; onload = null; onerror = null;
    removeAttribute(): void { this.src = ''; }
    constructor() { images.push(this); }
  });
  let active = true;
  const wrapper = ({ children }: PropsWithChildren): JSX.Element => <RouteActivityProvider isActive={active}>{children}</RouteActivityProvider>;
  const tracks = [{ id: 'activity-cover', mediaType: 'remote', coverThumb: 'echo-image://subsonic-cover/activity-cover' }] as LibraryTrack[];
  const options = { active: true, tracks, visibleTrackIds: ['activity-cover'] };
  const { rerender } = renderHook(() => useRemoteCoverPreloader(options), { wrapper });
  act(() => vi.advanceTimersByTime(120));
  expect(images).toHaveLength(1);
  expect(images[0].src).toBe(tracks[0].coverThumb);
  active = false; rerender();
  expect(images[0].src).toBe('');
  expect(images[0].onload).toBeNull();
  act(() => vi.advanceTimersByTime(5000));
  expect(images).toHaveLength(1);
  active = true; rerender();
  act(() => vi.advanceTimersByTime(120));
  expect(images).toHaveLength(2);
  expect(images[1].src).toBe(tracks[0].coverThumb);
});
