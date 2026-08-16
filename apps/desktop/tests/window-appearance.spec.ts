// Static check: no Windows host exists in CI or locally, so this test guards the
// window configuration rather than the rendered result.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = resolve(import.meta.dirname, '..')
const mainSource = readFileSync(resolve(desktopRoot, 'src', 'main.ts'), 'utf8')

describe('desktop window appearance configuration', () => {
  it('keeps Windows opaque and non-Windows windows transparent', () => {
    const backgroundMaterialMatches = [...mainSource.matchAll(/backgroundMaterial/g)]
    const win32BranchMatches = [...mainSource.matchAll(
      /\.\.\.\(process\.platform === 'win32' \? \{([\s\S]*?)\} : \{\s*transparent: true,/g,
    )]
    const nonWin32BranchMatches = [...mainSource.matchAll(
      /\} : \{\s*transparent: true,[\s\S]*?\}\),\s*title:/g,
    )]

    expect(backgroundMaterialMatches).toHaveLength(0)
    expect(win32BranchMatches).toHaveLength(1)
    expect(nonWin32BranchMatches).toHaveLength(1)

    const win32Branch = win32BranchMatches[0]![1]!
    const opaqueColorMatches = [...win32Branch.matchAll(/backgroundColor:\s*'#[0-9a-fA-F]{6}'/g)]
    const alphaColorMatches = [...win32Branch.matchAll(/#[0-9a-fA-F]{8}/g)]
    const hasShadowMatches = [...win32Branch.matchAll(/hasShadow:\s*true/g)]
    const roundedCornersMatches = [...win32Branch.matchAll(/roundedCorners:\s*true/g)]
    const thickFrameMatches = [...win32Branch.matchAll(/thickFrame:\s*true/g)]

    expect(opaqueColorMatches).toHaveLength(1)
    expect(alphaColorMatches).toHaveLength(0)
    expect(hasShadowMatches).toHaveLength(1)
    expect(roundedCornersMatches).toHaveLength(1)
    expect(thickFrameMatches).toHaveLength(1)

    expect(win32Branch).toContain('backgroundColor')
    expect(nonWin32BranchMatches[0]![0]).toContain('transparent: true')
    expect(win32Branch).toContain('hasShadow')
    expect(win32Branch).toContain('roundedCorners')
    expect(win32Branch).toContain('thickFrame')
  })
})
