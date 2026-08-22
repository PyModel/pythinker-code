/** Reject a packaged desktop shell that omitted the staged Host entrypoints. */

import { access } from 'node:fs/promises'
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
 * Verify the Host files required before the signed application can start.
 * @param context - Electron Builder's completed application directory.
 * @returns A promise that rejects when a staged Host entrypoint is absent.
 */
export async function afterPack(context: AfterPackContext): Promise<void> {
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  for (const segments of REQUIRED_HOST_FILES) {
    await access(join(resources, 'host', 'node_modules', ...segments))
  }
  if (context.electronPlatformName !== 'win32') return
  for (const segments of REQUIRED_WINDOWS_NODE_PTY_ENTRIES) {
    await access(join(resources, 'host', 'node_modules', ...segments))
  }
}

export default afterPack
