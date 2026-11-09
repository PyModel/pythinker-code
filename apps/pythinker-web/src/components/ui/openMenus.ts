import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';

const openMenuCount = ref(0);
const openMenus = new Set<HTMLElement>();

export const hasOpenMenu = computed(() => openMenuCount.value > 0);

export function registerOpenMenu(element: HTMLElement): () => void {
  openMenus.add(element);
  openMenuCount.value += 1;
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    if (openMenus.delete(element)) openMenuCount.value -= 1;
  };
}

export function useOpenMenu(element: Ref<HTMLElement | null | undefined>): void {
  let unregister: (() => void) | undefined;
  watch(element, (next) => {
    unregister?.();
    unregister = next ? registerOpenMenu(next) : undefined;
  }, { immediate: true, flush: 'post' });
  onBeforeUnmount(() => unregister?.());
}

export function isInsideOpenMenu(element: Element | null): boolean {
  if (element === null) return false;
  for (const menu of openMenus) {
    if (menu === element || menu.contains(element)) return true;
  }
  return false;
}
