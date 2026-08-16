// Static check: no Windows host exists in CI or locally, so this test guards the
// window configuration rather than the rendered result.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = resolve(import.meta.dirname, '..')
const mainSource = readFileSync(resolve(desktopRoot, 'src', 'main.ts'), 'utf8')

describe('desktop window appearance configuration', () => {
  it('uses macOS vibrancy and keeps other platforms opaque', () => {
    const backgroundMaterialMatches = [...mainSource.matchAll(/backgroundMaterial/gu)]
    const mainWindowOptionMatches = [...mainSource.matchAll(
      /const window = new BrowserWindow\(\{([\s\S]*?)\n  \}\)/gu,
    )]

    expect(backgroundMaterialMatches).toHaveLength(0)
    expect(mainWindowOptionMatches).toHaveLength(1)

    const mainWindowOptions = mainWindowOptionMatches[0]![1]!
    const hasShadowMatches = [...mainWindowOptions.matchAll(
      /hasShadow:\s*process\.platform === 'win32' \? true : undefined/gu,
    )]
    const roundedCornersMatches = [...mainWindowOptions.matchAll(
      /roundedCorners:\s*process\.platform === 'win32' \? true : undefined/gu,
    )]
    const thickFrameMatches = [...mainWindowOptions.matchAll(
      /thickFrame:\s*process\.platform === 'win32' \? true : undefined/gu,
    )]

    expect(mainWindowOptions).toContain("frame: process.platform === 'win32' ? true : process.platform === 'linux' ? false : undefined")
    expect(mainWindowOptions).toContain("vibrancy: process.platform === 'darwin' ? 'sidebar' : undefined")
    expect(mainWindowOptions).toContain("visualEffectState: process.platform === 'darwin' ? 'followWindow' : undefined")
    expect(mainWindowOptions).toContain("transparent: process.platform === 'darwin' ? true : undefined")
    expect(mainWindowOptions).toContain("backgroundColor: process.platform === 'darwin' ? '#00000000' : '#161616'")
    expect(hasShadowMatches).toHaveLength(1)
    expect(roundedCornersMatches).toHaveLength(1)
    expect(thickFrameMatches).toHaveLength(1)

    expect(mainWindowOptions).toContain('hasShadow')
    expect(mainWindowOptions).toContain('roundedCorners')
    expect(mainWindowOptions).toContain('thickFrame')
  })
})
