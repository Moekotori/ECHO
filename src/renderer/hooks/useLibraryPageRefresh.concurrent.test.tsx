// @vitest-environment jsdom
import { Suspense, startTransition, useState } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RouteActivityProvider } from '../components/ui/RouteActivityContext';
import { useLibraryPageRefresh } from './useLibraryPageRefresh';

afterEach(()=>{cleanup();vi.useRealTimers();});

it('continues refreshing the visible wall while a concurrent navigation is suspended', async () => {
  vi.useFakeTimers();
  const visible = vi.fn();
  const uncommitted = vi.fn();
  const neverReady = new Promise<void>(()=>{});
  let navigate!: ()=>void;
  const Wall = ({active}:{active:boolean}): JSX.Element => {
    useLibraryPageRefresh(active?visible:uncommitted);
    if(!active) throw neverReady;
    return <div>Visible wall</div>;
  };
  const App = (): JSX.Element => {
    const [active,setActive] = useState(true);
    navigate=()=>startTransition(()=>setActive(false));
    return <RouteActivityProvider isActive={active}><Suspense fallback={<div>Loading</div>}><Wall active={active}/></Suspense></RouteActivityProvider>;
  };
  render(<App/>);
  await act(async()=>{navigate();});
  expect(screen.getByText('Visible wall')).toBeTruthy();
  act(()=>{window.dispatchEvent(new Event('library:changed'));vi.advanceTimersByTime(120);});
  expect(visible).toHaveBeenCalledTimes(1);
  expect(uncommitted).not.toHaveBeenCalled();
});
