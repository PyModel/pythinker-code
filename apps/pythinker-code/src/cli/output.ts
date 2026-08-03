import type { Writable } from 'node:stream';

/**
 * A write failed because the reader closed the stream (e.g. the CLI piped into
 * `head`). EPIPE is a normal end of output, not a crash — callers may swallow
 * it and exit with their regular success code.
 */
export function isBrokenPipeError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'EPIPE'
  );
}

/**
 * Serialize one write and wait until it is handed off to the OS, so output is
 * never truncated by an immediately following `process.exit`. Resolves on
 * EPIPE; rejects on any other stream error.
 */
async function writeBarrier(stream: Readonly<Writable>, content: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let fallback: NodeJS.Immediate | undefined;

    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      if (fallback !== undefined) clearImmediate(fallback);
      stream.off('error', onError);
      if (error === undefined || isBrokenPipeError(error)) {
        resolve();
        return;
      }
      reject(error);
    };
    const deferFinish = (error?: unknown): void => {
      // Some broken streams never invoke the write callback; the immediate
      // guarantees the promise still settles even then.
      fallback ??= setImmediate(() => {
        finish(error);
      });
    };
    const onError = (error: Error): void => {
      finish(error);
    };

    stream.once('error', onError);
    try {
      stream.write(content, (error) => {
        deferFinish(error ?? undefined);
      });
    } catch (error) {
      finish(error);
    }
  });
}

/** Write `content` and wait until it is flushed, then resolve. */
export async function writeAndDrain(stream: Readonly<Writable>, content: string): Promise<void> {
  await writeBarrier(stream, content);
}

/** Wait until output already queued on the stream is flushed. */
export async function drainWritable(stream: Readonly<Writable>): Promise<void> {
  // A zero-length write is an ordering barrier for output already queued below
  // the stream's high-water mark, where writableNeedDrain remains false.
  await writeBarrier(stream, '');
}
