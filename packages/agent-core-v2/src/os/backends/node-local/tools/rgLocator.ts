import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';

import { join } from 'pathe';

import { abortable } from '#/_base/utils/abort';
import { ErrorCodes, Error2 } from '#/errors';

export type RgResolutionSource = 'system-path' | 'vendor' | 'share-bin-cached';

export interface RgResolution {
  readonly path: string;
  readonly source: RgResolutionSource;
}

export interface RgProbe {
  exec(args: readonly string[]): Promise<{ readonly exitCode: number }>;
}

export interface EnsureRgPathOptions {
  readonly shareDir?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly allowCachedFallback?: boolean;
}

function rgBinaryName(): string {
  return process.platform === 'win32' ? 'rg.exe' : 'rg';
}

function getShareDir(): string {
  const override = process.env['PYTHINKER_CODE_HOME'];
  if (override !== undefined && override !== '') return override;
  return join(homedir(), '.pythinker-code');
}

export function getShareBinRgPath(): string {
  return join(getShareDir(), 'bin', rgBinaryName());
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

export async function ensureRgPath(
  probe: RgProbe,
  options: EnsureRgPathOptions = {},
): Promise<RgResolution> {
  throwIfAborted(options.signal);
  const shareDir = options.shareDir ?? getShareDir();
  const resolution = resolveRgPath(probe, shareDir, options);
  return options.signal === undefined ? resolution : abortable(resolution, options.signal);
}

async function resolveRgPath(
  probe: RgProbe,
  shareDir: string,
  options: EnsureRgPathOptions,
): Promise<RgResolution> {
  const existing = await findExistingRg(probe, shareDir);
  if (existing !== undefined) return existing;
  throwIfAborted(options.signal);
  throw new Error2(ErrorCodes.OS_FS_UNAVAILABLE, 'ripgrep (rg) is not available on PATH');
}

export async function findExistingRg(
  _probe: RgProbe,
  shareDir: string = getShareDir(),
): Promise<RgResolution | undefined> {
  const system = await findRgOnPath();
  if (system !== undefined) return { path: system, source: 'system-path' };

  const vendorPath = getVendorRgPath(rgBinaryName());
  if (vendorPath !== undefined && (await isExecutableFile(vendorPath))) {
    return { path: vendorPath, source: 'vendor' };
  }
  const cachePath = join(shareDir, 'bin', rgBinaryName());
  if (await isExecutableFile(cachePath)) {
    return { path: cachePath, source: 'share-bin-cached' };
  }

  return undefined;
}

function getVendorRgPath(_binName: string): string | undefined {
  return undefined;
}

async function findRgOnPath(): Promise<string | undefined> {
  const pathEnv = process.env['PATH'] ?? '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const binName = rgBinaryName();
  for (const dir of pathEnv.split(sep)) {
    if (dir === '') continue;
    const candidate = join(dir, binName);
    if (await isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function rgUnavailableMessage(cause: unknown): string {
  const detail =
    cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'unknown error';
  const shareBin = getShareBinRgPath();
  return (
    `ripgrep (rg) is not available.\n` +
    `\n` +
    `Error: ${detail}\n` +
    `\n` +
    `Fix options:\n` +
    `  macOS:   brew install ripgrep\n` +
    `  Ubuntu:  sudo apt-get install ripgrep\n` +
    `  Other:   https://github.com/BurntSushi/ripgrep#installation\n` +
    `\n` +
    `Alternatively, drop a static rg binary at ${shareBin}`
  );
}
