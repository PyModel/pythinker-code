/** Reject a Windows release whose installer or unpacked shell is not a real PE binary. */

import { openSync, readSync, closeSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MINIMUM_PE_BYTES = 0x40 + 4

function assertPortableExecutable(path: string): void {
  const stats = statSync(path)
  if (!stats.isFile()) throw new Error(`Windows release artifact is not a regular file: ${path}`)
  if (stats.size < MINIMUM_PE_BYTES) throw new Error(`Windows release artifact is too small to be a PE image: ${path}`)
  const handle = openSync(path, 'r')
  try {
    const header = Buffer.alloc(0x40)
    readSync(handle, header, 0, header.length, 0)
    if (header.toString('latin1', 0, 2) !== 'MZ') throw new Error(`Windows release artifact has no DOS header: ${path}`)
    const peOffset = header.readUInt32LE(0x3c)
    if (peOffset + 4 > stats.size) throw new Error(`Windows release artifact has an out-of-range PE offset: ${path}`)
    const signature = Buffer.alloc(4)
    readSync(handle, signature, 0, 4, peOffset)
    if (signature.toString('latin1') !== 'PE\0\0') throw new Error(`Windows release artifact has no PE signature: ${path}`)
  } finally {
    closeSync(handle)
  }
}

/**
 * Verify the Windows artifacts electron-builder must have produced.
 * @param desktopRoot - The apps/desktop directory containing dist/.
 */
export function verifyWindowsInstaller(desktopRoot: string): void {
  const { version } = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as { version: string }
  assertPortableExecutable(join(desktopRoot, 'dist', `Pythinker-${version}-x64-Setup.exe`))
  assertPortableExecutable(join(desktopRoot, 'dist', 'win-unpacked', 'Pythinker.exe'))
  console.log(`Windows release verified: Pythinker-${version}-x64-Setup.exe`)
}
