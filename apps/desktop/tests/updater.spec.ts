import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => ''),
    once: vi.fn(),
  },
}))

vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      on: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(() => Promise.resolve([])),
      quitAndInstall: vi.fn(),
    },
  },
}))

import { app } from 'electron'
import electronUpdater from 'electron-updater'
import {
  getUpdateState,
  initUpdater,
  readUpdateSettings,
  trackUpdateTransition,
  writeUpdateSettings,
  type UpdateState,
} from '../src/updater'

const temporaryDirectories: string[] = []
const resourcesPathDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
const { autoUpdater } = electronUpdater

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
  Object.defineProperty(app, 'isPackaged', { configurable: true, value: false })
  vi.mocked(app.getPath).mockReset()
  vi.mocked(app.getPath).mockReturnValue('')
  if (resourcesPathDescriptor === undefined) {
    Reflect.deleteProperty(process, 'resourcesPath')
  } else {
    Object.defineProperty(process, 'resourcesPath', resourcesPathDescriptor)
  }
  vi.clearAllMocks()
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'pythinker-updater-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('update settings', () => {
  it('defaults automatic updates to enabled when the file is missing', () => {
    expect(readUpdateSettings(temporaryDirectory())).toEqual({ autoUpdate: true })
  })

  it('defaults automatic updates to enabled when the file is corrupt', () => {
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'update-settings.json'), '{not-json', 'utf8')

    expect(readUpdateSettings(directory)).toEqual({ autoUpdate: true })
  })

  it('round-trips the automatic-updates setting', () => {
    const directory = temporaryDirectory()
    writeUpdateSettings(directory, { autoUpdate: false })

    expect(readUpdateSettings(directory)).toEqual({ autoUpdate: false })
  })
})

describe('update telemetry transitions', () => {
  it('emits the expected lifecycle event names', () => {
    const events: string[] = []
    const track = (event: string): void => {
      events.push(event)
    }
    const previous: UpdateState = { status: 'idle', autoUpdate: true }

    trackUpdateTransition(previous, { ...previous, status: 'checking' }, track)
    trackUpdateTransition(previous, { ...previous, status: 'available', version: '0.2.0' }, track)
    trackUpdateTransition(previous, { ...previous, status: 'downloaded', version: '0.2.0' }, track)
    trackUpdateTransition(previous, { ...previous, status: 'error', message: 'download failed' }, track)

    expect(events).toEqual([
      'desktop_update_check',
      'desktop_update_available',
      'desktop_update_downloaded',
      'desktop_update_error',
    ])
  })
})

describe('packaged builds without update metadata', () => {
  it('disables updates without wiring updater events', () => {
    const directory = temporaryDirectory()
    writeUpdateSettings(directory, { autoUpdate: false })
    vi.mocked(app.getPath).mockReturnValue(directory)
    Object.defineProperty(app, 'isPackaged', { configurable: true, value: true })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })

    initUpdater(() => undefined)

    expect(getUpdateState()).toMatchObject({
      status: 'disabled',
      message: 'Updates are not available for this build',
      autoUpdate: false,
    })
    expect(autoUpdater.on).not.toHaveBeenCalled()
    expect(app.once).not.toHaveBeenCalled()
  })
})

describe('installing an update', () => {
  it('downloads an available update and installs it when the download completes', async () => {
    vi.resetModules()
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'app-update.yml'), '', 'utf8')
    const { app: localApp } = await import('electron')
    const { default: localElectronUpdater } = await import('electron-updater')
    const {
      initUpdater: initLocalUpdater,
      quitAndInstallNow,
    } = await import('../src/updater')
    const localAutoUpdater = localElectronUpdater.autoUpdater
    vi.mocked(localApp.getPath).mockReturnValue(directory)
    Object.defineProperty(localApp, 'isPackaged', { configurable: true, value: true })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })

    initLocalUpdater(() => undefined)
    const available = vi.mocked(localAutoUpdater.on).mock.calls.find(([event]) => event === 'update-available')?.[1] as ((info: { version: string }) => void) | undefined
    const downloaded = vi.mocked(localAutoUpdater.on).mock.calls.find(([event]) => event === 'update-downloaded')?.[1] as ((info: { version: string }) => void) | undefined
    available?.({ version: '1.2.3' })

    expect(quitAndInstallNow()).toMatchObject({ status: 'downloading' })
    expect(localAutoUpdater.downloadUpdate).toHaveBeenCalledOnce()
    expect(localAutoUpdater.quitAndInstall).not.toHaveBeenCalled()

    downloaded?.({ version: '1.2.3' })
    expect(localAutoUpdater.quitAndInstall).toHaveBeenCalledOnce()
  })
})
