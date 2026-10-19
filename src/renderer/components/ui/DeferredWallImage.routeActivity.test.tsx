// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DeferredWallImage } from './DeferredWallImage';
import { RouteActivityProvider } from './RouteActivityContext';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('keeps ordinary loaded covers warm while the page is hidden, instead of treating hiding as scrolling away', () => {
  vi.useFakeTimers();
  const observers: Array<{ callback: IntersectionObserverCallback; options?: IntersectionObserverInit }> = [];
  vi.stubGlobal('IntersectionObserver', class {
    observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn();
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { observers.push({callback,options}); }
  });
  const view = (active: boolean): JSX.Element => <RouteActivityProvider isActive={active} resourcesActive><DeferredWallImage alt="cover" src="echo-cover://thumb/one" /></RouteActivityProvider>;
  const { container, rerender } = render(view(true));
  const anchor = container.querySelector('span')!;
  const notify = (observer: typeof observers[number], inside: boolean): void => {
    act(() => observer.callback([{target:anchor,isIntersecting:inside,time:performance.now(),boundingClientRect:anchor.getBoundingClientRect(),intersectionRect:anchor.getBoundingClientRect(),intersectionRatio:inside?1:0,rootBounds:null}],{} as IntersectionObserver));
  };
  notify(observers.find(item=>item.options?.rootMargin==='0px')!,true);
  const original = container.querySelector('img');
  expect(original).not.toBeNull();
  const residency = observers.find(item=>item.options?.rootMargin==='1120px 0px')!;
  rerender(view(false));
  notify(residency,false);
  act(()=>vi.advanceTimersByTime(3000));
  expect(container.querySelector('img')).toBe(original);
  rerender(view(true));
  expect(container.querySelector('img')).toBe(original);
});

it('cancels queued image starts on navigation away and resumes them on return', () => {
  const view = (active: boolean): JSX.Element => <RouteActivityProvider isActive={active} resourcesActive>{Array.from({length:12},(_,index)=><DeferredWallImage key={index} alt="" src={`echo-cover://thumb/queue-${index}`} />)}</RouteActivityProvider>;
  const { container, rerender } = render(view(true));
  expect(container.querySelectorAll('img')).toHaveLength(8);
  rerender(view(false));
  act(()=>container.querySelectorAll('img').forEach(image=>fireEvent.load(image)));
  expect(container.querySelectorAll('img')).toHaveLength(8);
  rerender(view(true));
  expect(container.querySelectorAll('img')).toHaveLength(12);
});
