import { describe, it, expect } from 'vitest';
import { revealCommandFor } from '../../src/lib/reveal';

describe('reveal', () => {
  it('uses `open` on macOS', () => {
    expect(revealCommandFor('/tmp/x', 'darwin')).toEqual({
      command: 'open',
      args: ['/tmp/x'],
    });
  });

  it('uses explorer.exe without a command shell on Windows', () => {
    expect(revealCommandFor('C:\\x & y', 'win32')).toEqual({
      command: 'C:\\Windows\\explorer.exe',
      args: ['/select,C:\\x & y'],
    });
  });

  it('uses the drive-qualified Windows system root', () => {
    expect(revealCommandFor('D:\\repo\\file.ts', 'win32', {
      SystemRoot: 'relative',
      WINDIR: 'D:\\Windows',
    })).toEqual({
      command: 'D:\\Windows\\explorer.exe',
      args: ['/select,D:\\repo\\file.ts'],
    });
  });

  it('uses xdg-open on Linux and other unixes', () => {
    expect(revealCommandFor('/tmp/x', 'linux')).toEqual({
      command: 'xdg-open',
      args: ['/tmp/x'],
    });
    expect(revealCommandFor('/tmp/x', 'freebsd')).toEqual({
      command: 'xdg-open',
      args: ['/tmp/x'],
    });
  });
});
