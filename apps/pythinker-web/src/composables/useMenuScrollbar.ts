// apps/pythinker-web/src/composables/useMenuScrollbar.ts
// Shared scroll affordances for the composer popup menus (mention / slash):
// a custom drag-able scrollbar thumb, edge-fade mask over the scroller, and a
// viewport-aware max-height so the popup never overflows above the composer.
// The tokens it reads (--menu-*, --p-*-menu-h) are defined in src/style.css.
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type ComputedRef, type Ref } from 'vue';

export interface MenuScrollbarOptions {
  /** The popup root (positioned ancestor of the scroller). */
  menuEl: Ref<HTMLElement | null>;
  /** The scrollable list container. */
  scrollEl: Ref<HTMLElement | null>;
  /** The max-height CSS variable on the scroller (e.g. `--p-mention-menu-h`). */
  maxHeightVar: string;
  /** Index of the active option — kept scrolled into view on changes. */
  activeIndex?: Ref<number>;
  /** Re-measure when this reference changes identity (e.g. the items array). */
  refreshKey?: Ref<unknown>;
}

export interface MenuScrollbarState {
  /** Edges of the scroller (scrollTop vs bottom) — drives the fade mask. */
  atTop: Ref<boolean>;
  atBottom: Ref<boolean>;
  /** The custom scrollbar thumb geometry (null when the list fits). */
  thumb: Ref<{ top: number; height: number } | null>;
  /** Inline styles for the scroll container (mask + fitted max height). */
  scrollStyle: ComputedRef<Record<string, string> | undefined>;
  /** Inline styles for the scrollbar thumb. */
  thumbStyle: ComputedRef<Record<string, string> | undefined>;
  /** Scroll handler for the container. */
  onScroll: () => void;
  /** Pointer-down handler for the thumb. */
  onThumbPointerDown: (event: PointerEvent) => void;
}

/** Read a length-ish custom property from an element's computed style. */
function readVar(el: HTMLElement, name: string, fallback: number): number {
  const value = getComputedStyle(el).getPropertyValue(name);
  const parsed = value ? parseFloat(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function useMenuScrollbar(options: MenuScrollbarOptions): MenuScrollbarState {
  const { menuEl, scrollEl, maxHeightVar, activeIndex, refreshKey } = options;

  const atTop = ref(false);
  const atBottom = ref(false);
  const thumb = ref<{ top: number; height: number } | null>(null);
  const maxHeight = ref('');

  function update(): void {
    const el = scrollEl.value;
    if (!el) return;
    atTop.value = el.scrollTop > 0;
    atBottom.value = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight + 1) {
      thumb.value = null;
      return;
    }
    const inset = readVar(el, '--menu-scrollbar-track-inset', 0);
    const minThumb = readVar(el, '--menu-scrollbar-thumb-min', 24);
    const track = clientHeight - inset * 2;
    const height = Math.max(minThumb, (clientHeight / scrollHeight) * track);
    const range = scrollHeight - clientHeight;
    const top = el.offsetTop + inset + (scrollTop / range) * (track - height);
    thumb.value = { top, height };
  }

  const scrollStyle = computed<Record<string, string> | undefined>(() => {
    const style: Record<string, string> = {};
    const fade = 'var(--menu-scroll-fade)';
    let mask: string | undefined;
    if (atTop.value && atBottom.value) {
      mask = `linear-gradient(to bottom, transparent 0, black ${fade}, black calc(100% - ${fade}), transparent 100%)`;
    } else if (atTop.value) {
      mask = `linear-gradient(to bottom, transparent, black ${fade})`;
    } else if (atBottom.value) {
      mask = `linear-gradient(to top, transparent, black ${fade})`;
    }
    if (mask) {
      style.maskImage = mask;
      style.WebkitMaskImage = mask;
    }
    if (maxHeight.value) style.maxHeight = maxHeight.value;
    return Object.keys(style).length > 0 ? style : undefined;
  });

  const thumbStyle = computed<Record<string, string> | undefined>(() => {
    const t = thumb.value;
    return t ? { top: `${t.top}px`, height: `${t.height}px` } : undefined;
  });

  function fitHeight(): void {
    const menu = menuEl.value;
    const scroll = scrollEl.value;
    const anchor = menu?.offsetParent;
    if (!menu || !scroll || !anchor) return;
    const cs = getComputedStyle(menu);
    const gap = readVar(menu, '--space-2', 8);
    const padding = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const cap = readVar(scroll, maxHeightVar, Number.POSITIVE_INFINITY);
    const viewportTop = window.visualViewport?.offsetTop ?? 0;
    const available = anchor.getBoundingClientRect().top - viewportTop - gap - padding;
    maxHeight.value = `${Math.max(Math.floor(Math.min(cap, available)), 0)}px`;
    void nextTick(update);
  }

  /** Keep the active option visible inside the scroller. */
  function scrollActiveIntoView(): void {
    const el = scrollEl.value;
    if (!el) return;
    const option = el.querySelectorAll<HTMLElement>('[role="option"]')[activeIndex?.value ?? -1];
    if (!option) return;
    const box = el.getBoundingClientRect();
    const opt = option.getBoundingClientRect();
    const top = opt.top - box.top + el.scrollTop;
    const bottom = top + opt.height;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }

  // Dragging the thumb scrolls the list proportionally.
  let dragCancel: (() => void) | null = null;

  function onThumbPointerDown(event: PointerEvent): void {
    const el = scrollEl.value;
    const t = thumb.value;
    if (!el || !t) return;
    event.preventDefault();
    dragCancel?.();
    const pointerId = event.pointerId;
    const target = event.target instanceof Element ? event.target : null;
    target?.setPointerCapture?.(pointerId);
    const inset = readVar(el, '--menu-scrollbar-track-inset', 0);
    const track = el.clientHeight - inset * 2 - t.height;
    const range = el.scrollHeight - el.clientHeight;
    const startY = event.clientY;
    const startScrollTop = el.scrollTop;
    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId || track <= 0) return;
      el.scrollTop = startScrollTop + ((ev.clientY - startY) / track) * range;
    };
    const onEnd = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return;
      dragCancel?.();
    };
    const cancel = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      dragCancel = null;
    };
    dragCancel = cancel;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }

  let resizeObserver: ResizeObserver | null = null;

  onMounted(() => {
    if (typeof ResizeObserver === 'function' && scrollEl.value) {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === scrollEl.value) update();
          else fitHeight();
        }
      });
      resizeObserver.observe(scrollEl.value);
      const anchor = menuEl.value?.offsetParent;
      if (anchor) resizeObserver.observe(anchor);
    }
    window.addEventListener('resize', fitHeight);
    window.visualViewport?.addEventListener('resize', fitHeight);
    window.visualViewport?.addEventListener('scroll', fitHeight);
    fitHeight();
    update();
  });

  onUnmounted(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    dragCancel?.();
    window.removeEventListener('resize', fitHeight);
    window.visualViewport?.removeEventListener('resize', fitHeight);
    window.visualViewport?.removeEventListener('scroll', fitHeight);
  });

  watch(
    () => [activeIndex?.value, refreshKey?.value],
    () => {
      void nextTick(() => {
        update();
        scrollActiveIntoView();
      });
    },
  );

  return { atTop, atBottom, thumb, scrollStyle, thumbStyle, onScroll: update, onThumbPointerDown };
}