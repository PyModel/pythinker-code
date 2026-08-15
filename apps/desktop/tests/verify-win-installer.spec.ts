import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyWindowsInstaller } from '../scripts/verify-win-installer'

const VERSION = '9.9.9'

function portableExecutable(magic = 'MZ', signature = 'PE\0\0', offset = 0x80): Buffer {
  const image = Buffer.alloc(offset + signature.length)
  image.write(magic, 0, magic.length, 'latin1')
  image.writeUInt32LE(offset, 0x3c)
  image.write(signature, offset, signature.length, 'latin1')
  return image
}

async function withFixture(callback: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'pythinker-win-installer-'))
  try {
    await callback(root)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

async function createFixture(root: string, installer?: Buffer): Promise<void> {
  const dist = join(root, 'dist')
  await mkdir(join(dist, 'win-unpacked'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: VERSION }))
  if (installer !== undefined) {
    await writeFile(join(dist, `Pythinker-${VERSION}-x64-Setup.exe`), installer)
  }
  await writeFile(join(dist, 'win-unpacked', 'Pythinker.exe'), portableExecutable())
}

describe('Windows installer verification', () => {
  it('accepts the installer and unpacked shell when both are PE binaries', async () => {
    await withFixture(async (root) => {
      await createFixture(root, portableExecutable())
      expect(() => verifyWindowsInstaller(root)).not.toThrow()
    })
  })

  it('rejects a missing installer', async () => {
    await withFixture(async (root) => {
      await createFixture(root)
      expect(() => verifyWindowsInstaller(root)).toThrow('ENOENT')
    })
  })

  it('rejects an artifact without a DOS header', async () => {
    await withFixture(async (root) => {
      await createFixture(root, portableExecutable('ZZ'))
      expect(() => verifyWindowsInstaller(root)).toThrow(/no DOS header/)
    })
  })

  it('rejects an artifact with a truncated PE offset', async () => {
    await withFixture(async (root) => {
      const truncated = Buffer.alloc(0x44)
      truncated.write('MZ', 0, 2, 'latin1')
      truncated.writeUInt32LE(0x80, 0x3c)
      await createFixture(root, truncated)
      expect(() => verifyWindowsInstaller(root)).toThrow(/out-of-range PE offset/)
    })
  })

  it('rejects an artifact without a PE signature', async () => {
    await withFixture(async (root) => {
      await createFixture(root, portableExecutable('MZ', 'NE\0\0'))
      expect(() => verifyWindowsInstaller(root)).toThrow(/no PE signature/)
    })
  })
})
