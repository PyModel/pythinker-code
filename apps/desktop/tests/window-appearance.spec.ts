// Static check: no Windows host exists in CI or locally, so this test guards the
// window configuration rather than the rendered result.
import { describe, expect, it } from 'vitest'
import { windowAppearanceOptions } from '../src/window-options'

describe('desktop window appearance configuration', () => {
  it('uses the reference macOS frame and vibrancy configuration', () => {
    const opts = windowAppearanceOptions('darwin')

    expect('frame' in opts).toBe(false)
    expect(opts['titleBarStyle']).toBe('hiddenInset')
    expect(opts['trafficLightPosition']).toEqual({ x: 16, y: 16 })
    expect(opts['transparent']).toBe(true)
    expect(opts['vibrancy']).toBe('sidebar')
  })

  it('keeps the Windows window configuration unchanged', () => {
    const opts = windowAppearanceOptions('win32')

    expect(opts).toMatchObject({
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: '#7f858f', height: 44 },
      backgroundColor: '#161616',
      hasShadow: true,
      roundedCorners: true,
      thickFrame: true,
    })
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
})
