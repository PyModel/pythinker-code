import { hostForUrl } from './config';

export interface StartupBannerOptions {
  readonly authToken?: string;
  readonly host: string;
  readonly pythinkerCodeHome: string;
  readonly port: number;
}

export function formatStartupBanner(options: StartupBannerOptions): string {
  const authStatus = options.authToken === undefined ? 'auth=disabled' : 'auth=required';
  return (
    `[dashboard-server] listening on http://${hostForUrl(options.host)}:${String(options.port)} ` +
    `(${authStatus}, PYTHINKER_CODE_HOME=${options.pythinkerCodeHome})\n`
  );
}
