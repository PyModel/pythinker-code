// Static check: no Windows host exists in CI or locally, so this test guards the
// window configuration rather than the rendered result.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { windowAppearanceOptions } from '../src/window-options'

describe('desktop window appearance configuration', () => {
  it('uses the native macOS frame with vibrancy', () => {
    const opts = windowAppearanceOptions('darwin')

    expect('frame' in opts).toBe(false)
    expect(opts['titleBarStyle']).toBe('hiddenInset')
    expect(opts['trafficLightPosition']).toEqual({ x: 16, y: 16 })
    // Native corners and shadow require an opaque window.
    expect('transparent' in opts).toBe(false)
    expect('backgroundColor' in opts).toBe(false)
    expect(opts['vibrancy']).toBe('sidebar')
  })

  it('leaves the Windows caption buttons to the renderer', () => {
    const opts = windowAppearanceOptions('win32')

    expect(opts).toMatchObject({
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      backgroundColor: '#161616',
      hasShadow: true,
      roundedCorners: true,
      thickFrame: true,
    })
    // The overlay would draw native caption buttons on top of the round ones
    // the renderer paints, so it has to stay off.
    expect('titleBarOverlay' in opts).toBe(false)
    // `thickFrame` without `frame: false` keeps the native resize border.
    expect('frame' in opts).toBe(false)
  })

  it('keeps the Linux window configuration unchanged', () => {
    expect(windowAppearanceOptions('linux')).toEqual({
      autoHideMenuBar: true,
      frame: false,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: '#7f858f', height: 44 },
      backgroundColor: '#161616',
    })
  })

  it('marks the renderer URL as desktop and includes the platform', () => {
    const main = readFileSync(join(import.meta.dirname, '../src/main.ts'), 'utf8')

    expect(main).toContain("rendererUrl.searchParams.set('pythinker_desktop', '1')")
    expect(main).toContain("rendererUrl.searchParams.set('platform', process.platform)")
    expect(main).not.toContain("rendererUrl.searchParams.set('pythinker-desktop-platform'")
  })
})
