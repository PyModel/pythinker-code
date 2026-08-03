/** Resolve when the stream reports a usable size, or after timeoutMs. */
export function waitForTerminalSize(
  stream: Pick<NodeJS.WriteStream, 'columns' | 'once' | 'removeListener'>,
  timeoutMs = 250,
): Promise<void> {
  if (typeof stream.columns === 'number' && stream.columns > 0) return Promise.resolve();

  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timeout);
      stream.removeListener('resize', finish);
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);
    stream.once('resize', finish);
    timeout.unref?.();
  });
}
