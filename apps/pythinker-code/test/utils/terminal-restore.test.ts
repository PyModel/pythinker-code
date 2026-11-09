import { expect, it, vi } from 'vitest';

import { restoreTerminalModes } from '#/utils/terminal-restore';

it('restores raw input and terminal escape modes', () => {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'setRawMode');
  const setRawMode = vi.fn();
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never);
  Object.defineProperty(process.stdin, 'setRawMode', { configurable: true, value: setRawMode });

  try {
    restoreTerminalModes();
    expect(setRawMode).toHaveBeenCalledWith(false);
    expect(write).toHaveBeenCalledWith('\u001B[?25h\u001B[?2004l\u001B[<u\u001B[>4;0m');
  } finally {
    write.mockRestore();
    if (descriptor === undefined) delete (process.stdin as Partial<NodeJS.ReadStream>).setRawMode;
    else Object.defineProperty(process.stdin, 'setRawMode', descriptor);
  }
});
