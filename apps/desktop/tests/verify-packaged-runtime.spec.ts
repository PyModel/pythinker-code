import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { afterPack, restoreWindowsNodePty } from '../scripts/verify-packaged-runtime'

function context(appOutDir: string, electronPlatformName = 'darwin') {
  return {
    appOutDir,
    electronPlatformName,
    packager: { appInfo: { productFilename: 'Pythinker' } },
  } as Parameters<typeof afterPack>[0]
}

describe('packaged desktop runtime verification', () => {
  it('accepts both packaged Host entrypoints', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'pythinker-packaged-runtime-'))
    try {
      const resources = join(appOutDir, 'Pythinker.app', 'Contents', 'Resources', 'host', 'node_modules')
      const cli = join(resources, '@pymodel', 'pythinker-code', 'dist', 'main.mjs')
      const web = join(resources, '@pymodel', 'pythinker-code', 'dist-web', 'index.html')
      await mkdir(join(cli, '..'), { recursive: true })
      await mkdir(join(web, '..'), { recursive: true })
      await writeFile(cli, '')
      await writeFile(web, '')

      await expect(afterPack(context(appOutDir))).resolves.toBeUndefined()
    } finally {
      await rm(appOutDir, { recursive: true, force: true })
    }
  })

  it('rejects a shell whose Host dependency tree was filtered out', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'pythinker-packaged-runtime-'))
    try {
      await expect(afterPack(context(appOutDir))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(appOutDir, { recursive: true, force: true })
    }
  })

  it('rejects a Windows shell whose node-pty native closure was filtered out', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'pythinker-packaged-runtime-'))
    try {
      const resources = join(appOutDir, 'resources', 'host', 'node_modules')
      const cli = join(resources, '@pymodel', 'pythinker-code', 'dist', 'main.mjs')
      const web = join(resources, '@pymodel', 'pythinker-code', 'dist-web', 'index.html')
      await mkdir(join(cli, '..'), { recursive: true })
      await mkdir(join(web, '..'), { recursive: true })
      await writeFile(cli, '')
      await writeFile(web, '')

      await expect(afterPack(context(appOutDir, 'win32'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(appOutDir, { recursive: true, force: true })
    }
  })

  it('replaces a missing Windows pty.node from the staged Host tree', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'pythinker-packaged-runtime-'))
    const staged = await mkdtemp(join(tmpdir(), 'pythinker-staged-pty-'))
    try {
      const resources = join(appOutDir, 'resources', 'host', 'node_modules')
      const cli = join(resources, '@pymodel', 'pythinker-code', 'dist', 'main.mjs')
      const web = join(resources, '@pymodel', 'pythinker-code', 'dist-web', 'index.html')
      await mkdir(join(cli, '..'), { recursive: true })
      await mkdir(join(web, '..'), { recursive: true })
      await writeFile(cli, '')
      await writeFile(web, '')
      for (const name of ['pty.node', 'conpty.node', 'conpty_console_list.node']) {
        const file = join(staged, 'node-pty', 'prebuilds', 'win32-x64', name)
        await mkdir(join(file, '..'), { recursive: true })
        await writeFile(file, name)
      }

      await expect(afterPack(context(appOutDir, 'win32'), staged)).resolves.toBeUndefined()
    } finally {
      await rm(appOutDir, { recursive: true, force: true })
      await rm(staged, { recursive: true, force: true })
    }
  })

  it('copies through a symlink when restoring a Windows node-pty addon', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pythinker-pty-link-'))
    try {
      const real = join(root, 'real.node')
      const link = join(root, 'staged', 'node-pty', 'prebuilds', 'win32-x64', 'pty.node')
      await writeFile(real, 'pty')
      await mkdir(join(link, '..'), { recursive: true })
      await symlink(real, link)
      const packaged = join(root, 'packaged')
      await mkdir(join(packaged, 'node-pty', 'prebuilds', 'win32-x64'), { recursive: true })
      await writeFile(join(packaged, 'node-pty', 'prebuilds', 'win32-x64', 'conpty.node'), '')
      await writeFile(join(packaged, 'node-pty', 'prebuilds', 'win32-x64', 'conpty_console_list.node'), '')

      await restoreWindowsNodePty(packaged, join(root, 'staged'))

      await expect(readFile(join(packaged, 'node-pty', 'prebuilds', 'win32-x64', 'pty.node'), 'utf8')).resolves.toBe('pty')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not require Windows node-pty entries for a Darwin shell', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'pythinker-packaged-runtime-'))
    try {
      const resources = join(appOutDir, 'Pythinker.app', 'Contents', 'Resources', 'host', 'node_modules')
      const cli = join(resources, '@pymodel', 'pythinker-code', 'dist', 'main.mjs')
      const web = join(resources, '@pymodel', 'pythinker-code', 'dist-web', 'index.html')
      await mkdir(join(cli, '..'), { recursive: true })
      await mkdir(join(web, '..'), { recursive: true })
      await writeFile(cli, '')
      await writeFile(web, '')

      await expect(afterPack(context(appOutDir))).resolves.toBeUndefined()
    } finally {
      await rm(appOutDir, { recursive: true, force: true })
    }
  })
})
