// apps/pythinker-web/test/relay-base-path.test.ts
// The Remote Control relay serves the SPA under /devices/<id> and records that
// prefix in sessionStorage. API and public-asset URLs must keep the prefix.

import { afterEach, describe, expect, it } from 'vitest';

import { normalizeServerOrigin, publicAssetUrl, relayBasePath } from '../src/api/config';

const KEY = 'pythinker-desktop-server-origin';
const PREFIX = '/devices/00000000-0000-4000-8000-000000000000';

function serveAt(path: string, recorded?: string): void {
  window.history.replaceState(null, '', path);
  if (recorded === undefined) window.sessionStorage.removeItem(KEY);
  else window.sessionStorage.setItem(KEY, recorded);
}

describe('relay base path', () => {
  afterEach(() => serveAt('/'));

  it('keeps the relay prefix for the API origin and public assets', () => {
    serveAt(`${PREFIX}/`, `${window.location.origin}${PREFIX}`);
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

  it('ignores a recorded prefix for another origin or another page', () => {
    serveAt(`${PREFIX}/`, `https://other.example.test${PREFIX}`);
    expect(relayBasePath()).toBe('');
    serveAt('/elsewhere', `${window.location.origin}${PREFIX}`);
    expect(relayBasePath()).toBe('');
  });
});
