/** Verify every file referenced by an electron-updater release manifest. */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { getFileList, parseUpdateInfo } from 'electron-updater/out/providers/Provider.js'

export interface VerifyUpdateManifestOptions {
  readonly artifactsDir: string
  readonly channel?: 'stable' | 'beta' | 'nightly'
  readonly expectedVersion: string
  readonly platform: 'mac' | 'win'
}

function assertSafeFilename(filename: string): void {
  if (
    basename(filename) !== filename
    || !/^[A-Za-z0-9][A-Za-z0-9._+()-]*$/u.test(filename)
  ) throw new Error(`Update manifest contains an unsafe artifact URL: ${filename}`)
}

async function sha512(path: string): Promise<string> {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('base64')
}

/** Validate version, file references, sizes, checksums, aliases, and release date. */
export async function verifyUpdateManifest(options: VerifyUpdateManifestOptions): Promise<void> {
  const prefix = options.channel === undefined || options.channel === 'stable' ? 'latest' : options.channel
  const manifestName = options.platform === 'mac' ? `${prefix}-mac.yml` : `${prefix}.yml`
  const manifestPath = join(options.artifactsDir, manifestName)
  const raw = await readFile(manifestPath, 'utf8')
  const info = parseUpdateInfo(raw, manifestName, pathToFileURL(manifestPath))
  if (info.version !== options.expectedVersion) {
    throw new Error(`${manifestName} version ${info.version} does not match ${options.expectedVersion}`)
  }

  const releaseDate = info.releaseDate
  if (
    typeof releaseDate !== 'string'
    || Number.isNaN(Date.parse(releaseDate))
    || new Date(releaseDate).toISOString() !== releaseDate
  ) throw new Error(`${manifestName} has an invalid releaseDate`)

  const files = getFileList(info)
  const seen = new Set<string>()
  for (const file of files) {
    assertSafeFilename(file.url)
    if (seen.has(file.url)) throw new Error(`${manifestName} contains a duplicate artifact URL: ${file.url}`)
    seen.add(file.url)
    if (!Number.isSafeInteger(file.size) || (file.size ?? 0) <= 0) {
      throw new Error(`${manifestName} has an invalid size for ${file.url}`)
    }
    if (typeof file.sha512 !== 'string' || Buffer.from(file.sha512, 'base64').byteLength !== 64) {
      throw new Error(`${manifestName} has an invalid SHA-512 for ${file.url}`)
    }

    const artifactPath = join(options.artifactsDir, file.url)
    const artifact = await lstat(artifactPath)
    if (!artifact.isFile()) throw new Error(`Update artifact is not a regular file: ${file.url}`)
    if (artifact.size !== file.size) throw new Error(`${file.url} size does not match ${manifestName}`)
    if (await sha512(artifactPath) !== file.sha512) {
      throw new Error(`${file.url} SHA-512 does not match ${manifestName}`)
    }
  }

  const required = options.platform === 'mac'
    ? [['-mac.zip', 'macOS ZIP'], ['.dmg', 'macOS DMG']] as const
    : [['-Setup.exe', 'Windows installer']] as const
  for (const [suffix, label] of required) {
    if (![...seen].some(filename => filename.endsWith(suffix))) {
      throw new Error(`${manifestName} does not reference the required ${label}`)
    }
  }

  const legacy = info as typeof info & { readonly path?: unknown; readonly sha512?: unknown }
  if (typeof legacy.path !== 'string' || !seen.has(legacy.path)) {
    throw new Error(`${manifestName} top-level path does not match a file entry`)
  }
  const pathEntry = files.find(file => file.url === legacy.path)!
  if (legacy.sha512 !== pathEntry.sha512) {
    throw new Error(`${manifestName} top-level SHA-512 does not match ${legacy.path}`)
  }
  const requiredAliasSuffix = options.platform === 'mac' ? '-mac.zip' : '-Setup.exe'
  if (!legacy.path.endsWith(requiredAliasSuffix)) {
    throw new Error(`${manifestName} top-level path must reference ${requiredAliasSuffix}`)
  }
}

async function main(): Promise<void> {
  const [platform, artifactsDir, expectedVersion, channel = 'stable'] = process.argv.slice(2)
  if (
    (platform !== 'mac' && platform !== 'win')
    || artifactsDir === undefined
    || expectedVersion === undefined
    || (channel !== 'stable' && channel !== 'beta' && channel !== 'nightly')
  ) {
    throw new Error('Usage: verify-update-manifest.ts <mac|win> <artifacts-directory> <version> [stable|beta|nightly]')
  }
  await verifyUpdateManifest({ artifactsDir: resolve(artifactsDir), channel, expectedVersion, platform })
  console.log(`${platform} ${channel} update manifest verified for ${expectedVersion}`)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
