import type { BrowserWindowConstructorOptions } from 'electron'

export function windowAppearanceOptions(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  if (platform === 'darwin') {
    return {
      autoHideMenuBar: true,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
      // A transparent NSWindow is non-opaque with a clear background, which
      // removes native corners and shadow. Vibrancy does not require it.
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
    }
  }
  if (platform === 'win32') {
    return {
      // No `titleBarOverlay`: the renderer draws macOS-style round controls in
      // the top-right instead. `thickFrame` keeps the native resize border,
      // shadow and drag-to-snap that `frame: false` would remove.
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      backgroundColor: '#161616',
      hasShadow: true,
      roundedCorners: true,
      thickFrame: true,
    }
  }
  return {
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#7f858f', height: 44 },
    backgroundColor: '#161616',
  }
}
