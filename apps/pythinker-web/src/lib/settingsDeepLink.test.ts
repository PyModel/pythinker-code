import { describe, expect, it } from 'vitest';

import { takeRemoteControlSettingsLink } from './settingsDeepLink';

describe('takeRemoteControlSettingsLink', () => {
  it('strips the parameter and keeps the path, other params, and token fragment', () => {
    expect(
      takeRemoteControlSettingsLink(
        'http://127.0.0.1:1234/devices/d1/?a=1&settings=remote-control#token=t',
      ),
    ).toBe('/devices/d1/?a=1#token=t');
  });

  it('ignores pages without the parameter or with another value', () => {
    expect(takeRemoteControlSettingsLink('http://127.0.0.1:1234/#token=t')).toBeNull();
    expect(takeRemoteControlSettingsLink('http://127.0.0.1:1234/?settings=general')).toBeNull();
  });
});
