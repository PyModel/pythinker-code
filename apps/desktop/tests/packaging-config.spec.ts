import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface DesktopPackage {
  readonly scripts: Readonly<Record<string, string>>
  readonly build: {
    readonly afterPack: string
    readonly appId: string
    readonly dmg: {
      readonly contents: readonly {
        readonly path?: string
        readonly type: string
        readonly x: number
        readonly y: number
      }[]
      readonly iconSize: number
      readonly sign: boolean
      readonly title: string
      readonly window: {
        readonly height: number
        readonly width: number
      }
    }
    readonly electronDist?: string
    readonly extraResources: readonly {
      readonly from: string
      readonly to: string
    }[]
    readonly mac: {
      readonly hardenedRuntime: boolean
      readonly icon: string
      readonly notarize: boolean
    }
    readonly nsis: {
      readonly allowElevation: boolean
      readonly allowToChangeInstallationDirectory: boolean
      readonly artifactName: string
      readonly createDesktopShortcut: boolean
      readonly createStartMenuShortcut: boolean
      readonly oneClick: boolean
      readonly perMachine: boolean
      readonly shortcutName: string
    }
    readonly publish: readonly {
      readonly owner: string
      readonly provider: string
      readonly releaseType: string
      readonly repo: string
    }[]
    readonly productName: string
    readonly win: {
      readonly icon: string
      readonly target: readonly {
        readonly target: string
        readonly arch: readonly string[]
      }[]
    }
  }
}

interface RootPackage {
  readonly scripts: Readonly<Record<string, string>>
}

const desktopRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(desktopRoot, '../..')
const desktopPackage = JSON.parse(
  readFileSync(resolve(desktopRoot, 'package.json'), 'utf8'),
) as DesktopPackage
const rootPackage = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
) as RootPackage
const releaseMacSource = readFileSync(resolve(desktopRoot, 'scripts/release-mac.ts'), 'utf8')

describe('desktop packaging configuration', () => {
  it('packages the application with expected metadata', () => {
    expect(desktopPackage.build.appId).toBe('com.pythinker.desktop')
    expect(desktopPackage.build.productName).toBe('Pythinker')
  })

  it('publishes updates to the dedicated desktop release repository', () => {
    expect(desktopPackage.build.publish).toContainEqual({
      owner: 'PyModel',
      provider: 'github',
      releaseType: 'release',
      repo: 'pythinker-desktop-releases',
    })
  })

  it('maps the staged Host node_modules directory as the copy root', () => {
    expect(desktopPackage.build.extraResources).toEqual(expect.arrayContaining([
      { from: 'resources', to: 'desktop-resources' },
      { from: 'runtime-host/package.json', to: 'host/package.json' },
      { from: 'runtime-host/node_modules', to: 'host/node_modules' },
    ]))
    expect(desktopPackage.build.afterPack).toBe('./scripts/verify-packaged-runtime.ts')
    expect(existsSync(resolve(desktopRoot, 'resources/tray/trayIdle@2x.png'))).toBe(true)
    expect(existsSync(resolve(desktopRoot, 'resources/splash/idle-00.png'))).toBe(true)
  })

  it('keeps the supplied image byte-for-byte and shares it across macOS and Windows', () => {
    const icon = readFileSync(resolve(desktopRoot, 'build/icon.png'))

    expect(createHash('sha256').update(icon).digest('hex'))
      .toBe('e31d6fe302ffdb5efa07dd765f7d9c68857b64be379c482f95b1828ae5a3174f')
    expect(desktopPackage.build.mac.icon).toBe('build/icon.png')
    expect(desktopPackage.build.win.icon).toBe('build/icon.png')
  })

  it('builds and stages the complete workspace before local packaging', () => {
    for (const name of ['package', 'dist']) {
      expect(desktopPackage.scripts[name]).toContain('pnpm --workspace-root run build')
      expect(desktopPackage.scripts[name]).toContain('scripts/stage-runtime.ts')
    }
    expect(desktopPackage.scripts['package']).toContain('electron-builder --dir')
    expect(desktopPackage.scripts['package']).not.toContain('release-preflight.ts')
  })

  it('makes the macOS DMG path signed, hardened, and notarized', () => {
    const command = desktopPackage.scripts['dist:mac']

    expect(command).toBe('node --import tsx scripts/release-mac.ts')
    expect(desktopPackage.build.mac.hardenedRuntime).toBe(true)
    expect(desktopPackage.build.mac.notarize).toBe(true)
    expect(desktopPackage.build.dmg.sign).toBe(true)
    expect(releaseMacSource).toContain("'--mac', 'dmg'")
  })

  it('lays out the macOS DMG installer window', () => {
    expect(desktopPackage.build.dmg).toMatchObject({
      iconSize: 128,
      title: 'Pythinker ${version}',
      window: { height: 400, width: 660 },
    })
    expect(desktopPackage.build.dmg.contents).toEqual([
      { x: 180, y: 200, type: 'file' },
      { x: 480, y: 200, type: 'link', path: '/Applications' },
    ])
  })

  it('configures the Windows x64 NSIS installer', () => {
    expect(desktopPackage.build.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }])
    expect(desktopPackage.build.nsis).toEqual({
      allowElevation: false,
      allowToChangeInstallationDirectory: true,
      artifactName: 'Pythinker-${version}-${arch}-Setup.${ext}',
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      oneClick: false,
      perMachine: false,
      shortcutName: 'Pythinker',
    })
    expect(desktopPackage.build.nsis.artifactName).toBe('Pythinker-${version}-${arch}-Setup.${ext}')
    expect(desktopPackage.build.productName).toBe('Pythinker')
    expect(desktopPackage.scripts['dist:win']).toBe('node --import tsx scripts/release-win.ts')
  })

  it('offers an assisted installer that defaults to a per-user install', () => {
    expect(desktopPackage.build.nsis.oneClick).toBe(false)
    expect(desktopPackage.build.nsis.perMachine).toBe(false)
    expect(desktopPackage.build.nsis.allowElevation).toBe(false)
  })

  it('exposes desktop commands at the repository root', () => {
    expect(rootPackage.scripts['dev:desktop']).toBe('pnpm -C apps/desktop run dev')
    expect(rootPackage.scripts['package:desktop']).toBe('pnpm -C apps/desktop run package')
    expect(rootPackage.scripts['dist:mac:desktop']).toBe('pnpm -C apps/desktop run dist:mac')
    expect(rootPackage.scripts['dist:win:desktop']).toBe('pnpm -C apps/desktop run dist:win')
  })
})
