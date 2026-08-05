import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { drainWritable, writeAndDrain } from '#/cli/output';

class BlockedWritable extends Writable {
  #blocked = true;
  #releaseCurrent: (() => void) | undefined;

  override _write(
    _chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (this.#blocked) {
      this.#releaseCurrent = callback;
      return;
    }
    callback();
  }

  release(): void {
    this.#blocked = false;
    this.#releaseCurrent?.();
    this.#releaseCurrent = undefined;
  }
}

class FailingWritable extends Writable {
  constructor(private readonly failure: Error) {
    super();
  }

  override _write(
    _chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    callback(this.failure);
  }
}

function errorWithCode(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe('CLI output flushing', () => {
  it('waits for a write to finish even below the high-water mark', async () => {
    const stream = new BlockedWritable({ highWaterMark: 1_024 });
    let settled = false;

    const pending = writeAndDrain(stream, 'fatal output').then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(stream.writableNeedDrain).toBe(false);
    expect(settled).toBe(false);

    stream.release();
    await pending;
    expect(settled).toBe(true);
  });

  it('uses an ordering barrier for output already queued below the high-water mark', async () => {
    const stream = new BlockedWritable({ highWaterMark: 1_024 });
    expect(stream.write('queued output')).toBe(true);
    let settled = false;

    const pending = drainWritable(stream).then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(stream.writableNeedDrain).toBe(false);
    expect(settled).toBe(false);

    stream.release();
    await pending;
    expect(settled).toBe(true);
  });

  it('consumes EPIPE from both the write callback and stream error event', async () => {
    const stream = new FailingWritable(errorWithCode('closed output', 'EPIPE'));
    const listenersBefore = stream.listenerCount('error');

    await expect(writeAndDrain(stream, 'ignored')).resolves.toBeUndefined();

    expect(stream.listenerCount('error')).toBe(listenersBefore);
  });

  it('rejects unexpected callback and error-event failures without leaking listeners', async () => {
    const stream = new FailingWritable(errorWithCode('disk failure', 'EIO'));
    const listenersBefore = stream.listenerCount('error');

    await expect(writeAndDrain(stream, 'fatal output')).rejects.toThrow('disk failure');

    expect(stream.listenerCount('error')).toBe(listenersBefore);
  });

  it('rejects an error event even when the write callback has not fired', async () => {
    const stream = new BlockedWritable();
    const listenersBefore = stream.listenerCount('error');
    const pending = drainWritable(stream);

    stream.emit('error', errorWithCode('stream failed', 'EIO'));

    await expect(pending).rejects.toThrow('stream failed');
    expect(stream.listenerCount('error')).toBe(listenersBefore);
    stream.release();
  });
});
