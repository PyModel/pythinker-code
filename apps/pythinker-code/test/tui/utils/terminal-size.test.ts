import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { waitForTerminalSize } from '#/tui/utils/terminal-size';

type TestStream = EventEmitter & Parameters<typeof waitForTerminalSize>[0];

function makeStream(columns: number): TestStream {
  return Object.assign(new EventEmitter(), { columns }) as TestStream;
}

describe('waitForTerminalSize', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves immediately when columns are already usable', async () => {
    const stream = makeStream(80);
    const once = vi.spyOn(stream, 'once');

    await waitForTerminalSize(stream);

    expect(once).not.toHaveBeenCalled();
  });

  it('resolves on resize and removes the listener', async () => {
    const stream = makeStream(0);
    const pending = waitForTerminalSize(stream);

    expect(stream.listenerCount('resize')).toBe(1);
    stream.emit('resize');
    await pending;

    expect(stream.listenerCount('resize')).toBe(0);
  });

  it('resolves after the timeout and removes the listener', async () => {
    vi.useFakeTimers();
    const stream = makeStream(0);
    const pending = waitForTerminalSize(stream, 25);

    vi.advanceTimersByTime(25);
    await pending;

    expect(stream.listenerCount('resize')).toBe(0);
  });
});
