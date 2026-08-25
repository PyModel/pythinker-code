import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => ''),
    getVersion: vi.fn(() => '1.0.0'),
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
  updateReleaseNotesUrl,
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
  vi.mocked(app.getVersion).mockReset()
  vi.mocked(app.getVersion).mockReturnValue('1.0.0')
  if (resourcesPathDescriptor === undefined) {
    Reflect.deleteProperty(process, 'resourcesPath')
  } else {
    Object.defineProperty(process, 'resourcesPath', resourcesPathDescriptor)
  }
  vi.clearAllMocks()
  autoUpdater.autoDownload = undefined as unknown as boolean
  autoUpdater.autoInstallOnAppQuit = undefined as unknown as boolean
  autoUpdater.allowPrerelease = undefined as unknown as boolean
  autoUpdater.allowDowngrade = undefined as unknown as boolean
  autoUpdater.channel = null
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'pythinker-updater-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('update settings', () => {
  it('defaults automatic updates to enabled when the file is missing', () => {
    expect(readUpdateSettings(temporaryDirectory())).toEqual({
      autoUpdate: true,
      channel: 'stable',
      notifyUpdate: true,
    })
  })

  it('defaults automatic updates to enabled when the file is corrupt', () => {
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'update-settings.json'), '{not-json', 'utf8')

    expect(readUpdateSettings(directory)).toEqual({
      autoUpdate: true,
      channel: 'stable',
      notifyUpdate: true,
    })
  })

  it('round-trips automatic checks, update notifications, and the channel', () => {
    const directory = temporaryDirectory()
    writeUpdateSettings(directory, {
      autoUpdate: false,
      channel: 'beta',
      notifyUpdate: false,
    })

    expect(readUpdateSettings(directory)).toEqual({
      autoUpdate: false,
      channel: 'beta',
      notifyUpdate: false,
    })
  })

  it('uses safe defaults for missing or invalid new settings', () => {
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'update-settings.json'), '{"autoUpdate":false,"channel":"preview"}\n', 'utf8')

    expect(readUpdateSettings(directory)).toEqual({
      autoUpdate: false,
      channel: 'stable',
      notifyUpdate: true,
    })
  })

  it('persists update notification, skip, install, and completion receipts separately', () => {
    const directory = temporaryDirectory()
    const value = {
      autoUpdate: true,
      channel: 'nightly' as const,
      notifyUpdate: true,
      notifiedVersion: '1.2.3',
      skippedVersion: '1.2.3',
      pendingInstallVersion: '1.3.0',
      completedVersion: '1.1.0',
      lastRunVersion: '1.1.0',
    }

    writeUpdateSettings(directory, value)

    expect(readUpdateSettings(directory)).toEqual(value)
  })
})

describe('update telemetry transitions', () => {
  it('emits the expected lifecycle event names', () => {
    const events: string[] = []
    const track = (event: string): void => {
      events.push(event)
    }
    const previous: UpdateState = {
      status: 'idle',
      installedVersion: '1.0.0',
      autoUpdate: true,
      channel: 'stable',
      notifyUpdate: true,
    }

    trackUpdateTransition(previous, { ...previous, status: 'checking' }, track)
    trackUpdateTransition(previous, { ...previous, status: 'available', availableVersion: '0.2.0' }, track)
    trackUpdateTransition(previous, { ...previous, status: 'downloaded', availableVersion: '0.2.0' }, track)
    trackUpdateTransition(previous, { ...previous, status: 'error', message: 'download failed' }, track)

    expect(events).toEqual([
      'desktop_update_check',
      'desktop_update_available',
      'desktop_update_downloaded',
      'desktop_update_error',
    ])
  })
})

describe('release notes URL', () => {
  it('constructs only the known HTTPS release URL from an exact semantic version', () => {
    expect(updateReleaseNotesUrl('1.2.3')).toBe(
      'https://github.com/PyModel/pythinker-desktop-releases/releases/tag/v1.2.3',
    )
    expect(updateReleaseNotesUrl('v1.2.3')).toBeUndefined()
    expect(updateReleaseNotesUrl('1.2.3/../../malicious')).toBeUndefined()
    expect(updateReleaseNotesUrl('https://example.test')).toBeUndefined()
  })
})

describe('packaged builds without update metadata', () => {
  it('disables updates without wiring updater events', () => {
    const directory = temporaryDirectory()
    writeUpdateSettings(directory, {
      autoUpdate: false,
      channel: 'stable',
      notifyUpdate: true,
    })
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

describe('strict update consent', () => {
  it('changes channels and notification preference without checking, downloading, installing, or downgrading', async () => {
    vi.resetModules()
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'app-update.yml'), '', 'utf8')
    writeFileSync(
      join(directory, 'update-settings.json'),
      '{"autoUpdate":false,"channel":"beta","notifyUpdate":true}\n',
      'utf8',
    )
    const { app: localApp } = await import('electron')
    const { default: localElectronUpdater } = await import('electron-updater')
    const {
      initUpdater: initLocalUpdater,
      setNotifyUpdate: setLocalNotifyUpdate,
      setUpdateChannel: setLocalUpdateChannel,
    } = await import('../src/updater')
    const localAutoUpdater = localElectronUpdater.autoUpdater
    vi.mocked(localApp.getPath).mockReturnValue(directory)
    Object.defineProperty(localApp, 'isPackaged', { configurable: true, value: true })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })

    initLocalUpdater(() => undefined)
    expect(localAutoUpdater.channel).toBe('beta')
    expect(localAutoUpdater.allowPrerelease).toBe(true)
    expect(localAutoUpdater.allowDowngrade).toBe(false)

    expect(setLocalUpdateChannel('nightly')).toMatchObject({ channel: 'nightly', status: 'idle' })
    expect(setLocalNotifyUpdate(false)).toMatchObject({ notifyUpdate: false })
    expect(setLocalUpdateChannel('stable')).toMatchObject({ channel: 'stable', status: 'idle' })
    expect(localAutoUpdater.channel).toBeNull()
    expect(localAutoUpdater.allowPrerelease).toBe(false)
    expect(localAutoUpdater.allowDowngrade).toBe(false)
    expect(localAutoUpdater.autoDownload).toBe(false)
    expect(localAutoUpdater.autoInstallOnAppQuit).toBe(false)
    expect(localAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
    expect(localAutoUpdater.downloadUpdate).not.toHaveBeenCalled()
    expect(localAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('manual check cannot download an update', async () => {
    vi.resetModules()
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'app-update.yml'), '', 'utf8')
    writeFileSync(join(directory, 'update-settings.json'), '{"autoUpdate":false}\n', 'utf8')
    const { app: localApp } = await import('electron')
    const { default: localElectronUpdater } = await import('electron-updater')
    const {
      checkForUpdatesNow,
      initUpdater: initLocalUpdater,
    } = await import('../src/updater')
    const localAutoUpdater = localElectronUpdater.autoUpdater
    vi.mocked(localApp.getPath).mockReturnValue(directory)
    Object.defineProperty(localApp, 'isPackaged', { configurable: true, value: true })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })
    let autoDownloadDuringCheck: boolean | undefined
    vi.mocked(localAutoUpdater.checkForUpdates).mockImplementationOnce(() => {
      autoDownloadDuringCheck = localAutoUpdater.autoDownload
      return Promise.resolve(null)
    })

    initLocalUpdater(() => undefined)
    await checkForUpdatesNow()

    expect(localAutoUpdater.autoDownload).toBe(false)
    expect(autoDownloadDuringCheck).toBe(false)
    expect(localAutoUpdater.checkForUpdates).toHaveBeenCalledOnce()
    expect(localAutoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('normal quit after download cannot install', async () => {
    vi.resetModules()
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'app-update.yml'), '', 'utf8')
    writeFileSync(join(directory, 'update-settings.json'), '{"autoUpdate":true}\n', 'utf8')
    const { app: localApp } = await import('electron')
    const { default: localElectronUpdater } = await import('electron-updater')
    const { initUpdater: initLocalUpdater } = await import('../src/updater')
    const localAutoUpdater = localElectronUpdater.autoUpdater
    vi.mocked(localApp.getPath).mockReturnValue(directory)
    Object.defineProperty(localApp, 'isPackaged', { configurable: true, value: true })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })

    initLocalUpdater(() => undefined)
    const downloaded = vi.mocked(localAutoUpdater.on).mock.calls.find(([event]) => event === 'update-downloaded')?.[1] as ((info: { version: string }) => void) | undefined
    downloaded?.({ version: '1.2.3' })

    expect(localAutoUpdater.autoInstallOnAppQuit).toBe(false)
    expect(localAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('skip cannot download or install and a newer release supersedes it', async () => {
    vi.resetModules()
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'app-update.yml'), '', 'utf8')
    writeFileSync(join(directory, 'update-settings.json'), '{"autoUpdate":false}\n', 'utf8')
    const { app: localApp } = await import('electron')
    const { default: localElectronUpdater } = await import('electron-updater')
    const {
      getUpdateState: getLocalUpdateState,
      initUpdater: initLocalUpdater,
      installDownloadedUpdateNow: installLocalUpdate,
      skipUpdate: skipLocalUpdate,
      startUpdateDownload: startLocalUpdateDownload,
    } = await import('../src/updater')
    const localAutoUpdater = localElectronUpdater.autoUpdater
    vi.mocked(localApp.getPath).mockReturnValue(directory)
    Object.defineProperty(localApp, 'isPackaged', { configurable: true, value: true })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })

    initLocalUpdater(() => undefined)
    const available = vi.mocked(localAutoUpdater.on).mock.calls.find(([event]) => event === 'update-available')?.[1] as ((info: { version: string }) => void) | undefined
    available?.({ version: '1.2.3' })
    expect(skipLocalUpdate('1.2.3')).toMatchObject({ status: 'skipped', availableVersion: '1.2.3' })
    expect(startLocalUpdateDownload()).toMatchObject({ status: 'skipped' })
    expect(installLocalUpdate()).toMatchObject({ status: 'skipped' })
    expect(localAutoUpdater.downloadUpdate).not.toHaveBeenCalled()
    expect(localAutoUpdater.quitAndInstall).not.toHaveBeenCalled()

    available?.({ version: '1.2.4' })
    expect(getLocalUpdateState()).toMatchObject({ status: 'available', availableVersion: '1.2.4' })
  })

  it('maps release metadata and byte progress into the authoritative state', async () => {
    vi.resetModules()
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'app-update.yml'), '', 'utf8')
    writeFileSync(join(directory, 'update-settings.json'), '{"autoUpdate":false}\n', 'utf8')
    const { app: localApp } = await import('electron')
    const { default: localElectronUpdater } = await import('electron-updater')
    const {
      getUpdateState: getLocalUpdateState,
      initUpdater: initLocalUpdater,
    } = await import('../src/updater')
    vi.mocked(localApp.getPath).mockReturnValue(directory)
    Object.defineProperty(localApp, 'isPackaged', { configurable: true, value: true })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })

    initLocalUpdater(() => undefined)
    const available = vi.mocked(localElectronUpdater.autoUpdater.on).mock.calls.find(
      ([event]) => event === 'update-available',
    )?.[1] as ((info: {
      version: string
      releaseDate: string
      releaseNotes: Array<{ note: string | null }>
    }) => void) | undefined
    const progress = vi.mocked(localElectronUpdater.autoUpdater.on).mock.calls.find(
      ([event]) => event === 'download-progress',
    )?.[1] as ((info: {
      percent: number
      transferred: number
      total: number
      bytesPerSecond: number
    }) => void) | undefined

    available?.({
      version: '1.2.3',
      releaseDate: '2026-08-22T12:00:00.000Z',
      releaseNotes: [{ note: 'First change' }, { note: null }, { note: 'Second change' }],
    })
    progress?.({ percent: 42.5, transferred: 425, total: 1_000, bytesPerSecond: 85 })

    expect(getLocalUpdateState()).toMatchObject({
      status: 'downloading',
      installedVersion: '1.0.0',
      availableVersion: '1.2.3',
      releaseDate: '2026-08-22T12:00:00.000Z',
      releaseNotes: 'First change\n\nSecond change',
      percent: 42.5,
      transferred: 425,
      total: 1_000,
      bytesPerSecond: 85,
    })
  })

  it('downloads and installs only through separate explicit actions', async () => {
    vi.resetModules()
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'app-update.yml'), '', 'utf8')
    writeFileSync(join(directory, 'update-settings.json'), '{"autoUpdate":false,"lastRunVersion":"1.0.0"}\n', 'utf8')
    const { app: localApp } = await import('electron')
    const { default: localElectronUpdater } = await import('electron-updater')
    const {
      initUpdater: initLocalUpdater,
      installDownloadedUpdateNow: installLocalUpdate,
      startUpdateDownload: startLocalUpdateDownload,
    } = await import('../src/updater')
    const localAutoUpdater = localElectronUpdater.autoUpdater
    vi.mocked(localApp.getPath).mockReturnValue(directory)
    Object.defineProperty(localApp, 'isPackaged', { configurable: true, value: true })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })

    initLocalUpdater(() => undefined)
    const available = vi.mocked(localAutoUpdater.on).mock.calls.find(([event]) => event === 'update-available')?.[1] as ((info: { version: string }) => void) | undefined
    const downloaded = vi.mocked(localAutoUpdater.on).mock.calls.find(([event]) => event === 'update-downloaded')?.[1] as ((info: { version: string }) => void) | undefined
    available?.({ version: '1.2.3' })

    expect(startLocalUpdateDownload()).toMatchObject({
      status: 'downloading',
      percent: undefined,
      transferred: undefined,
    })
    expect(localAutoUpdater.downloadUpdate).toHaveBeenCalledOnce()
    expect(localAutoUpdater.quitAndInstall).not.toHaveBeenCalled()

    downloaded?.({ version: '1.2.3' })
    expect(localAutoUpdater.quitAndInstall).not.toHaveBeenCalled()

    expect(installLocalUpdate()).toMatchObject({ status: 'downloaded' })
    expect(installLocalUpdate()).toMatchObject({ status: 'downloaded' })
    expect(localAutoUpdater.quitAndInstall).toHaveBeenCalledOnce()
    expect(readUpdateSettings(directory)).toMatchObject({ pendingInstallVersion: '1.2.3' })
  })

  it('does not let a scheduled check overwrite a downloaded update', async () => {
    vi.useFakeTimers()
    try {
      vi.resetModules()
      const directory = temporaryDirectory()
      writeFileSync(join(directory, 'app-update.yml'), '', 'utf8')
      writeFileSync(join(directory, 'update-settings.json'), '{"autoUpdate":true}\n', 'utf8')
      const { app: localApp } = await import('electron')
      const { default: localElectronUpdater } = await import('electron-updater')
      const { initUpdater: initLocalUpdater } = await import('../src/updater')
      const localAutoUpdater = localElectronUpdater.autoUpdater
      vi.mocked(localApp.getPath).mockReturnValue(directory)
      Object.defineProperty(localApp, 'isPackaged', { configurable: true, value: true })
      Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })

      initLocalUpdater(() => undefined)
      const downloaded = vi.mocked(localAutoUpdater.on).mock.calls.find(
        ([event]) => event === 'update-downloaded',
      )?.[1] as ((info: { version: string }) => void) | undefined
      downloaded?.({ version: '1.2.3' })
      await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1_000)

      expect(localAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries a failed user-requested download without enabling automatic download', async () => {
    vi.resetModules()
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'app-update.yml'), '', 'utf8')
    writeFileSync(join(directory, 'update-settings.json'), '{"autoUpdate":false}\n', 'utf8')
    const { app: localApp } = await import('electron')
    const { default: localElectronUpdater } = await import('electron-updater')
    const {
      getUpdateState: getLocalUpdateState,
      initUpdater: initLocalUpdater,
      startUpdateDownload: startLocalUpdateDownload,
    } = await import('../src/updater')
    const localAutoUpdater = localElectronUpdater.autoUpdater
    vi.mocked(localApp.getPath).mockReturnValue(directory)
    Object.defineProperty(localApp, 'isPackaged', { configurable: true, value: true })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })
    vi.mocked(localAutoUpdater.downloadUpdate)
      .mockRejectedValueOnce(new Error('network interrupted'))
      .mockResolvedValueOnce([])

    initLocalUpdater(() => undefined)
    const available = vi.mocked(localAutoUpdater.on).mock.calls.find(
      ([event]) => event === 'update-available',
    )?.[1] as ((info: { version: string }) => void) | undefined
    available?.({ version: '1.2.3' })

    startLocalUpdateDownload()
    await vi.waitFor(() => { expect(getLocalUpdateState().status).toBe('error') })
    expect(startLocalUpdateDownload()).toMatchObject({ status: 'downloading' })
    expect(localAutoUpdater.downloadUpdate).toHaveBeenCalledTimes(2)
    expect(localAutoUpdater.autoDownload).toBe(false)
  })

  it('cancelling an in-flight download aborts the transfer and restores the available state', async () => {
    vi.resetModules()
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'app-update.yml'), '', 'utf8')
    writeFileSync(join(directory, 'update-settings.json'), '{"autoUpdate":false}\n', 'utf8')
    const { app: localApp } = await import('electron')
    const { default: localElectronUpdater } = await import('electron-updater')
    const {
      cancelUpdateDownload: cancelLocalUpdateDownload,
      getUpdateState: getLocalUpdateState,
      initUpdater: initLocalUpdater,
      startUpdateDownload: startLocalUpdateDownload,
    } = await import('../src/updater')
    const localAutoUpdater = localElectronUpdater.autoUpdater
    vi.mocked(localApp.getPath).mockReturnValue(directory)
    Object.defineProperty(localApp, 'isPackaged', { configurable: true, value: true })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })

    initLocalUpdater(() => undefined)
    const available = vi.mocked(localAutoUpdater.on).mock.calls.find(
      ([event]) => event === 'update-available',
    )?.[1] as ((info: { version: string }) => void) | undefined
    const progress = vi.mocked(localAutoUpdater.on).mock.calls.find(
      ([event]) => event === 'download-progress',
    )?.[1] as ((info: {
      percent: number
      transferred: number
      total: number
      bytesPerSecond: number
    }) => void) | undefined
    available?.({ version: '1.2.3' })

    startLocalUpdateDownload()
    progress?.({ percent: 40, transferred: 400, total: 1_000, bytesPerSecond: 80 })
    expect(getLocalUpdateState()).toMatchObject({ status: 'downloading', percent: 40 })

    const token = vi.mocked(localAutoUpdater.downloadUpdate).mock.calls[0]?.[0] as
      | { cancelled: boolean }
      | undefined
    expect(token).toBeDefined()
    expect(token?.cancelled).toBe(false)

    expect(cancelLocalUpdateDownload()).toMatchObject({
      status: 'available',
      availableVersion: '1.2.3',
      percent: undefined,
      transferred: undefined,
      total: undefined,
      bytesPerSecond: undefined,
    })
    expect(token?.cancelled).toBe(true)
    expect(localAutoUpdater.autoDownload).toBe(false)
    expect(localAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('does not report an error when the cancelled download rejects', async () => {
    vi.resetModules()
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'app-update.yml'), '', 'utf8')
    writeFileSync(join(directory, 'update-settings.json'), '{"autoUpdate":false}\n', 'utf8')
    const { app: localApp } = await import('electron')
    const { default: localElectronUpdater } = await import('electron-updater')
    const {
      cancelUpdateDownload: cancelLocalUpdateDownload,
      getUpdateState: getLocalUpdateState,
      initUpdater: initLocalUpdater,
      startUpdateDownload: startLocalUpdateDownload,
    } = await import('../src/updater')
    const localAutoUpdater = localElectronUpdater.autoUpdater
    vi.mocked(localApp.getPath).mockReturnValue(directory)
    Object.defineProperty(localApp, 'isPackaged', { configurable: true, value: true })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })

    let rejectDownload: ((error: Error) => void) | undefined
    vi.mocked(localAutoUpdater.downloadUpdate).mockReturnValueOnce(
      new Promise<string[]>((_resolve, reject) => {
        rejectDownload = reject
      }),
    )

    initLocalUpdater(() => undefined)
    const available = vi.mocked(localAutoUpdater.on).mock.calls.find(
      ([event]) => event === 'update-available',
    )?.[1] as ((info: { version: string }) => void) | undefined
    available?.({ version: '1.2.3' })

    startLocalUpdateDownload()
    cancelLocalUpdateDownload()
    rejectDownload?.(new Error('cancelled'))
    await Promise.resolve()
    await Promise.resolve()

    expect(getLocalUpdateState()).toMatchObject({ status: 'available', availableVersion: '1.2.3' })
    expect(getLocalUpdateState().message).toBeUndefined()
  })

  it('retries a download requested before the cancelled one settled', async () => {
    vi.resetModules()
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'app-update.yml'), '', 'utf8')
    writeFileSync(join(directory, 'update-settings.json'), '{"autoUpdate":false}\n', 'utf8')
    const { app: localApp } = await import('electron')
    const { default: localElectronUpdater } = await import('electron-updater')
    const {
      cancelUpdateDownload: cancelLocalUpdateDownload,
      getUpdateState: getLocalUpdateState,
      initUpdater: initLocalUpdater,
      startUpdateDownload: startLocalUpdateDownload,
    } = await import('../src/updater')
    const localAutoUpdater = localElectronUpdater.autoUpdater
    vi.mocked(localApp.getPath).mockReturnValue(directory)
    Object.defineProperty(localApp, 'isPackaged', { configurable: true, value: true })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })

    // Mirrors AppUpdater.downloadUpdate: an in-flight download is handed back
    // to the next caller and the token it passes is ignored. The promise that
    // clears the slot is the one the caller receives, so the slot is already
    // free by the time the caller's own handlers run.
    let rejectDownload: ((error: Error) => void) | undefined
    let downloadPromise: Promise<string[]> | null = null
    vi.mocked(localAutoUpdater.downloadUpdate).mockImplementation(() => {
      if (downloadPromise !== null) return downloadPromise
      const inner = new Promise<string[]>((_resolve, reject) => {
        rejectDownload = reject
      })
      downloadPromise = inner.finally(() => {
        downloadPromise = null
      })
      return downloadPromise
    })

    initLocalUpdater(() => undefined)
    const available = vi.mocked(localAutoUpdater.on).mock.calls.find(
      ([event]) => event === 'update-available',
    )?.[1] as ((info: { version: string }) => void) | undefined
    available?.({ version: '1.2.3' })

    startLocalUpdateDownload()
    cancelLocalUpdateDownload()
    startLocalUpdateDownload()

    // The retry must not reach electron-updater yet: it would be handed the
    // cancelled download and inherit its rejection.
    expect(localAutoUpdater.downloadUpdate).toHaveBeenCalledOnce()

    rejectDownload?.(new Error('cancelled'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(localAutoUpdater.downloadUpdate).toHaveBeenCalledTimes(2)
    const retryToken = vi.mocked(localAutoUpdater.downloadUpdate).mock.calls[1]?.[0] as
      | { cancelled: boolean }
      | undefined
    expect(retryToken?.cancelled).toBe(false)
    expect(getLocalUpdateState()).toMatchObject({ status: 'downloading' })
    expect(getLocalUpdateState().message).toBeUndefined()
  })

  it('drops a deferred retry when the user cancels again', async () => {
    vi.resetModules()
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'app-update.yml'), '', 'utf8')
    writeFileSync(join(directory, 'update-settings.json'), '{"autoUpdate":false}\n', 'utf8')
    const { app: localApp } = await import('electron')
    const { default: localElectronUpdater } = await import('electron-updater')
    const {
      cancelUpdateDownload: cancelLocalUpdateDownload,
      getUpdateState: getLocalUpdateState,
      initUpdater: initLocalUpdater,
      startUpdateDownload: startLocalUpdateDownload,
    } = await import('../src/updater')
    const localAutoUpdater = localElectronUpdater.autoUpdater
    vi.mocked(localApp.getPath).mockReturnValue(directory)
    Object.defineProperty(localApp, 'isPackaged', { configurable: true, value: true })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })

    let rejectDownload: ((error: Error) => void) | undefined
    let downloadPromise: Promise<string[]> | null = null
    vi.mocked(localAutoUpdater.downloadUpdate).mockImplementation(() => {
      if (downloadPromise !== null) return downloadPromise
      const inner = new Promise<string[]>((_resolve, reject) => {
        rejectDownload = reject
      })
      downloadPromise = inner.finally(() => {
        downloadPromise = null
      })
      return downloadPromise
    })

    initLocalUpdater(() => undefined)
    const available = vi.mocked(localAutoUpdater.on).mock.calls.find(
      ([event]) => event === 'update-available',
    )?.[1] as ((info: { version: string }) => void) | undefined
    available?.({ version: '1.2.3' })

    startLocalUpdateDownload()
    cancelLocalUpdateDownload()
    startLocalUpdateDownload()
    cancelLocalUpdateDownload()

    rejectDownload?.(new Error('cancelled'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(localAutoUpdater.downloadUpdate).toHaveBeenCalledOnce()
    expect(getLocalUpdateState()).toMatchObject({ status: 'available', availableVersion: '1.2.3' })
  })
})

describe('update prompt receipts', () => {
  it('tracks notified and skipped versions independently', async () => {
    vi.resetModules()
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'app-update.yml'), '', 'utf8')
    writeFileSync(join(directory, 'update-settings.json'), '{"autoUpdate":false}\n', 'utf8')
    const { app: localApp } = await import('electron')
    const {
      initUpdater: initLocalUpdater,
      markUpdateNotified: markLocalUpdateNotified,
      readUpdateSettings: readLocalUpdateSettings,
      skipUpdate: skipLocalUpdate,
      undoSkippedUpdate: undoLocalSkippedUpdate,
    } = await import('../src/updater')
    vi.mocked(localApp.getPath).mockReturnValue(directory)
    Object.defineProperty(localApp, 'isPackaged', { configurable: true, value: true })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })

    initLocalUpdater(() => undefined)
    const { default: localElectronUpdater } = await import('electron-updater')
    const available = vi.mocked(localElectronUpdater.autoUpdater.on).mock.calls.find(
      ([event]) => event === 'update-available',
    )?.[1] as ((info: { version: string }) => void) | undefined
    available?.({ version: '1.2.3' })
    markLocalUpdateNotified('1.2.3')
    skipLocalUpdate('1.2.3')

    expect(readLocalUpdateSettings(directory)).toMatchObject({
      notifiedVersion: '1.2.3',
      skippedVersion: '1.2.3',
    })
    undoLocalSkippedUpdate()
    expect(readLocalUpdateSettings(directory).skippedVersion).toBeUndefined()
  })

  it('shows completion only for a matching explicit upgrade receipt', async () => {
    vi.resetModules()
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'app-update.yml'), '', 'utf8')
    writeFileSync(join(directory, 'update-settings.json'), '{"autoUpdate":false,"lastRunVersion":"1.1.0","pendingInstallVersion":"1.2.0"}\n', 'utf8')
    const { app: localApp } = await import('electron')
    const {
      acknowledgeCompletedUpdate: acknowledgeLocalCompletion,
      getUpdateState: getLocalUpdateState,
      initUpdater: initLocalUpdater,
      readUpdateSettings: readLocalUpdateSettings,
    } = await import('../src/updater')
    vi.mocked(localApp.getPath).mockReturnValue(directory)
    vi.mocked(localApp.getVersion).mockReturnValue('1.2.0')
    Object.defineProperty(localApp, 'isPackaged', { configurable: true, value: true })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })

    initLocalUpdater(() => undefined)

    expect(getLocalUpdateState()).toMatchObject({ installedVersion: '1.2.0', completedVersion: '1.2.0' })
    expect(readLocalUpdateSettings(directory)).toMatchObject({ lastRunVersion: '1.2.0', completedVersion: '1.2.0' })
    expect(readLocalUpdateSettings(directory).pendingInstallVersion).toBeUndefined()

    acknowledgeLocalCompletion('1.2.0')
    expect(getLocalUpdateState().completedVersion).toBeUndefined()
    expect(readLocalUpdateSettings(directory).completedVersion).toBeUndefined()
  })

  it('does not report a manual version change as an updater success', async () => {
    vi.resetModules()
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'app-update.yml'), '', 'utf8')
    writeFileSync(join(directory, 'update-settings.json'), '{"autoUpdate":false,"lastRunVersion":"1.1.0"}\n', 'utf8')
    const { app: localApp } = await import('electron')
    const {
      getUpdateState: getLocalUpdateState,
      initUpdater: initLocalUpdater,
    } = await import('../src/updater')
    vi.mocked(localApp.getPath).mockReturnValue(directory)
    vi.mocked(localApp.getVersion).mockReturnValue('1.2.0')
    Object.defineProperty(localApp, 'isPackaged', { configurable: true, value: true })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })

    initLocalUpdater(() => undefined)

    expect(getLocalUpdateState().completedVersion).toBeUndefined()
  })

  it.each([
    ['a mismatched pending receipt', '1.2.0', '1.3.0'],
    ['a matching downgrade receipt', '1.2.0', '1.1.0'],
  ])('does not report %s as an updater success', async (_label, pendingVersion, currentVersion) => {
    vi.resetModules()
    const directory = temporaryDirectory()
    writeFileSync(join(directory, 'app-update.yml'), '', 'utf8')
    writeFileSync(
      join(directory, 'update-settings.json'),
      `${JSON.stringify({ autoUpdate: false, lastRunVersion: '1.2.0', pendingInstallVersion: pendingVersion })}\n`,
      'utf8',
    )
    const { app: localApp } = await import('electron')
    const {
      getUpdateState: getLocalUpdateState,
      initUpdater: initLocalUpdater,
      readUpdateSettings: readLocalUpdateSettings,
    } = await import('../src/updater')
    vi.mocked(localApp.getPath).mockReturnValue(directory)
    vi.mocked(localApp.getVersion).mockReturnValue(currentVersion)
    Object.defineProperty(localApp, 'isPackaged', { configurable: true, value: true })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: directory })

    initLocalUpdater(() => undefined)

    expect(getLocalUpdateState().completedVersion).toBeUndefined()
    expect(readLocalUpdateSettings(directory)).toMatchObject({ lastRunVersion: currentVersion })
    expect(readLocalUpdateSettings(directory).pendingInstallVersion).toBeUndefined()
  })
})
