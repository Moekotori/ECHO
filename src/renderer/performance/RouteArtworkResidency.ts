const parkedSrc = 'data-echo-parked-src';
const parkedSrcset = 'data-echo-parked-srcset';
const parkedSelector = `img[${parkedSrc}], img[${parkedSrcset}]`;
const localArtwork = /^(echo-cover|echo-artist-image):\/\//;

/** Owns source attributes only while parked; never retains image nodes in a cache. */
export class RouteArtworkResidency {
  private observer: MutationObserver | null = null;

  constructor(private readonly root: HTMLElement) {}

  park = (): void => {
    if (this.observer) return;
    this.visit(this.root);
    this.observer = new MutationObserver(this.consume);
    this.observe();
  };

  restore = (): void => {
    if (!this.observer) return;
    // Restore can beat the observer microtask; first consume late React updates.
    this.consume(this.observer.takeRecords());
    this.observer.disconnect();
    this.observer = null;
    for (const image of this.root.querySelectorAll<HTMLImageElement>(parkedSelector)) {
      const src = image.getAttribute(parkedSrc);
      const srcset = image.getAttribute(parkedSrcset);
      image.removeAttribute(parkedSrc);
      image.removeAttribute(parkedSrcset);
      if (srcset) image.setAttribute('srcset', srcset);
      if (src) image.setAttribute('src', src);
    }
  };

  private observe(): void {
    this.observer?.observe(this.root, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'],
    });
  }

  private consume = (records: MutationRecord[]): void => {
    if (!this.observer || records.length === 0) return;
    // Internal removals must not be mistaken for a source removed by React.
    this.observer.disconnect();
    const changes = new Map<HTMLImageElement, Set<string>>();
    for (const record of records) {
      if (record.type !== 'attributes' || !(record.target instanceof HTMLImageElement)) continue;
      const attrs = changes.get(record.target) ?? new Set<string>();
      if (record.attributeName) attrs.add(record.attributeName);
      changes.set(record.target, attrs);
    }
    for (const [image, attrs] of changes) {
      if (!this.root.contains(image)) continue;
      if (image.hasAttribute(parkedSrc) || image.hasAttribute(parkedSrcset)) {
        if (attrs.has('src')) {
          // New artwork must not inherit the old responsive candidates.
          if (image.getAttribute('src') !== image.getAttribute(parkedSrc)) image.removeAttribute(parkedSrcset);
          image.removeAttribute(parkedSrc);
        }
        if (attrs.has('srcset')) image.removeAttribute(parkedSrcset);
      }
      this.parkImage(image);
    }
    for (const record of records) {
      if (record.type !== 'childList') continue;
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && this.root.contains(node)) this.visit(node);
      }
    }
    this.observe();
  };

  private visit(node: HTMLElement): void {
    if (node instanceof HTMLImageElement) this.parkImage(node);
    for (const image of node.querySelectorAll<HTMLImageElement>('img[src], img[srcset]')) this.parkImage(image);
  }

  private parkImage(image: HTMLImageElement): void {
    if (!image.closest('.page-surface')) return;
    const src = image.getAttribute('src');
    const srcset = image.getAttribute('srcset');
    const source = src || image.getAttribute(parkedSrc) || srcset || '';
    if (!localArtwork.test(source)) return;
    if (src) image.setAttribute(parkedSrc, src);
    if (srcset) image.setAttribute(parkedSrcset, srcset);
    image.removeAttribute('srcset');
    image.removeAttribute('src');
  }
}
