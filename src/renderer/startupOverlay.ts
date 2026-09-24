const startupOverlaySelector = '.echo-startup-shell';
const appMountedEventName = 'echo:startup-app-mounted';
const appMountFallbackMs = 1_500;
const mainSurfaceFallbackMs = 8_000;
const minimumStartupVisibleMs = 3_600;
const overlayTransitionFallbackMs = 250;

const waitForAnimationFrame = (): Promise<void> =>
  new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

const waitForAppMount = async (): Promise<void> => {
  if (document.documentElement.dataset.echoAppMounted === 'true') {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;

    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener(appMountedEventName, finish);
      window.clearTimeout(fallbackTimer);
      resolve();
    };

    const fallbackTimer = window.setTimeout(finish, appMountFallbackMs);
    window.addEventListener(appMountedEventName, finish, { once: true });
  });
};

const isMainSurfaceReady = (): boolean => {
  const appShell = document.querySelector<HTMLElement>('.app-shell');
  const activePage = Array.from(document.querySelectorAll<HTMLElement>('.page-surface'))
    .find((page) => !page.hidden);

  return Boolean(
    appShell &&
    activePage &&
    !activePage.querySelector('.route-loading-card'),
  );
};

const waitForMainSurface = async (): Promise<void> => {
  if (isMainSurfaceReady()) {
    return;
  }

  await new Promise<void>((resolve) => {
    const root = document.getElementById('root');
    if (!root) {
      resolve();
      return;
    }

    let settled = false;
    const observer = new MutationObserver(() => {
      if (isMainSurfaceReady()) {
        finish();
      }
    });

    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      observer.disconnect();
      window.clearTimeout(fallbackTimer);
      resolve();
    };

    const fallbackTimer = window.setTimeout(finish, mainSurfaceFallbackMs);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['class', 'hidden'],
      childList: true,
      subtree: true,
    });
  });
};

const waitForMinimumVisibleDuration = async (): Promise<void> => {
  const shownAt = Number(document.documentElement.dataset.echoStartupShownAt);
  const elapsedMs = Number.isFinite(shownAt) ? Date.now() - shownAt : 0;
  const remainingMs = Math.max(0, minimumStartupVisibleMs - elapsedMs);

  if (remainingMs > 0) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, remainingMs);
    });
  }
};

export const markStartupAppMounted = (): void => {
  document.documentElement.dataset.echoAppMounted = 'true';
  window.dispatchEvent(new Event(appMountedEventName));
};

export const dismissStartupOverlayAfterStablePaint = async (): Promise<void> => {
  const overlay = document.querySelector<HTMLElement>(startupOverlaySelector);
  if (!overlay) {
    return;
  }

  await waitForAppMount();
  await Promise.all([
    waitForMainSurface(),
    waitForMinimumVisibleDuration(),
    document.fonts?.ready.catch(() => undefined) ?? Promise.resolve(),
  ]);
  await waitForAnimationFrame();
  await waitForAnimationFrame();

  document.documentElement.dataset.echoStartup = 'ready';

  const removeOverlay = (): void => {
    overlay.removeEventListener('transitionend', handleOverlayTransitionEnd);
    overlay.remove();
  };

  const handleOverlayTransitionEnd = (event: TransitionEvent): void => {
    if (event.target === overlay && event.propertyName === 'opacity') {
      removeOverlay();
    }
  };

  overlay.addEventListener('transitionend', handleOverlayTransitionEnd);
  window.setTimeout(removeOverlay, overlayTransitionFallbackMs);
};
