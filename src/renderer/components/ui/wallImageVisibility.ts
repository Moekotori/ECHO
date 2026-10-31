type Registration = {
  notify: (entry: IntersectionObserverEntry) => void;
  registeredAt: number;
};
type ObserverPool = {
  observer: IntersectionObserver;
  registrations: Map<Element, Set<Registration>>;
};

// Only mounted owners remain registered; the final owner releases the pool.
const pools = new Map<HTMLElement | null, Map<string, ObserverPool>>();

export const observeWallImageVisibility = (
  anchor: HTMLElement,
  root: HTMLElement | null,
  rootMargin: string,
  notify: (entry: IntersectionObserverEntry) => void,
): (() => void) => {
  let margins = pools.get(root);
  if (!margins) {
    margins = new Map();
  }
  let pool = margins.get(rootMargin);
  if (!pool) {
    const registrations = new Map<Element, Set<Registration>>();
    pool = {
      registrations,
      observer: new window.IntersectionObserver((entries) => {
        for (const entry of entries) {
          const owners = registrations.get(entry.target);
          if (!owners) continue;
          for (const owner of [...owners]) {
            // An old queued entry must not load a new src reusing the same anchor.
            if (!owners.has(owner) || (Number.isFinite(entry.time) && entry.time < owner.registeredAt)) continue;
            owner.notify(entry);
          }
        }
      }, { root, rootMargin }),
    };
    margins.set(rootMargin, pool);
    pools.set(root, margins);
  }
  const registration: Registration = { notify, registeredAt: performance.now() };
  let owners = pool.registrations.get(anchor);
  if (!owners) {
    owners = new Set();
    pool.registrations.set(anchor, owners);
    owners.add(registration);
    pool.observer.observe(anchor);
  } else {
    owners.add(registration);
  }
  const owner = pool;
  const callbacks = owners;
  return () => {
    if (!callbacks.delete(registration)) return;
    if (callbacks.size === 0) {
      owner.registrations.delete(anchor);
      owner.observer.unobserve(anchor);
    }
    if (owner.registrations.size > 0) return;
    owner.observer.disconnect();
    margins.delete(rootMargin);
    if (margins.size === 0) pools.delete(root);
  };
};
