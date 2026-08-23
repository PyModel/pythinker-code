import assert from 'node:assert/strict';
import test from 'node:test';

import { CdpClient } from './check-built-browser.mjs';

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
