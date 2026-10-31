/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dismissStartupOverlayAfterStablePaint, markStartupAppMounted } from './startupOverlay';

describe('startup overlay handoff', () => {
  it('keeps auxiliary windows isolated from the main startup artwork', () => {
    const auxiliaryHtml = readFileSync(resolve(process.cwd(), 'src/renderer/auxiliary.html'), 'utf8');

    expect(auxiliaryHtml).toContain('<div id="root"></div>');
    expect(auxiliaryHtml).not.toContain('echo-startup-commission.gif');
    expect(auxiliaryHtml).not.toContain('echo-startup-shell');
  });

  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.removeAttribute('data-echo-app-mounted');
    document.documentElement.removeAttribute('data-echo-startup');
    document.body.innerHTML = `
      <div id="root">
        <div class="app-shell">
          <main class="page-surface"></main>
        </div>
      </div>
      <div class="echo-startup-shell"></div>
    `;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('marks the real application as mounted', () => {
    markStartupAppMounted();

    expect(document.documentElement.dataset.echoAppMounted).toBe('true');
  });

  it('waits for the application mount and stable paint before removing the overlay', async () => {
    const dismissal = dismissStartupOverlayAfterStablePaint();

    expect(document.documentElement.dataset.echoStartup).toBeUndefined();
    markStartupAppMounted();
    await vi.advanceTimersByTimeAsync(3_600);
    await dismissal;

    expect(document.documentElement.dataset.echoStartup).toBe('ready');
    expect(document.querySelector('.echo-startup-shell')).not.toBeNull();

    await vi.advanceTimersByTimeAsync(250);

    expect(document.querySelector('.echo-startup-shell')).toBeNull();
  });
});
