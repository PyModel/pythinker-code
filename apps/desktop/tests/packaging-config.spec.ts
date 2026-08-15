import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface DesktopPackage {
  readonly scripts: Readonly<Record<string, string>>
  readonly build: {
    readonly afterPack: string
    readonly appId: string
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
    readonly productName: string
    readonly win: { readonly icon: string }
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

describe('desktop packaging configuration', () => {
  it('packages the application with expected metadata', () => {
    expect(desktopPackage.build.appId).toBe('com.pythinker.desktop')
    expect(desktopPackage.build.productName).toBe('Pythinker')
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
      .toBe('50294e23ec2763e0602dbf68bb0528d410ff6d3bb92b01e6a1d2dd683f342751')
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
  })

  it('exposes desktop commands at the repository root', () => {
    expect(rootPackage.scripts['dev:desktop']).toBe('pnpm -C apps/desktop run dev')
    expect(rootPackage.scripts['package:desktop']).toBe('pnpm -C apps/desktop run package')
    expect(rootPackage.scripts['dist:mac:desktop']).toBe('pnpm -C apps/desktop run dist:mac')
  })
})
