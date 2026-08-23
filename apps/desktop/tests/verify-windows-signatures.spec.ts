import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { verifyWindowsSignatures } from '../scripts/verify-windows-signatures'

const VERSION = '9.9.9'
const PUBLISHER = 'CN=Example Publisher, O=Example Publisher'

function portableExecutable(): Buffer {
  const image = Buffer.alloc(0x84)
  image.write('MZ', 0, 2, 'latin1')
  image.writeUInt32LE(0x80, 0x3c)
  image.write('PE\0\0', 0x80, 4, 'latin1')
  return image
}

async function withFixture(callback: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'pythinker-win-signature-'))
  await mkdir(join(root, 'dist', 'win-unpacked'), { recursive: true })
  await mkdir(join(root, 'dist', 'win-unpacked', 'resources'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: VERSION }))
  await writeFile(join(root, 'dist', `Pythinker-${VERSION}-x64-Setup.exe`), portableExecutable())
  await writeFile(join(root, 'dist', 'win-unpacked', 'Pythinker.exe'), portableExecutable())
  await writeFile(
    join(root, 'dist', 'win-unpacked', 'resources', 'app-update.yml'),
    `provider: github\npublisherName: '${PUBLISHER}'\n`,
  )
  try {
    await callback(root)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

describe('Windows Authenticode verification', () => {
  it('checks the installer and packaged app against the expected publisher', async () => {
    await withFixture(async (root) => {
      const verify = vi.fn(() => Promise.resolve(null))
      await verifyWindowsSignatures(root, PUBLISHER, verify)

      expect(verify).toHaveBeenCalledTimes(2)
      expect(verify).toHaveBeenNthCalledWith(1, [PUBLISHER], join(root, 'dist', `Pythinker-${VERSION}-x64-Setup.exe`))
      expect(verify).toHaveBeenNthCalledWith(2, [PUBLISHER], join(root, 'dist', 'win-unpacked', 'Pythinker.exe'))
    })
  })

  it('rejects a signature that does not match the expected publisher', async () => {
    await withFixture(async (root) => {
      const verify = vi.fn(() => Promise.resolve('signed by another publisher'))
      await expect(verifyWindowsSignatures(root, PUBLISHER, verify))
        .rejects.toThrow('signed by another publisher')
    })
  })

  it('rejects a package that would disable updater signature verification', async () => {
    await withFixture(async (root) => {
      await writeFile(
        join(root, 'dist', 'win-unpacked', 'resources', 'app-update.yml'),
        "provider: github\npublisherName: 'CN=Other Publisher'\n",
      )
      await expect(verifyWindowsSignatures(root, PUBLISHER, () => Promise.resolve(null)))
        .rejects.toThrow('does not contain the expected Windows publisher')
    })
  })

  it('rejects extra configured publishers that would widen updater trust', async () => {
    await withFixture(async (root) => {
      await writeFile(
        join(root, 'dist', 'win-unpacked', 'resources', 'app-update.yml'),
        `provider: github\npublisherName:\n  - '${PUBLISHER}'\n  - 'CN=Other Publisher'\n`,
      )
      await expect(verifyWindowsSignatures(root, PUBLISHER, () => Promise.resolve(null)))
        .rejects.toThrow('does not exactly match the expected Windows publisher')
    })
  })
})
