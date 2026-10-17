// apps/pythinker-web/src/lib/relayPrefix.ts
// The Remote Control tunnel serves this SPA under `/devices/<id>` and sets
// `window.__PYTHINKER_RELAY_PREFIX__` before the bundle runs. It lives only in
// this page: a stored copy would let a later page on the shared relay origin
// read this machine's device id. Only trust it when the page is under it.
export function relayBasePath(): string {
  if (typeof window === 'undefined' || !window.location?.origin) return '';
  const recorded = window.__PYTHINKER_RELAY_PREFIX__;
  if (typeof recorded !== 'string' || !recorded.startsWith('/')) return '';
  const prefix = recorded.replace(/\/+$/, '');
  const path = window.location.pathname;
  return prefix !== '' && (path === prefix || path.startsWith(`${prefix}/`)) ? prefix : '';
}
