// Static check: no Windows host exists in CI or locally, so this test guards the
// window configuration rather than the rendered result.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = resolve(import.meta.dirname, '..')
const mainSource = readFileSync(resolve(desktopRoot, 'src', 'main.ts'), 'utf8')

describe('desktop window appearance configuration', () => {
  it('keeps the main window opaque on every platform', () => {
    const backgroundMaterialMatches = [...mainSource.matchAll(/backgroundMaterial/gu)]
    const mainWindowOptionMatches = [...mainSource.matchAll(
      /const window = new BrowserWindow\(\{([\s\S]*?)\n  \}\)/gu,
    )]

    expect(backgroundMaterialMatches).toHaveLength(0)
    expect(mainWindowOptionMatches).toHaveLength(1)

    const mainWindowOptions = mainWindowOptionMatches[0]![1]!
    const vibrancyMatches = [...mainWindowOptions.matchAll(/vibrancy\s*:/gu)]
    const visualEffectStateMatches = [...mainWindowOptions.matchAll(/visualEffectState\s*:/gu)]
    const transparentMatches = [...mainWindowOptions.matchAll(/transparent:\s*true/gu)]
    const backgroundColorMatches = [...mainWindowOptions.matchAll(
      /backgroundColor:\s*'(#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)'/gu,
    )]
    const transparentBackgroundMatches = backgroundColorMatches.filter(
      (match) => match[1]!.length === 9 && match[1]!.endsWith('00'),
    )
    const hasShadowMatches = [...mainWindowOptions.matchAll(
      /hasShadow:\s*process\.platform === 'win32' \? true : undefined/gu,
    )]
    const roundedCornersMatches = [...mainWindowOptions.matchAll(
      /roundedCorners:\s*process\.platform === 'win32' \? true : undefined/gu,
    )]
    const thickFrameMatches = [...mainWindowOptions.matchAll(
      /thickFrame:\s*process\.platform === 'win32' \? true : undefined/gu,
    )]

    expect(vibrancyMatches).toHaveLength(0)
    expect(visualEffectStateMatches).toHaveLength(0)
    expect(transparentMatches).toHaveLength(0)
    expect(backgroundColorMatches).toHaveLength(1)
    expect(backgroundColorMatches[0]![1]).not.toBe('#00000000')
    expect(transparentBackgroundMatches).toHaveLength(0)
    expect(hasShadowMatches).toHaveLength(1)
    expect(roundedCornersMatches).toHaveLength(1)
    expect(thickFrameMatches).toHaveLength(1)

    expect(mainWindowOptions).toContain('backgroundColor')
    expect(mainWindowOptions).toContain('hasShadow')
    expect(mainWindowOptions).toContain('roundedCorners')
    expect(mainWindowOptions).toContain('thickFrame')
  })
})
