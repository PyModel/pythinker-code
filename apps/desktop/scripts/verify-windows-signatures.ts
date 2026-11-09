/** Verify Windows release signatures with electron-updater's production verifier. */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifySignature } from 'electron-updater/out/windowsExecutableCodeSignatureVerifier.js'
import { parseUpdateInfo } from 'electron-updater/out/providers/Provider.js'
import { verifyWindowsInstaller } from './verify-win-installer'

export type WindowsSignatureVerifier = (
  publisherNames: string[],
  path: string,
) => Promise<string | null>

/** Verify the installer and packaged application against the updater publisher. */
export async function verifyWindowsSignatures(
  desktopRoot: string,
  publisherName: string,
  verifier: WindowsSignatureVerifier = (names, path) => verifySignature(names, path, console),
): Promise<void> {
  const publisher = publisherName.trim()
  if (publisher === '') throw new Error('Windows signing publisher is empty')
  verifyWindowsInstaller(desktopRoot)
  const { version } = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as { version: string }
  const appUpdatePath = join(desktopRoot, 'dist', 'win-unpacked', 'resources', 'app-update.yml')
  const appUpdate = parseUpdateInfo(
    readFileSync(appUpdatePath, 'utf8'),
    'app-update.yml',
    pathToFileURL(appUpdatePath),
  ) as unknown as { readonly publisherName?: string | readonly string[] }
  const configuredPublishers = typeof appUpdate.publisherName === 'string'
    ? [appUpdate.publisherName]
    : appUpdate.publisherName
  const normalizedPublishers = configuredPublishers?.map((value) => value.trim())
  if (normalizedPublishers === undefined || normalizedPublishers.length !== 1) {
    throw new Error('Packaged updater configuration does not exactly match the expected Windows publisher')
  }
  if (normalizedPublishers[0] !== publisher) {
    throw new Error('Packaged updater configuration does not contain the expected Windows publisher')
  }
  const paths = [
    join(desktopRoot, 'dist', `Pythinker-${version}-x64-Setup.exe`),
    join(desktopRoot, 'dist', 'win-unpacked', 'Pythinker.exe'),
  ]
  for (const path of paths) {
    const error = await verifier([publisher], path)
    if (error !== null) throw new Error(`Windows signature verification failed for ${path}: ${error}`)
  }
}

async function main(): Promise<void> {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const publisher = process.env['AZURE_SIGNING_PUBLISHER_NAME']
    ?? process.env['WINDOWS_SIGNING_PUBLISHER_NAME']
  if (publisher === undefined) throw new Error('Windows signing publisher is not configured')
  await verifyWindowsSignatures(desktopRoot, publisher)
  console.log(`Windows release signatures verified for ${publisher}`)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
