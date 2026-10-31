// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useCommittedCallback } from './useCommittedCallback';

afterEach(cleanup);

it('keeps one callback while reading the latest committed values', () => {
  const { result, rerender } = renderHook(({ value }) =>
    useCommittedCallback((increment: number) => value + increment), { initialProps: { value: 1 } });
  const callback = result.current;
  for (let value = 2; value < 20; value += 1) {
    rerender({ value });
    expect(result.current).toBe(callback);
    expect(callback(3)).toBe(value + 3);
  }
});
