export const wallImageOffscreenGraceMs = 2500;

type Registration = { release: () => void; deadline: number | null };
type ObserverPool = {
  observer: IntersectionObserver;
  registrations: Map<HTMLElement, Registration>;
  timer: number | null;
};

// One observer and at most one timer per live scroll root/margin. Entries only
// hold mounted owners; their effect cleanup removes all references.
const pools = new Map<HTMLElement | null, Map<string, ObserverPool>>();

const scheduleRelease = (pool: ObserverPool): void => {
  if (pool.timer !== null) return;
  let earliest = Infinity;
  for (const registration of pool.registrations.values()) {
    if (registration.deadline !== null) earliest = Math.min(earliest, registration.deadline);
  }
  if (!Number.isFinite(earliest)) return;
  pool.timer = window.setTimeout(() => {
    pool.timer = null;
    const now = performance.now();
    for (const registration of pool.registrations.values()) {
      if (registration.deadline !== null && registration.deadline <= now) {
        registration.deadline = null;
        registration.release();
      }
    }
    scheduleRelease(pool);
  }, Math.max(0, earliest - performance.now()));
};

export const observeWallImageResidency = (
  anchor: HTMLElement,
  root: HTMLElement | null,
  rootMargin: string,
  release: () => void,
): (() => void) => {
  if (typeof window.IntersectionObserver !== 'function') return () => undefined;
  let margins = pools.get(root);
  if (!margins) {
    margins = new Map();
    pools.set(root, margins);
  }
  let pool = margins.get(rootMargin);
  if (!pool) {
    const registrations = new Map<HTMLElement, Registration>();
    const created: ObserverPool = {
      registrations,
      timer: null,
      observer: new window.IntersectionObserver((entries) => {
        for (const entry of entries) {
          const registration = registrations.get(entry.target as HTMLElement);
          if (!registration) continue;
          if (entry.isIntersecting) registration.deadline = null;
          else registration.deadline ??= performance.now() + wallImageOffscreenGraceMs;
        }
        scheduleRelease(created);
      }, { root, rootMargin }),
    };
    pool = created;
    margins.set(rootMargin, pool);
  }
  const registration: Registration = { release, deadline: null };
  pool.registrations.set(anchor, registration);
  pool.observer.observe(anchor);
  const owner = pool;
  return () => {
    if (owner.registrations.get(anchor) !== registration) return;
    owner.observer.unobserve(anchor);
    owner.registrations.delete(anchor);
    if (owner.registrations.size > 0) return;
    owner.observer.disconnect();
    if (owner.timer !== null) window.clearTimeout(owner.timer);
    owner.timer = null;
    margins.delete(rootMargin);
    if (margins.size === 0) pools.delete(root);
  };
};
