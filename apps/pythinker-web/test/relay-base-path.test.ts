// apps/pythinker-web/test/relay-base-path.test.ts
// The Remote Control tunnel serves the SPA under /devices/<id> and sets the
// prefix as a page global. API and public-asset URLs must keep the prefix, and
// nothing about the device may be persisted on the shared relay origin.

import { afterEach, describe, expect, it } from 'vitest';

import { normalizeServerOrigin, publicAssetUrl, relayBasePath } from '../src/api/config';
import { safeGetString, safeSetString } from '../src/lib/storage';

const PREFIX = '/devices/YyUgTPO2EMfinzL0weAjG4LhszMYVS5wW2Pz5Bus1D4';

function serveAt(path: string, prefix?: string): void {
  window.history.replaceState(null, '', path);
  window.__PYTHINKER_RELAY_PREFIX__ = prefix;
}

describe('relay base path', () => {
  afterEach(() => {
    serveAt('/');
    window.localStorage.clear();
  });

  it('keeps the relay prefix for the API origin and public assets', () => {
    serveAt(`${PREFIX}/`, PREFIX);
    expect(relayBasePath()).toBe(PREFIX);
    expect(normalizeServerOrigin(undefined)).toBe(`${window.location.origin}${PREFIX}`);
    expect(publicAssetUrl('/brand/icon.svg')).toBe(`${PREFIX}/brand/icon.svg`);
  });

  it('uses the plain origin when the page is served directly', () => {
    serveAt('/');
    expect(relayBasePath()).toBe('');
    expect(normalizeServerOrigin(undefined)).toBe(window.location.origin);
    expect(publicAssetUrl('/logo.png')).toBe('/logo.png');
  });

  it('ignores a prefix the page is not under, or one that is not a path', () => {
    serveAt('/elsewhere', PREFIX);
    expect(relayBasePath()).toBe('');
    serveAt(`${PREFIX}/`, `https://other.example.test${PREFIX}`);
    expect(relayBasePath()).toBe('');
  });

  it('does not read a prefix left in sessionStorage by an older tunnel', () => {
    window.sessionStorage.setItem('pythinker-desktop-server-origin', `${window.location.origin}${PREFIX}`);
    serveAt(`${PREFIX}/`);
    expect(relayBasePath()).toBe('');
    window.sessionStorage.clear();
  });

  it('keeps app state in memory behind the relay and in localStorage otherwise', () => {
    serveAt(`${PREFIX}/`, PREFIX);
    safeSetString('pythinker-web.input-history', 'secret prompt');
    expect(safeGetString('pythinker-web.input-history')).toBe('secret prompt');
    expect(window.localStorage.getItem('pythinker-web.input-history')).toBeNull();

    serveAt('/');
    safeSetString('pythinker-web.theme', 'dark');
    expect(window.localStorage.getItem('pythinker-web.theme')).toBe('dark');
  });
});
