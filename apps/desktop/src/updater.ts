import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater
const UPDATE_SETTINGS_FILE = 'update-settings.json'
const INITIAL_CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000

export interface UpdateSettings {
  readonly autoUpdate: boolean
}

export type UpdateState = {
  status: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
  autoUpdate: boolean
}

export type UpdateTelemetryTrack = (
  event: string,
  properties?: Readonly<Record<string, string>>,
) => void

const DEFAULT_SETTINGS: UpdateSettings = { autoUpdate: true }

export function readUpdateSettings(dir: string): UpdateSettings {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, UPDATE_SETTINGS_FILE), 'utf8'))
    if (typeof parsed === 'object' && parsed !== null) {
      const autoUpdate = (parsed as { autoUpdate?: unknown }).autoUpdate
      if (typeof autoUpdate === 'boolean') return { autoUpdate }
    }
  } catch {
    // Missing and corrupt settings use the default.
  }
  return DEFAULT_SETTINGS
}

export function writeUpdateSettings(dir: string, settings: UpdateSettings): void {
  writeFileSync(join(dir, UPDATE_SETTINGS_FILE), `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}

let settings = DEFAULT_SETTINGS
let state: UpdateState = {
  status: app.isPackaged ? 'idle' : 'disabled',
  autoUpdate: settings.autoUpdate,
}
let getWindow: (() => BrowserWindow | undefined) | undefined
let initialCheckTimer: ReturnType<typeof setTimeout> | undefined
let checkInterval: ReturnType<typeof setInterval> | undefined
let listenersWired = false
let updateTelemetryTrack: UpdateTelemetryTrack = () => {}

export function trackUpdateTransition(
  previous: UpdateState,
  next: UpdateState,
  track: UpdateTelemetryTrack,
): void {
  if (previous.status === next.status) return
  switch (next.status) {
    case 'checking':
      track('desktop_update_check')
      break
    case 'available':
      track('desktop_update_available', next.version === undefined ? {} : { version: next.version })
      break
    case 'downloaded':
      track('desktop_update_downloaded', next.version === undefined ? {} : { version: next.version })
      break
    case 'error':
      track('desktop_update_error', {
        message: (next.message ?? 'unknown update error').replaceAll(/\s+/gu, ' ').slice(0, 200),
      })
      break
    default:
      break
  }
}

function emitUpdateTelemetry(previous: UpdateState, next: UpdateState): void {
  try {
    trackUpdateTransition(previous, next, updateTelemetryTrack)
  } catch {
    // Telemetry must never delay update handling.
  }
}

function stateError(error: unknown): void {
  updateState({
    status: 'error',
    message: error instanceof Error ? error.message : String(error),
  })
}

function updateState(next: Partial<UpdateState>): void {
  const previous = state
  state = { ...state, ...next, autoUpdate: settings.autoUpdate }
  emitUpdateTelemetry(previous, state)
  const window = getWindow?.()
  if (window === undefined || window.isDestroyed() || window.webContents.isDestroyed()) return
  try {
    window.webContents.send('pythinker:update:state', state)
  } catch {
    // The renderer can disappear between the destroyed check and send.
  }
}

function clearTimers(): void {
  if (initialCheckTimer !== undefined) clearTimeout(initialCheckTimer)
  if (checkInterval !== undefined) clearInterval(checkInterval)
  initialCheckTimer = undefined
  checkInterval = undefined
}

function scheduleChecks(): void {
  if (checkInterval !== undefined) return
  checkInterval = setInterval(() => {
    if (settings.autoUpdate) void runCheck()
  }, CHECK_INTERVAL_MS)
}

async function runCheck(): Promise<UpdateState> {
  updateState({ status: 'checking', message: undefined, version: undefined, percent: undefined })
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    stateError(error)
  }
  return state
}

function wireUpdaterEvents(): void {
  if (listenersWired) return
  try {
    autoUpdater.on('checking-for-update', () => {
      updateState({ status: 'checking', message: undefined })
    })
    autoUpdater.on('update-available', (info) => {
      updateState({ status: 'available', version: info.version, message: undefined, percent: undefined })
    })
    autoUpdater.on('update-not-available', () => {
      updateState({ status: 'idle', message: 'No updates available', version: undefined, percent: undefined })
    })
    autoUpdater.on('download-progress', (progress) => {
      updateState({ status: 'downloading', percent: progress.percent })
    })
    autoUpdater.on('update-downloaded', (info) => {
      updateState({ status: 'downloaded', version: info.version, percent: 100, message: undefined })
    })
    autoUpdater.on('error', stateError)
    listenersWired = true
  } catch (error) {
    stateError(error)
  }
}

export function initUpdater(
  windowGetter: () => BrowserWindow | undefined,
  track: UpdateTelemetryTrack = () => {},
): void {
  getWindow = windowGetter
  updateTelemetryTrack = track
  settings = readUpdateSettings(app.getPath('userData'))
  state = {
    status: app.isPackaged ? 'idle' : 'disabled',
    autoUpdate: settings.autoUpdate,
  }
  updateState({})
  clearTimers()

  if (!app.isPackaged) return

  try {
    autoUpdater.autoDownload = settings.autoUpdate
    autoUpdater.autoInstallOnAppQuit = true
  } catch (error) {
    stateError(error)
    return
  }
  wireUpdaterEvents()
  app.once('will-quit', clearTimers)

  if (settings.autoUpdate) {
    initialCheckTimer = setTimeout(() => { void runCheck() }, INITIAL_CHECK_DELAY_MS)
    scheduleChecks()
  }
}

export function getUpdateState(): UpdateState {
  return state
}

export function setAutoUpdate(enabled: boolean): UpdateState {
  const wasEnabled = settings.autoUpdate
  const nextSettings = { autoUpdate: enabled }
  writeUpdateSettings(app.getPath('userData'), nextSettings)
  settings = nextSettings
  updateState({})

  if (!app.isPackaged) return state

  try {
    autoUpdater.autoDownload = enabled
  } catch (error) {
    stateError(error)
    return state
  }
  if (!enabled) {
    clearTimers()
  } else {
    scheduleChecks()
    if (!wasEnabled) void checkForUpdatesNow()
  }
  return state
}

export async function checkForUpdatesNow(): Promise<UpdateState> {
  if (!app.isPackaged) {
    updateState({ status: 'disabled' })
    return state
  }

  try {
    autoUpdater.autoDownload = true
  } catch (error) {
    stateError(error)
    return state
  }
  return runCheck()
}

export function quitAndInstallNow(): UpdateState {
  if (!app.isPackaged) {
    updateState({ status: 'disabled' })
    return state
  }

  try {
    updateTelemetryTrack('desktop_update_install')
  } catch {
    // Telemetry must never delay update installation.
  }
  try {
    autoUpdater.quitAndInstall()
  } catch (error) {
    stateError(error)
  }
  return state
}
