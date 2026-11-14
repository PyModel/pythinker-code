/** Reject a packaged desktop shell that omitted the staged Host entrypoints. */

import { access, cp, lstat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AfterPackContext } from 'electron-builder'

const REQUIRED_HOST_FILES = [
  ['@pymodel', 'pythinker-code', 'dist', 'main.mjs'],
  ['@pymodel', 'pythinker-code', 'dist-web', 'index.html'],
] as const

const REQUIRED_WINDOWS_NODE_PTY_ENTRIES = [
  ['node-pty', 'prebuilds', 'win32-x64', 'pty.node'],
  ['node-pty', 'prebuilds', 'win32-x64', 'conpty.node'],
  ['node-pty', 'prebuilds', 'win32-x64', 'conpty_console_list.node'],
] as const

/**
 * Copy a staged node-pty file into the package when the packager left a link.
 *
 * electron-builder turns a file symlink into a Windows directory junction, and
 * `access` then reports the addon as missing even though staging had it.
 * @param packagedNodeModules - `resources/host/node_modules` inside the app.
 * @param stagedNodeModules - `runtime-host/node_modules` produced before packing.
 */
export async function restoreWindowsNodePty(
  packagedNodeModules: string,
  stagedNodeModules: string,
): Promise<void> {
  for (const segments of REQUIRED_WINDOWS_NODE_PTY_ENTRIES) {
    const destination = join(packagedNodeModules, ...segments)
    const metadata = await lstat(destination).catch(() => undefined)
    if (metadata?.isFile() === true && !metadata.isSymbolicLink()) continue
    if (metadata !== undefined) await rm(destination, { recursive: true, force: true })
    await cp(join(stagedNodeModules, ...segments), destination, { dereference: true })
  }
}

/**
 * Verify the Host files required before the signed application can start.
 * @param context - Electron Builder's completed application directory.
 * @param stagedNodeModules - Optional staged Host tree used to repair Windows addons.
 * @returns A promise that rejects when a staged Host entrypoint is absent.
 */
export async function afterPack(
  context: AfterPackContext,
  stagedNodeModules: string = join(import.meta.dirname, '..', 'runtime-host', 'node_modules'),
): Promise<void> {
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  for (const segments of REQUIRED_HOST_FILES) {
    await access(join(resources, 'host', 'node_modules', ...segments))
  }
  if (context.electronPlatformName !== 'win32') return
  await restoreWindowsNodePty(join(resources, 'host', 'node_modules'), stagedNodeModules).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  })
  for (const segments of REQUIRED_WINDOWS_NODE_PTY_ENTRIES) {
    await access(join(resources, 'host', 'node_modules', ...segments))
  }
}

export default afterPack
