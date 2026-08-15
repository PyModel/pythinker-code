import { join } from 'node:path'
import { BrowserWindow } from 'electron'

/** Create the transparent animated boot splash. */
export function createSplashWindow(resourcesDir: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 280,
    height: 300,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    center: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  void window.loadFile(join(resourcesDir, 'splash.html'))
  return window
}
