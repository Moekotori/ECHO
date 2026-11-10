import { useEffect, type RefObject } from 'react';

const focusableSelector = 'button, a[href], input, select, textarea, summary, [tabindex]';

// Operates only on the mounted dialog DOM. No document observer, persistent
// registry, or background polling; listeners and the opening frame are released.
export const useDialogFocus = (ref: RefObject<HTMLElement>, open: boolean): void => {
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let dialog: HTMLElement | null = null;
    const candidates = (): HTMLElement[] => Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
      .filter((node) => {
        const collapsed = node.closest('details:not([open])');
        return (!collapsed || collapsed.querySelector('summary')?.contains(node))
        && node.tabIndex >= 0 && !node.matches(':disabled')
        && !node.closest('[hidden], [inert], [aria-hidden="true"]')
        && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden';
      });
    const frame = window.requestAnimationFrame(() => {
      dialog = ref.current;
      (dialog?.querySelector<HTMLElement>('[data-dialog-autofocus="true"]') ?? candidates()[0] ?? dialog)?.focus({ preventScroll: true });
    });
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      dialog = ref.current;
      if (!dialog) return;
      const activeDialog = document.activeElement?.closest('[role="dialog"][aria-modal="true"]');
      // A nested dialog (for example global search above the queue) owns its
      // own keyboard focus until it closes.
      if (activeDialog && activeDialog !== dialog) return;
      const nodes = candidates();
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first) {
        event.preventDefault();
        dialog.focus();
      } else if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)
        || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKey);
      if (previous?.isConnected && (!document.activeElement || document.activeElement === document.body
        || dialog?.contains(document.activeElement))) previous.focus({ preventScroll: true });
    };
  }, [open, ref]);
};
