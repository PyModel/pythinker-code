// `?settings=remote-control` opens Settings on the Remote Control tab. The
// terminal banner links here so the QR code shows in the page.
export function takeRemoteControlSettingsLink(href: string): string | null {
  const url = new URL(href);
  if (url.searchParams.get('settings') !== 'remote-control') return null;
  url.searchParams.delete('settings');
  return `${url.pathname}${url.search}${url.hash}`;
}
