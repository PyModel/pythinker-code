import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createPythinkerDefaultHeaders,
  createPythinkerDeviceId,
  createPythinkerUserAgent,
  readPythinkerDeviceId,
} from '../src/identity';

const tmpRoots: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pythinker-oauth-identity-'));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Pythinker identity factories', () => {
  it('creates and reuses a device id in the explicit homeDir', () => {
    const homeDir = tempHome();
    const first = createPythinkerDeviceId(homeDir);
    const second = createPythinkerDeviceId(homeDir);

    expect(first).toMatch(/^[0-9a-f-]+$/);
    expect(second).toBe(first);
  });

  it('creates different device ids for different homeDir values', () => {
    const first = createPythinkerDeviceId(tempHome());
    const second = createPythinkerDeviceId(tempHome());

    expect(second).not.toBe(first);
  });

  it('reads an existing device id without creating one when missing', () => {
    const homeDir = tempHome();

    expect(readPythinkerDeviceId(homeDir)).toBeNull();
    expect(readPythinkerDeviceId(homeDir)).toBeNull();

    const first = createPythinkerDeviceId(homeDir);
    expect(readPythinkerDeviceId(homeDir)).toBe(first);
  });

  it('treats an empty device id file as missing', () => {
    const homeDir = tempHome();
    writeFileSync(join(homeDir, 'device_id'), '  \n', 'utf-8');

    expect(readPythinkerDeviceId(homeDir)).toBeNull();
  });

  it('creates pythinker-code-cli User-Agent and appends suffix only to UA', () => {
    expect(
      createPythinkerUserAgent({
        productName: 'pythinker-code-cli',
        version: '1.2.3',
      }),
    ).toBe('pythinker-code-cli/1.2.3');
    expect(
      createPythinkerUserAgent({
        productName: 'pythinker-code-cli',
        version: '1.2.3',
        userAgentSuffix: 'wire 4.5.6',
      }),
    ).toBe('pythinker-code-cli/1.2.3 (wire 4.5.6)');
  });

  it('keeps default headers to the User-Agent — no device identity headers', () => {
    const headers = createPythinkerDefaultHeaders({
      homeDir: tempHome(),
      productName: 'pythinker-code-cli',
      version: '1.2.3',
      platform: 'pythinker_code_cli',
    });

    expect(headers['User-Agent']).toBe('pythinker-code-cli/1.2.3');
    expect(Object.keys(headers)).toEqual(['User-Agent']);
  });
});

// HTTP header values must be plain ASCII without leading/trailing whitespace.
describe('ascii header value sanitization', () => {
  it('strips a trailing newline from a header value', () => {
    const ua = createPythinkerUserAgent({ productName: 'pythinker-code-cli', version: '6.8.0-101\n' });
    expect(ua).toBe('pythinker-code-cli/6.8.0-101');
  });

  it('drops non-ASCII codepoints while keeping the ASCII remainder', () => {
    const ua = createPythinkerUserAgent({ productName: 'pythinker-code-cli', version: 'héllo' });
    expect(ua).toBe('pythinker-code-cli/hllo');
  });
});
