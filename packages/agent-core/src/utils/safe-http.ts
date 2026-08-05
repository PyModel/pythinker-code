import { lookup as callbackLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP, type LookupFunction } from 'node:net';

import { Agent, type Dispatcher } from 'undici';

import { isProxyConfigured, makeNoProxyMatcher, resolveNoProxy } from './proxy';

const PRIVATE_ADDRESS_BLOCKLIST = (() => {
  const list = new BlockList();
  list.addSubnet('0.0.0.0', 8, 'ipv4');
  list.addSubnet('10.0.0.0', 8, 'ipv4');
  list.addSubnet('100.64.0.0', 10, 'ipv4');
  list.addSubnet('127.0.0.0', 8, 'ipv4');
  list.addSubnet('169.254.0.0', 16, 'ipv4');
  list.addSubnet('172.16.0.0', 12, 'ipv4');
  list.addSubnet('192.168.0.0', 16, 'ipv4');
  list.addSubnet('::', 128, 'ipv6');
  list.addSubnet('::1', 128, 'ipv6');
  list.addSubnet('fc00::', 7, 'ipv6');
  list.addSubnet('fe80::', 10, 'ipv6');
  return list;
})();

export interface SafeHttpTarget {
  readonly host: string;
  readonly port: string;
  readonly addresses?: readonly LookupAddress[];
}

export async function resolveSafeHttpTarget(
  url: string,
  allowPrivate: boolean,
): Promise<SafeHttpTarget> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: "${url}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL scheme "${parsed.protocol}" — only http(s) allowed.`);
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('HTTP URLs must not contain credentials.');
  }

  const hostRaw = parsed.hostname.toLowerCase();
  const host = hostRaw.startsWith('[') && hostRaw.endsWith(']') ? hostRaw.slice(1, -1) : hostRaw;
  const port = parsed.port !== '' ? parsed.port : parsed.protocol === 'https:' ? '443' : '80';
  if (allowPrivate) return { host, port };
  if (isIP(host) !== 0) {
    if (isBlockedAddress(host)) {
      throw new Error(`Refusing to fetch private address: "${host}"`);
    }
    return { host, port };
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error(`Refusing to fetch private host: "${host}"`);
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(host, { all: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot resolve host "${host}" for the fetch safety check: ${detail}`, {
      cause: error,
    });
  }
  if (addresses.length === 0) {
    throw new Error(`Cannot resolve host "${host}" for the fetch safety check.`);
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new Error(`Refusing to fetch host "${host}": resolves to private address "${address}".`);
    }
  }
  return { host, port, addresses };
}

export function createPinnedHttpDispatcher(target: SafeHttpTarget): Dispatcher | undefined {
  if (target.addresses === undefined) return undefined;
  if (
    isProxyConfigured(process.env) &&
    !makeNoProxyMatcher(resolveNoProxy(process.env))(target.host, target.port)
  ) {
    return undefined;
  }
  return new Agent({
    connect: { lookup: pinnedLookup(target.host, target.addresses) },
  });
}

function isBlockedAddress(address: string): boolean {
  const normalized = address.split('%', 1)[0] ?? address;
  if (isIP(normalized) === 4) return PRIVATE_ADDRESS_BLOCKLIST.check(normalized, 'ipv4');
  return isIP(normalized) === 6 && PRIVATE_ADDRESS_BLOCKLIST.check(normalized, 'ipv6');
}

function pinnedLookup(host: string, addresses: readonly LookupAddress[]): LookupFunction {
  return (hostname: string, options: LookupOptions | undefined, callback: PinnedLookupCallback) => {
    if (hostname !== host) {
      callbackLookup(hostname, options ?? {}, callback);
      return;
    }
    if (options?.all === true) {
      callback(null, [...addresses]);
      return;
    }
    const single = addresses.find((entry) => entry.family === options?.family) ?? addresses[0]!;
    callback(null, single.address, single.family);
  };
}

type PinnedLookupCallback = (
  err: NodeJS.ErrnoException | null,
  addressOrList: string | LookupAddress[],
  family?: number,
) => void;
