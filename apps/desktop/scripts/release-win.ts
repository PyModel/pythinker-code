/** Build the Windows NSIS installer from a native Windows host. */

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageWin } from './package-win'
import { verifyWindowsInstaller } from './verify-win-installer'

function run(command: string, args: readonly string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

/** Build and verify the Windows installer. */
export function releaseWin(): void {
  if (process.platform !== 'win32') {
    throw new Error('The Windows installer must be built on Windows: the staged Host closure contains platform-specific native packages')
  }
  if (process.arch !== 'x64') {
    throw new Error(`The Windows installer targets x64; this host is ${process.arch}`)
  }
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  run('pnpm', ['--workspace-root', 'run', 'build'], desktopRoot)
  run('node', ['--import', 'tsx', 'scripts/stage-runtime.ts'], desktopRoot)
  packageWin({ publish: 'never' })
  verifyWindowsInstaller(desktopRoot)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    releaseWin()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
