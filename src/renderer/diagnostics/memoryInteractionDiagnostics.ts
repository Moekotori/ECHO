type SafeSrcKind = 'echo-cover' | 'echo-image' | 'echo-artist-image' | 'data' | 'remote' | 'other' | 'empty';

type RecentUserAction = {
  atMs: number;
  type: string;
  routeId?: string;
  target?: string;
  targetClass?: string;
  detail?: string;
};

type ImageLifecycleEvent = {
  atMs: number;
  type: 'mount' | 'unmount' | 'src-change';
  routeId?: string;
  srcKind: SafeSrcKind;
  variant?: string;
  className?: string;
};

type ImageLifecycleStats = {
  mounted: number;
  unmounted: number;
  srcChanged: number;
  bySrcKind: Record<string, number>;
  byVariant: Record<string, number>;
  recentEvents: Array<Omit<ImageLifecycleEvent, 'atMs'> & { ageMs: number }>;
};

type MemoryInteractionSnapshot = {
  recentWindowMs: number;
  routeId: string | null;
  pageMode: string | null;
  userActions: {
    counts: Record<string, number>;
    recent: Array<Omit<RecentUserAction, 'atMs'> & { ageMs: number }>;
  };
  imageLifecycle: ImageLifecycleStats;
};

declare global {
  interface Window {
    __echoMemoryInteractionDiagnostics?: {
      snapshot: () => MemoryInteractionSnapshot;
    };
  }
}

const recentWindowMs = 30_000;
const maxRecentEvents = 120;

const userActions: RecentUserAction[] = [];
const imageEvents: ImageLifecycleEvent[] = [];
const lastHighFrequencyActionAt = new Map<string, number>();
let started = false;

const nowMs = (): number => Math.round(performance.now());

const prune = <T extends { atMs: number }>(events: T[], now = nowMs()): void => {
  const cutoff = now - recentWindowMs;
  while (events.length > 0 && events[0].atMs < cutoff) {
    events.shift();
  }
  if (events.length > maxRecentEvents) {
    events.splice(0, events.length - maxRecentEvents);
  }
};

const hashText = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const safeClassName = (element: Element | null): string | undefined => {
  const value = typeof element?.className === 'string' ? element.className.trim().replace(/\s+/g, '.') : '';
  return value ? value.slice(0, 96) : undefined;
};

const srcKind = (value: string | null | undefined): SafeSrcKind => {
  if (!value) {
    return 'empty';
  }
  if (value.startsWith('echo-cover://')) {
    return 'echo-cover';
  }
  if (value.startsWith('echo-image://')) {
    return 'echo-image';
  }
  if (value.startsWith('echo-artist-image://')) {
    return 'echo-artist-image';
  }
  if (value.startsWith('data:')) {
    return 'data';
  }
  if (/^https?:\/\//iu.test(value)) {
    return 'remote';
  }
  return 'other';
};

const srcVariant = (value: string | null | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (url.protocol === 'echo-cover:' || url.protocol === 'echo-artist-image:' || url.protocol === 'echo-image:') {
      return url.hostname || undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const currentRouteId = (): string | null => {
  const activeRoute = document.querySelector<HTMLElement>('[data-route-id]:not([hidden])');
  return activeRoute?.dataset.routeId ?? document.querySelector<HTMLElement>('.lyrics-page')?.dataset.viewMode ?? null;
};

const currentPageMode = (): string | null => {
  const lyricsPage = document.querySelector<HTMLElement>('.lyrics-page');
  if (lyricsPage) {
    return lyricsPage.dataset.viewMode ? `lyrics:${lyricsPage.dataset.viewMode}` : 'lyrics';
  }
  const settingsSection = document.querySelector<HTMLElement>('.settings-section.is-active, [data-settings-section][data-active="true"]');
  if (settingsSection?.dataset.settingsSection) {
    return `settings:${settingsSection.dataset.settingsSection}`;
  }
  const albumDetail = document.querySelector('.album-detail-page');
  if (albumDetail) {
    return 'album-detail';
  }
  const artistDetail = document.querySelector('.artist-detail-page');
  if (artistDetail) {
    return 'artist-detail';
  }
  return null;
};

const pushUserAction = (event: RecentUserAction): void => {
  userActions.push(event);
  prune(userActions, event.atMs);
};

const pushImageEvent = (event: ImageLifecycleEvent): void => {
  imageEvents.push(event);
  prune(imageEvents, event.atMs);
};

const recordImage = (image: HTMLImageElement, type: ImageLifecycleEvent['type']): void => {
  const src = image.currentSrc || image.src || image.getAttribute('src') || '';
  pushImageEvent({
    atMs: nowMs(),
    type,
    routeId: currentRouteId() ?? undefined,
    srcKind: srcKind(src),
    variant: srcVariant(src),
    className: safeClassName(image),
  });
};

const describeTarget = (target: EventTarget | null): Pick<RecentUserAction, 'target' | 'targetClass'> => {
  if (!(target instanceof Element)) {
    return {};
  }
  const interactive = target.closest<HTMLElement>('button, a, input, select, textarea, [role="button"], [data-route-id]');
  const tag = interactive?.tagName.toLowerCase() ?? target.tagName.toLowerCase();
  const role = interactive?.getAttribute('role');
  const routeId = interactive?.getAttribute('data-route-id');
  const aria = interactive?.getAttribute('aria-label') || interactive?.getAttribute('title') || '';
  const targetLabel = [
    tag,
    role ? `role:${role}` : null,
    routeId ? `route:${routeId}` : null,
    aria ? `label#${hashText(aria)}` : null,
  ].filter(Boolean).join('/');

  return {
    target: targetLabel || undefined,
    targetClass: safeClassName(interactive ?? target),
  };
};

const actionDetail = (event: Event): string | undefined => {
  if (!(event instanceof CustomEvent)) {
    return undefined;
  }
  const detail = event.detail;
  if (typeof detail === 'string') {
    return detail.length <= 80 ? detail : `text#${hashText(detail)}`;
  }
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const record = detail as Record<string, unknown>;
    const mode = typeof record.mode === 'string' ? `mode:${record.mode}` : null;
    const route = typeof record.route === 'string' ? `route:${record.route}` : null;
    const section = typeof record.section === 'string' ? `section:${record.section}` : null;
    const targetId = typeof record.targetId === 'string' ? `target#${hashText(record.targetId)}` : null;
    return [mode, route, section, targetId].filter(Boolean).join(', ') || 'object';
  }
  return undefined;
};

const recordUserEvent = (event: Event, type = event.type): void => {
  if (type === 'scroll' || type === 'wheel' || type === 'keydown' || type === 'input') {
    const now = nowMs();
    const lastAt = lastHighFrequencyActionAt.get(type) ?? 0;
    if (now - lastAt < 500) {
      return;
    }
    lastHighFrequencyActionAt.set(type, now);
  }

  pushUserAction({
    atMs: nowMs(),
    type,
    routeId: currentRouteId() ?? undefined,
    ...describeTarget(event.target),
    detail: actionDetail(event),
  });
};

const increment = (record: Record<string, number>, key: string | undefined, by = 1): void => {
  const normalized = key?.trim() || 'unknown';
  record[normalized] = (record[normalized] ?? 0) + by;
};

const snapshot = (): MemoryInteractionSnapshot => {
  const now = nowMs();
  prune(userActions, now);
  prune(imageEvents, now);

  const actionCounts: Record<string, number> = {};
  for (const action of userActions) {
    increment(actionCounts, action.type);
  }

  const imageLifecycle: ImageLifecycleStats = {
    mounted: 0,
    unmounted: 0,
    srcChanged: 0,
    bySrcKind: {},
    byVariant: {},
    recentEvents: imageEvents.slice(-40).map(({ atMs, ...event }) => ({
      ...event,
      ageMs: Math.max(0, now - atMs),
    })),
  };

  for (const event of imageEvents) {
    if (event.type === 'mount') {
      imageLifecycle.mounted += 1;
    } else if (event.type === 'unmount') {
      imageLifecycle.unmounted += 1;
    } else if (event.type === 'src-change') {
      imageLifecycle.srcChanged += 1;
    }
    increment(imageLifecycle.bySrcKind, event.srcKind);
    increment(imageLifecycle.byVariant, event.variant ?? event.srcKind);
  }

  return {
    recentWindowMs,
    routeId: currentRouteId(),
    pageMode: currentPageMode(),
    userActions: {
      counts: actionCounts,
      recent: userActions.slice(-40).map(({ atMs, ...event }) => ({
        ...event,
        ageMs: Math.max(0, now - atMs),
      })),
    },
    imageLifecycle,
  };
};

export const startMemoryInteractionDiagnostics = (): void => {
  if (started || typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  started = true;
  window.__echoMemoryInteractionDiagnostics = { snapshot };

  for (const type of ['click', 'dblclick', 'contextmenu', 'input', 'change', 'keydown', 'wheel']) {
    document.addEventListener(type, (event) => recordUserEvent(event), { capture: true, passive: true });
  }
  document.addEventListener('scroll', (event) => recordUserEvent(event, 'scroll'), { capture: true, passive: true });

  for (const type of [
    'app:navigate:route',
    'app:navigate:lyrics',
    'app:navigate:lyrics-back',
    'app:navigate:album-detail',
    'app:navigate:artist-detail',
    'app:navigate:settings',
    'app:navigate:settings-section',
    'app:navigate:queue',
    'app:navigate:songs',
  ]) {
    window.addEventListener(type, (event) => recordUserEvent(event, type));
  }

  if (typeof MutationObserver !== 'function') {
    return;
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'src' && mutation.target instanceof HTMLImageElement) {
        recordImage(mutation.target, 'src-change');
        continue;
      }

      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLImageElement) {
          recordImage(node, 'mount');
        } else if (node instanceof Element) {
          node.querySelectorAll('img').forEach((image) => recordImage(image, 'mount'));
        }
      }
      for (const node of mutation.removedNodes) {
        if (node instanceof HTMLImageElement) {
          recordImage(node, 'unmount');
        } else if (node instanceof Element) {
          node.querySelectorAll('img').forEach((image) => recordImage(image, 'unmount'));
        }
      }
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['src'],
    childList: true,
    subtree: true,
  });
};
