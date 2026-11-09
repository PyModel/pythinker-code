// apps/pythinker-web/src/composables/useBodyScrollLock.ts
// Counter-based body scroll lock: any number of overlays (lightbox, sheets,
// dialogs) can hold the lock simultaneously, and the body only unlocks when
// the last holder releases.

let lockCount = 0;
let savedOverflow: string | null = null;

export function useBodyScrollLock() {
  function lock(): void {
    if (typeof document === 'undefined') return;
    lockCount += 1;
    if (lockCount === 1) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
  }

  function unlock(): void {
    if (lockCount <= 0) return;
    lockCount -= 1;
    if (lockCount === 0 && typeof document !== 'undefined') {
      document.body.style.overflow = savedOverflow ?? '';
      savedOverflow = null;
    }
  }

  return { lock, unlock };
}