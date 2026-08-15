import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { afterPack } from '../scripts/verify-packaged-runtime'

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
      const cli = join(resources, '@pymodel', 'pythinker-code', 'dist', 'launcher.mjs')
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
})
