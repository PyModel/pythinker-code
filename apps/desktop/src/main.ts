/** Electron application shell for the loopback Pythinker Web Host. */

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  session,
  shell,
  Tray,
  type Event,
  type MenuItemConstructorOptions,
} from 'electron'
import {
  flushTelemetrySync,
  initializeTelemetry,
  installCrashHandlers,
  setCrashPhase,
  track,
} from '@pymodel/pythinker-telemetry'
import {
  createHostSupervisor,
  isPortInUseError,
  parseRunningServerConflict,
  resolveDesktopPort,
  spawnPythinkerServer,
  type HostSupervisor,
} from './host-supervisor'
import { createSplashWindow } from './splash'
import {
  checkForUpdatesNow,
  getUpdateState,
  initUpdater,
  quitAndInstallNow,
  setAutoUpdate,
} from './updater'
import { windowAppearanceOptions } from './window-options'
import { createDesktopLifecycle, type DesktopLifecycle } from './window-lifecycle'

const APP_NAME = 'Pythinker'
const WINDOW_WIDTH = 1440
const WINDOW_HEIGHT = 920
const DESKTOP_DIR = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(DESKTOP_DIR, '../..')
const TELEMETRY_APP_NAME = 'pythinker-desktop'

interface TrayImages {
  readonly idle: Electron.NativeImage
  readonly running: readonly Electron.NativeImage[]
}

let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let host: HostSupervisor | undefined
let lifecycle: DesktopLifecycle | undefined
let hostOrigin: string | undefined
let bootQuitPromise: Promise<void> | undefined
let stopTrayAnimation: (() => void) | undefined
let quitReleased = false
let quitTelemetrySent = false

function desktopDeviceId(homeDir: string): string {
  const path = join(homeDir, 'device_id')
  try {
    const existing = readFileSync(path, 'utf8').trim()
    if (existing !== '') return existing
  } catch {
    // A missing or unreadable id gets a fresh in-memory value.
  }
  const id = randomUUID()
  try {
    writeFileSync(path, id, { encoding: 'utf8', mode: 0o600 })
  } catch {
    // Telemetry can still use the in-memory id.
  }
  return id
}

function initializeDesktopTelemetry(): void {
  const homeDir = app.getPath('userData')
  initializeTelemetry({
    homeDir,
    deviceId: desktopDeviceId(homeDir),
    appName: TELEMETRY_APP_NAME,
    version: app.getVersion(),
    uiMode: 'desktop',
  })
  installCrashHandlers()
  track('desktop_app_start', {
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
  })
}

/** Resolve artifacts from the checkout in development and resourcesPath when packaged. */
function hostPaths(): { nodeExecutable: string; cliEntry: string; cwd: string; electronRunAsNode: boolean } {
  if (!app.isPackaged) {
    return {
      nodeExecutable: process.env['PYTHINKER_DESKTOP_NODE_EXECUTABLE'] ?? 'node',
      cliEntry: join(REPOSITORY_ROOT, 'apps/pythinker-code/dist/launcher.mjs'),
      cwd: process.cwd(),
      electronRunAsNode: false,
    }
  }
  return {
    nodeExecutable: process.execPath,
    cliEntry: join(process.resourcesPath, 'host/node_modules/@pymodel/pythinker-code/dist/launcher.mjs'),
    cwd: app.getPath('home'),
    electronRunAsNode: true,
  }
}

function assertHostArtifacts(paths: ReturnType<typeof hostPaths>): void {
  if (isAbsolute(paths.nodeExecutable) && !existsSync(paths.nodeExecutable)) {
    throw new Error(`desktop Node runtime is missing: ${paths.nodeExecutable}`)
  }
  if (!existsSync(paths.cliEntry)) {
    throw new Error(`desktop Host entry is missing: ${paths.cliEntry}; run pnpm run build first`)
  }
}

function desktopResources(name: 'splash' | 'tray'): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'desktop-resources', name)
    : join(DESKTOP_DIR, 'resources', name)
}

function loadTrayImages(): TrayImages {
  const resources = desktopResources('tray')
  return {
    idle: nativeImage.createFromPath(join(resources, 'trayIdle@2x.png')),
    running: Array.from({ length: 8 }, (_, index) => nativeImage.createFromPath(
      join(resources, `trayRun-${String(index).padStart(2, '0')}@2x.png`),
    )),
  }
}

function startTrayAnimation(images: TrayImages): () => void {
  let index = 0
  const timer = setInterval(() => {
    const image = images.running[index]
    if (image !== undefined) tray?.setImage(image)
    index = (index + 1) % images.running.length
  }, 125)
  return () => {
    clearInterval(timer)
    tray?.setImage(images.idle)
  }
}

function isExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function hasOrigin(raw: string, expected: string): boolean {
  try {
    return new URL(raw).origin === expected
  } catch {
    return false
  }
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  const frame = event.senderFrame
  if (hostOrigin === undefined || frame === null || frame !== event.sender.mainFrame || !hasOrigin(frame.url, hostOrigin)) {
    throw new Error('desktop update IPC rejected an untrusted sender')
  }
}

/** Install navigation and permission policy before the first renderer loads. */
function hardenSession(): void {
  const desktopSession = session.defaultSession
  desktopSession.setPermissionCheckHandler(() => false)
  desktopSession.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
}

async function createMainWindow(): Promise<BrowserWindow> {
  const origin = hostOrigin
  if (origin === undefined) throw new Error('desktop Host is not ready')
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 960,
    minHeight: 640,
    show: false,
    ...windowAppearanceOptions(process.platform),
    title: APP_NAME,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(app.getAppPath(), 'dist', 'preload.cjs'),
      sandbox: true,
      webSecurity: true,
    },
  })
  mainWindow = window
  initUpdater(() => mainWindow, track)
  window.on('close', (event) => { lifecycle?.onWindowClose(event) })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (hasOrigin(url, origin)) return
    event.preventDefault()
    if (isExternalUrl(url)) void shell.openExternal(url)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const rendererUrl = new URL(origin)
  rendererUrl.searchParams.set('pythinker_desktop', '1')
  rendererUrl.searchParams.set('platform', process.platform)
  await window.loadURL(rendererUrl.href)
  if (!lifecycle?.isQuitting) window.show()
  return window
}

function showWindowSafely(): void {
  void lifecycle?.showWindow().catch((error: unknown) => {
    console.error('desktop window failed to open:', error)
  })
}

ipcMain.handle('pythinker:update:get', (event) => {
  assertTrustedSender(event)
  return getUpdateState()
})
ipcMain.handle('pythinker:update:set-auto', (event, enabled: unknown) => {
  assertTrustedSender(event)
  if (typeof enabled !== 'boolean') throw new TypeError('automatic updates must be a boolean')
  return setAutoUpdate(enabled)
})
ipcMain.handle('pythinker:update:check', (event) => {
  assertTrustedSender(event)
  return checkForUpdatesNow()
})
ipcMain.handle('pythinker:update:install', (event) => {
  assertTrustedSender(event)
  return quitAndInstallNow()
})
// Windows has no native caption buttons any more, so the renderer drives the
// window. `close()` is used rather than `destroy()` so the tray lifecycle still
// intercepts it and only hides the window.
ipcMain.handle('pythinker:window:minimize', (event) => {
  assertTrustedSender(event)
  mainWindow?.minimize()
})
ipcMain.handle('pythinker:window:toggle-maximize', (event) => {
  assertTrustedSender(event)
  const window = mainWindow
  if (window === undefined) return
  if (window.isMaximized()) window.unmaximize()
  else window.maximize()
})
ipcMain.handle('pythinker:window:close', (event) => {
  assertTrustedSender(event)
  mainWindow?.close()
})
ipcMain.handle('pythinker:theme:set-source', (event, source: unknown) => {
  assertTrustedSender(event)
  if (source === 'dark' || source === 'light' || source === 'system') {
    nativeTheme.themeSource = source
  }
})

function createTray(images: TrayImages): void {
  tray = new Tray(images.idle)
  tray.setToolTip(APP_NAME)
  const template: MenuItemConstructorOptions[] = [
    { label: 'Open Pythinker', click: showWindowSafely },
    { type: 'separator' },
    { label: 'Quit', click: () => { void requestAppQuit() } },
  ]
  tray.setContextMenu(Menu.buildFromTemplate(template))
  tray.on('click', showWindowSafely)
}

function releaseAppQuit(): void {
  stopTrayAnimation?.()
  stopTrayAnimation = undefined
  quitReleased = true
  tray?.destroy()
  tray = undefined
  app.quit()
}

/** Join explicit quit requests even while the Host or window is still starting. */
function requestAppQuit(): Promise<void> {
  if (lifecycle !== undefined) return lifecycle.requestQuit()
  bootQuitPromise ??= (host?.shutdown() ?? Promise.resolve()).catch((error: unknown) => {
    console.error('desktop shutdown failed:', error)
  }).then(() => {
    releaseAppQuit()
  })
  return bootQuitPromise
}

async function boot(): Promise<void> {
  if (process.platform === 'win32') app.setAppUserModelId('com.pythinker.desktop')
  if (bootQuitPromise !== undefined) return
  initializeDesktopTelemetry()
  const paths = hostPaths()
  const port = resolveDesktopPort(process.env, app.isPackaged)
  assertHostArtifacts(paths)
  const splash = createSplashWindow(desktopResources('splash'))
  const destroySplash = (): void => {
    if (!splash.isDestroyed()) splash.destroy()
  }

  try {
    const trayFrames = loadTrayImages()
    createTray(trayFrames)
    stopTrayAnimation = startTrayAnimation(trayFrames)
    for (;;) {
      host = createHostSupervisor({
        spawnHost: () => spawnPythinkerServer({
          ...paths,
          env: {
            ...process.env,
            PYTHINKER_DESKTOP: '1',
          },
          port,
        }),
        log: chunk => process.stderr.write(chunk),
        onUnexpectedExit: ({ code, signal }) => {
          console.error(`desktop Host exited unexpectedly (code ${String(code)}, signal ${String(signal)})`)
          void requestAppQuit()
        },
      })
      try {
        hostOrigin = await host.start()
        track('desktop_server_ready')
        break
      } catch (error) {
        track('desktop_server_failed')
        const message = error instanceof Error ? error.message : String(error)

        const conflict = parseRunningServerConflict(message)
        if (conflict !== undefined) {
          const conflicted = await dialog.showMessageBox({
            type: 'error',
            buttons: ['Retry', 'Quit'],
            defaultId: 0,
            cancelId: 1,
            title: `${APP_NAME} cannot start its server`,
            message: `Another Pythinker server is already running (process ${String(conflict.pid)} on port ${String(conflict.port)}, started ${conflict.startedAt}). Only one server can run at a time, because they would share the same session files. Stop that server, then retry.`,
          })
          if (conflicted.response === 0) continue
          await requestAppQuit()
          return
        }

        if (!isPortInUseError(message)) throw error

        const result = await dialog.showMessageBox({
          type: 'error',
          buttons: ['Retry', 'Quit'],
          defaultId: 0,
          cancelId: 1,
          title: `${APP_NAME} needs its fixed port`,
          message: `${APP_NAME} cannot use port ${String(port)}. It needs this fixed port so settings persist between launches. Free the port, or set PYTHINKER_DESKTOP_PORT to an unused port.`,
        })
        if (result.response === 0) continue
        await requestAppQuit()
        return
      }
    }
    stopTrayAnimation?.()
    stopTrayAnimation = undefined
    hardenSession()
    lifecycle = createDesktopLifecycle({
      getWindow: () => mainWindow,
      createWindow: createMainWindow,
      disposeHost: async () => { await host?.shutdown() },
      quit: releaseAppQuit,
      reportError: (error) => { console.error('desktop shutdown failed:', error) },
    })
    await lifecycle.showWindow()
    setCrashPhase('runtime')
    destroySplash()
  } catch (error) {
    stopTrayAnimation?.()
    stopTrayAnimation = undefined
    destroySplash()
    throw error
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Update-triggered quits close windows before app.before-quit, so start teardown here.
  autoUpdater.on('before-quit-for-update', () => { void requestAppQuit() })
  app.on('second-instance', showWindowSafely)
  app.on('activate', showWindowSafely)
  app.on('window-all-closed', () => {
    // Tray and Host own application lifetime on every platform.
  })
  app.on('before-quit', (event: Event) => {
    if (!quitTelemetrySent) {
      quitTelemetrySent = true
      setCrashPhase('shutdown')
      track('desktop_app_quit')
      flushTelemetrySync()
    }
    if (quitReleased) return
    event.preventDefault()
    void requestAppQuit()
  })
  app.whenReady().then(boot).catch(async (error: unknown) => {
    console.error('desktop startup failed:', error)
    if (bootQuitPromise === undefined) {
      await dialog.showMessageBox({
        type: 'error',
        title: `${APP_NAME} failed to start`,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    await requestAppQuit()
  })
}
