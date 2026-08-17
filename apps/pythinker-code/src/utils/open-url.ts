import { execFile } from 'node:child_process';

export interface OpenUrlCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * Windows uses `rundll32` rather than `cmd /c start` because `cmd` reparses
 * its arguments and cuts a URL at the first `&`, which strips OAuth query
 * parameters.
 */
export function openUrlCommandFor(
  url: string,
  platform: NodeJS.Platform = process.platform,
): OpenUrlCommand {
  switch (platform) {
    case 'darwin':
      return { command: 'open', args: [url] };
    case 'win32':
      return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
    default:
      return { command: 'xdg-open', args: [url] };
  }
}

export function openUrl(url: string): void {
  const { command, args } = openUrlCommandFor(url);
  execFile(command, [...args], () => {});
}
