// @vitest-environment jsdom
import { useEffect, useRef, useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimatedOutlet } from './AnimatedOutlet';
import { DeferredWallImage } from '../../components/ui/DeferredWallImage';
import { useRouteActivity, useRouteResourcesActive } from '../../components/ui/RouteActivityContext';
import { retainedRouteResourceDelayMs, unfocusedRouteResourceDelayMs } from '../../performance/useRetainedRouteResources';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const advance = (ms: number): void => { act(() => vi.advanceTimersByTime(ms)); };

const ownerMounted = vi.fn();
const ownerUnmounted = vi.fn();
const Page = ({ src = 'echo-cover://thumb/one' }: { src?: string }): JSX.Element => {
  const [query, setQuery] = useState('');
  const active = useRouteActivity();
  const resources = useRouteResourcesActive();
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { ownerMounted(); return () => { ownerUnmounted(); }; }, []);
  return <>
    <input aria-label="search" value={query} onChange={event => setQuery(event.target.value)} />
    <div data-testid="scroll" ref={scroll}><details open><summary>Detail</summary>Selection</details></div>
    <output>{String(active)}:{String(resources)}</output>
    <img alt="cover" src={src} />
    <img alt="artist" src="echo-artist-image://large/one" srcSet="echo-artist-image://thumb/one 192w" />
    <img alt="remote" src="https://example.test/art.jpg" />
    <DeferredWallImage alt="priority" priority src="echo-cover://thumb/priority" />
  </>;
};
const view = (active: boolean, src?: string): JSX.Element => <AnimatedOutlet className="page-surface" hidden={!active} isActive={active} routeId="albums"><Page src={src} /></AnimatedOutlet>;

describe('retained route resources', () => {
  beforeEach(() => { ownerMounted.mockClear(); ownerUnmounted.mockClear(); });

  it('parks artwork after the grace without losing page state, then restores before return', () => {
    const { getByLabelText, getByAltText, getByTestId, container, rerender } = render(view(true));
    fireEvent.change(getByLabelText('search'), { target: { value: 'my unsaved filter' } });
    getByTestId('scroll').scrollTop = 786;
    rerender(view(false));
    advance(retainedRouteResourceDelayMs - 1);
    expect(getByAltText('cover').getAttribute('src')).toBe('echo-cover://thumb/one');
    advance(1);
    expect(container.querySelector('main')?.dataset.routeResourcesParked).toBe('true');
    expect(getByAltText('cover').hasAttribute('src')).toBe(false);
    expect(getByAltText('artist').hasAttribute('srcset')).toBe(false);
    expect(container.querySelector('img[alt="priority"]')).toBeNull();
    expect(getByAltText('remote').getAttribute('src')).toBe('https://example.test/art.jpg');
    expect(ownerUnmounted).not.toHaveBeenCalled();
    rerender(view(true));
    expect(getByAltText('cover').getAttribute('src')).toBe('echo-cover://thumb/one');
    expect(getByAltText('artist').getAttribute('srcset')).toContain('192w');
    expect(getByAltText('priority').getAttribute('src')).toBe('echo-cover://thumb/priority');
    expect((getByLabelText('search') as HTMLInputElement).value).toBe('my unsaved filter');
    expect(getByTestId('scroll').scrollTop).toBe(786);
    expect(container.querySelector('details')?.open).toBe(true);
    expect(ownerMounted).toHaveBeenCalledTimes(1);
  });

  it('keeps warm artwork on quick round trips and cancels obsolete timers', () => {
    const { getByAltText, rerender, container } = render(view(true));
    const original = getByAltText('priority');
    rerender(view(false)); advance(2000); rerender(view(true));
    advance(retainedRouteResourceDelayMs);
    expect(getByAltText('priority')).toBe(original);
    expect(container.querySelector('main')?.dataset.routeResourcesParked).toBeUndefined();
  });

  it('uses the shorter unfocused grace but never parks the foreground route', () => {
    const { getByAltText, rerender } = render(view(true));
    act(() => window.dispatchEvent(new Event('blur')));
    advance(unfocusedRouteResourceDelayMs);
    expect(getByAltText('cover').hasAttribute('src')).toBe(true);
    rerender(view(false));
    advance(unfocusedRouteResourceDelayMs - 1);
    expect(getByAltText('cover').hasAttribute('src')).toBe(true);
    advance(1);
    expect(getByAltText('cover').hasAttribute('src')).toBe(false);
  });

  it('restores the latest artwork after asynchronous updates, including an immediate return', async () => {
    const { getByAltText, rerender } = render(view(false));
    advance(retainedRouteResourceDelayMs);
    rerender(view(false, 'echo-cover://thumb/latest'));
    rerender(view(true, 'echo-cover://thumb/latest'));
    expect(getByAltText('cover').getAttribute('src')).toBe('echo-cover://thumb/latest');
    await act(async () => { await Promise.resolve(); });
    expect(getByAltText('cover').getAttribute('src')).toBe('echo-cover://thumb/latest');
  });

  it('parks late arrivals and avoids restoring stale local srcset over remote replacements', async () => {
    const { getByAltText, rerender, container } = render(view(false));
    advance(retainedRouteResourceDelayMs);
    const late = document.createElement('img');
    late.src = 'echo-cover://thumb/late';
    container.querySelector('main')!.append(late);
    const artist = getByAltText('artist');
    artist.setAttribute('src', 'https://example.test/replacement.jpg');
    await act(async () => { await Promise.resolve(); });
    expect(late.hasAttribute('src')).toBe(false);
    expect(artist.hasAttribute('srcset')).toBe(false);
    late.remove();
    rerender(view(true));
    expect(artist.getAttribute('src')).toBe('https://example.test/replacement.jpg');
    expect(artist.hasAttribute('srcset')).toBe(false);
    expect(container.querySelector('img[src="echo-cover://thumb/late"]')).toBeNull();
  });

  it('disconnects observers and cancels timers on unmount', () => {
    const { unmount } = render(view(false));
    advance(retainedRouteResourceDelayMs);
    unmount();
    expect(ownerUnmounted).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
