import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CdpClient, launchChrome } from './check-built-browser.mjs';

class FakeWebSocket extends EventTarget {
  static OPEN = 1;

  readyState = FakeWebSocket.OPEN;

  send() {}

  close() {
    this.dispatchEvent(new Event('close'));
  }
}

async function expectPendingCallRejection(eventName) {
  const OriginalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  try {
    const client = new CdpClient('ws://artifact-security.test');
    const pending = client.call('Runtime.enable');
    client.socket.dispatchEvent(new Event(eventName));
    for (const call of [pending, client.call('Page.enable')]) {
      await assert.rejects(
        Promise.race([
          call,
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error('CDP call did not reject.'));
            }, 50);
          }),
        ]),
        /CDP WebSocket (closed|failed)/,
      );
    }
  } finally {
    globalThis.WebSocket = OriginalWebSocket;
  }
}

void test('rejects pending calls when the CDP socket closes', async () => {
  await expectPendingCallRejection('close');
});

void test('rejects pending calls when the CDP socket fails', async () => {
  await expectPendingCallRejection('error');
});

void test('kills Chrome when it never exposes DevTools', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'artifact-security-chrome-'));
  try {
    const pidFile = join(directory, 'pid');
    const executable = join(directory, 'fake-chrome');
    await writeFile(executable, `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 60\n`, { mode: 0o755 });
    await assert.rejects(launchChrome(executable, directory, 500), /did not expose DevTools/);
    const pid = Number(await readFile(pidFile, 'utf8'));
    await new Promise((resolveWait) => {
      setTimeout(resolveWait, 100);
    });
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
