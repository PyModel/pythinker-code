import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { startVisServer } from '../../src/start';

let stop: (() => Promise<void>) | null = null;
let temporaryHome: string | null = null;
afterEach(async () => {
  if (stop) await stop();
  if (temporaryHome) await rm(temporaryHome, { recursive: true, force: true });
  stop = null;
  temporaryHome = null;
});

async function missingHome(): Promise<string> {
  temporaryHome = await mkdtemp(join(tmpdir(), 'vis-start-'));
  return join(temporaryHome, 'missing');
}

describe('startVisServer', () => {
  it('serves the embedded web asset and the API on an auto-picked port', async () => {
    const html = '<!doctype html><title>vis</title>';
    const homeDir = await missingHome();
    const server = await startVisServer({
      port: 0,                               // auto-pick
      homeDir,
      webAsset: { gzipped: new Uint8Array(gzipSync(Buffer.from(html))) },
    });
    stop = server.close;
    expect(server.port).toBeGreaterThan(0);

    const page = await fetch(`${server.url}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('<title>vis</title>'); // fetch auto-inflates gzip

    const spa = await fetch(`${server.url}sessions/anything`);
    expect(await spa.text()).toContain('<title>vis</title>'); // SPA fallback

    const api = await fetch(`${server.url}api/sessions`);
    expect(api.status).toBe(200); // empty list for a missing home, not a crash
  });

  it('rejects instead of hanging when the port is already bound', async () => {
    const homeDir = await missingHome();
    const first = await startVisServer({ port: 0, homeDir });
    stop = first.close;
    const taken = first.port;

    // A second bind on the same port must REJECT (EADDRINUSE), not hang
    // forever or escape as an uncaughtException.
    await expect(
      startVisServer({ port: taken, homeDir }),
    ).rejects.toThrow();
  });
});
