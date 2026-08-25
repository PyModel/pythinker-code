import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyUpdateManifest } from '../scripts/verify-update-manifest'

const VERSION = '9.9.9'

function checksum(content: Buffer): string {
  return createHash('sha512').update(content).digest('base64')
}

async function withFixture(callback: (dist: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'pythinker-update-manifest-'))
  const dist = join(root, 'dist')
  await mkdir(dist)
  try {
    await callback(dist)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

function manifest(version: string, files: readonly { name: string; content: Buffer }[], path = files[0]!.name): string {
  const entries = files.map(({ name, content }) => `  - url: ${name}
    sha512: ${checksum(content)}
    size: ${String(content.byteLength)}`).join('\n')
  const pathFile = files.find(file => file.name === path)!
  return `version: ${version}
files:
${entries}
path: ${path}
sha512: ${checksum(pathFile.content)}
releaseDate: '2026-08-23T02:51:05.139Z'
`
}

async function writeArtifacts(
  dist: string,
  platform: 'mac' | 'win',
  files: readonly { name: string; content: Buffer }[],
  yaml = manifest(VERSION, files),
  channel: 'stable' | 'beta' | 'nightly' = 'stable',
): Promise<void> {
  for (const file of files) await writeFile(join(dist, file.name), file.content)
  const prefix = channel === 'stable' ? 'latest' : channel
  await writeFile(join(dist, platform === 'mac' ? `${prefix}-mac.yml` : `${prefix}.yml`), yaml)
}

const macFiles = [
  { name: `Pythinker-${VERSION}-arm64-mac.zip`, content: Buffer.from('signed mac update') },
  { name: `Pythinker-${VERSION}-arm64.dmg`, content: Buffer.from('notarized disk image') },
] as const
const winFiles = [
  { name: `Pythinker-${VERSION}-x64-Setup.exe`, content: Buffer.from('signed windows installer') },
] as const

describe('desktop update manifest verification', () => {
  it.each([
    { platform: 'mac' as const, files: macFiles },
    { platform: 'win' as const, files: winFiles },
  ])('accepts a complete $platform manifest', async ({ platform, files }) => {
    await withFixture(async (dist) => {
      await writeArtifacts(dist, platform, files)
      await expect(verifyUpdateManifest({ artifactsDir: dist, expectedVersion: VERSION, platform }))
        .resolves.toBeUndefined()
    })
  })

  it.each(['beta', 'nightly'] as const)('accepts the %s channel manifest names', async (channel) => {
    await withFixture(async (dist) => {
      await writeArtifacts(dist, 'win', winFiles, manifest(VERSION, winFiles), channel)
      await expect(verifyUpdateManifest({
        artifactsDir: dist,
        channel,
        expectedVersion: VERSION,
        platform: 'win',
      })).resolves.toBeUndefined()
    })
  })

  it('rejects the wrong release version', async () => {
    await withFixture(async (dist) => {
      await writeArtifacts(dist, 'win', winFiles, manifest('9.9.8', winFiles))
      await expect(verifyUpdateManifest({ artifactsDir: dist, expectedVersion: VERSION, platform: 'win' }))
        .rejects.toThrow('version 9.9.8 does not match 9.9.9')
    })
  })

  it('rejects external and nested artifact URLs', async () => {
    await withFixture(async (dist) => {
      const unsafe = manifest(VERSION, winFiles).replace(winFiles[0].name, '../Pythinker.exe')
      await writeArtifacts(dist, 'win', winFiles, unsafe)
      await expect(verifyUpdateManifest({ artifactsDir: dist, expectedVersion: VERSION, platform: 'win' }))
        .rejects.toThrow('unsafe artifact URL')
    })
  })

  it('rejects duplicate artifact URLs', async () => {
    await withFixture(async (dist) => {
      const duplicate = manifest(VERSION, [...winFiles, ...winFiles])
      await writeArtifacts(dist, 'win', winFiles, duplicate)
      await expect(verifyUpdateManifest({ artifactsDir: dist, expectedVersion: VERSION, platform: 'win' }))
        .rejects.toThrow('duplicate artifact URL')
    })
  })

  it('rejects a wrong artifact size', async () => {
    await withFixture(async (dist) => {
      const wrongSize = manifest(VERSION, winFiles).replace('size: 24', 'size: 1')
      await writeArtifacts(dist, 'win', winFiles, wrongSize)
      await expect(verifyUpdateManifest({ artifactsDir: dist, expectedVersion: VERSION, platform: 'win' }))
        .rejects.toThrow('size does not match')
    })
  })

  it('rejects a wrong SHA-512 checksum', async () => {
    await withFixture(async (dist) => {
      const wrongChecksum = manifest(VERSION, winFiles).replace(checksum(winFiles[0].content), checksum(Buffer.from('other')))
      await writeArtifacts(dist, 'win', winFiles, wrongChecksum)
      await expect(verifyUpdateManifest({ artifactsDir: dist, expectedVersion: VERSION, platform: 'win' }))
        .rejects.toThrow('SHA-512 does not match')
    })
  })

  it('requires both macOS updater artifacts', async () => {
    await withFixture(async (dist) => {
      await writeArtifacts(dist, 'mac', macFiles.slice(0, 1))
      await expect(verifyUpdateManifest({ artifactsDir: dist, expectedVersion: VERSION, platform: 'mac' }))
        .rejects.toThrow('macOS DMG')
    })
  })

  it('requires the top-level compatibility alias to match a file entry', async () => {
    await withFixture(async (dist) => {
      const mismatch = manifest(VERSION, winFiles).replace(/^path: .*$/mu, 'path: missing.exe')
      await writeArtifacts(dist, 'win', winFiles, mismatch)
      await expect(verifyUpdateManifest({ artifactsDir: dist, expectedVersion: VERSION, platform: 'win' }))
        .rejects.toThrow('top-level path does not match')
    })
  })

  it('requires a valid ISO release date', async () => {
    await withFixture(async (dist) => {
      const badDate = manifest(VERSION, winFiles).replace('2026-08-23T02:51:05.139Z', 'not-a-date')
      await writeArtifacts(dist, 'win', winFiles, badDate)
      await expect(verifyUpdateManifest({ artifactsDir: dist, expectedVersion: VERSION, platform: 'win' }))
        .rejects.toThrow('invalid releaseDate')
    })
  })
})
