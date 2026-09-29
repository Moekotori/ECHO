// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  readStreamingQualityPreference,
  readStreamingSearchMemory,
  updateStreamingSearchMemory,
  writeStreamingQualityPreference,
} from './streamingSearchMemory';

const resetStreamingMemory = (): void => {
  window.localStorage.clear();
  updateStreamingSearchMemory({
    provider: 'netease',
    quality: 'lossless',
    activeTab: 'track',
    input: '',
    query: '',
    resultKey: null,
    result: null,
    failedCoverUrls: {},
    scrollTop: 0,
  });
  window.localStorage.clear();
};

afterEach(() => {
  resetStreamingMemory();
});

describe('streamingSearchMemory', () => {
  it('defaults streaming quality to lossless', () => {
    resetStreamingMemory();

    expect(readStreamingSearchMemory().quality).toBe('lossless');
  });

  it('persists the selected streaming quality', () => {
    updateStreamingSearchMemory({ quality: 'hires' });

    expect(window.localStorage.getItem('echo-next.streaming.quality')).toBe('hires');
    expect(readStreamingSearchMemory().quality).toBe('hires');
  });

  it('shares persisted streaming quality with other streaming views', () => {
    writeStreamingQualityPreference('high');

    expect(window.localStorage.getItem('echo-next.streaming.quality')).toBe('high');
    expect(readStreamingQualityPreference()).toBe('high');
  });

  it('restores a persisted streaming quality', () => {
    window.localStorage.setItem('echo-next.streaming.quality', 'standard');

    expect(readStreamingSearchMemory().quality).toBe('standard');
  });

  it('migrates the legacy max quality preference to lossless', () => {
    window.localStorage.setItem('echo-next.streaming.quality', 'max');

    expect(readStreamingSearchMemory().quality).toBe('lossless');
  });
});
