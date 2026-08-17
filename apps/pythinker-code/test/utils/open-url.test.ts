import { describe, expect, it } from 'vitest';

import { openUrlCommandFor } from '#/utils/open-url';

const AUTHORIZE_URL =
  'https://auth.openai.com/oauth/authorize?client_id=app_test&response_type=code&state=abc';

describe('openUrlCommandFor', () => {
  it('keeps every query parameter on Windows', () => {
    const { command, args } = openUrlCommandFor(AUTHORIZE_URL, 'win32');
    expect(command).toBe('rundll32');
    // `cmd /c start` cuts the URL at the first `&`, so the launcher must not
    // hand the URL to a command interpreter.
    expect(command).not.toBe('cmd');
    expect(args.at(-1)).toBe(AUTHORIZE_URL);
  });

  it('uses the platform launcher elsewhere', () => {
    expect(openUrlCommandFor(AUTHORIZE_URL, 'darwin')).toEqual({
      command: 'open',
      args: [AUTHORIZE_URL],
    });
    expect(openUrlCommandFor(AUTHORIZE_URL, 'linux')).toEqual({
      command: 'xdg-open',
      args: [AUTHORIZE_URL],
    });
  });
});
