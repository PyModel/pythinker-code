import { describe, expect, it } from 'vitest';

import { openUrlCommandFor } from '#/utils/open-url';

const oauthUrl =
  'https://auth.openai.com/oauth/authorize?client_id=app_test&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=state';

describe('openUrlCommandFor', () => {
  it('passes the complete OAuth URL to the Windows URL handler', () => {
    expect(openUrlCommandFor(oauthUrl, 'win32')).toEqual({
      command: 'rundll32',
      args: ['url.dll,FileProtocolHandler', oauthUrl],
    });
  });

  it('uses the native opener on macOS', () => {
    expect(openUrlCommandFor(oauthUrl, 'darwin')).toEqual({
      command: 'open',
      args: [oauthUrl],
    });
  });

  it('uses xdg-open on Linux', () => {
    expect(openUrlCommandFor(oauthUrl, 'linux')).toEqual({
      command: 'xdg-open',
      args: [oauthUrl],
    });
  });
});
