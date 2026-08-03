import { describe, expect, it } from 'vitest';

import { renderOAuthErrorPage, renderOAuthSuccessPage } from '../../src/mcp/oauth/oauth-pages';

describe('oauth-pages', () => {
  it('renders the branded success page shown after OAuth completes', () => {
    const html = renderOAuthSuccessPage();

    expect(html).toContain("You're logged in to Pythinker");
    expect(html).toContain('You can close this tab and return to Pythinker.');
    expect(html).toContain('class="card"');
    expect(html).toContain('Pythinker Code');
    expect(html).toContain('<svg');
  });

  it('renders a matching error page shell', () => {
    const html = renderOAuthErrorPage();

    expect(html).toContain('Sign-in failed');
    expect(html).toContain('Return to Pythinker for details.');
    expect(html).toContain('class="card"');
  });
});
