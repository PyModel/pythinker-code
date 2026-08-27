import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import { CancellationToken } from 'builder-util-runtime'
import electronUpdater, { type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { gt, valid } from 'semver'

const { autoUpdater } = electronUpdater
const UPDATE_SETTINGS_FILE = 'update-settings.json'
const UPDATES_UNAVAILABLE_MESSAGE = 'Updates are not available for this build'
/**
 * electron-updater's default channel. Its `channel` setter rejects `null` once a
 * channel has been set, so switching back to stable must name the channel
 * explicitly instead of clearing it.
 */
const STABLE_UPDATER_CHANNEL = 'latest'
const INITIAL_CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000
const RELEASE_REPOSITORY_PATH = '/PyModel/pythinker-desktop-releases/releases/tag/'

export type UpdateChannel = 'stable' | 'beta' | 'nightly'

export interface UpdateSettings {
  readonly autoUpdate: boolean
  readonly channel: UpdateChannel
  readonly notifyUpdate: boolean
  readonly notifiedVersion?: string
  readonly skippedVersion?: string
  readonly pendingInstallVersion?: string
  readonly completedVersion?: string
  readonly lastRunVersion?: string
}

export type UpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'skipped'
  | 'error'

export type UpdateState = {
  status: UpdateStatus
  installedVersion: string
  availableVersion?: string
  releaseDate?: string
  releaseNotes?: string
  lastCheckedAt?: string
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  message?: string
  autoUpdate: boolean
  channel: UpdateChannel
  notifyUpdate: boolean
  notifiedVersion?: string
  skippedVersion?: string
  completedVersion?: string
  failedInstallVersion?: string
}

export type UpdateTelemetryTrack = (
  event: string,
  properties?: Readonly<Record<string, string>>,
) => void

const DEFAULT_SETTINGS: UpdateSettings = {
  autoUpdate: true,
  channel: 'stable',
  notifyUpdate: true,
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function updateChannel(value: unknown): UpdateChannel {
  return value === 'beta' || value === 'nightly' ? value : 'stable'
}

export function readUpdateSettings(dir: string): UpdateSettings {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, UPDATE_SETTINGS_FILE), 'utf8'))
    if (typeof parsed === 'object' && parsed !== null) {
      const source = parsed as Readonly<Record<string, unknown>>
      if (typeof source['autoUpdate'] === 'boolean') {
        return {
          autoUpdate: source['autoUpdate'],
          channel: updateChannel(source['channel']),
          notifyUpdate: typeof source['notifyUpdate'] === 'boolean' ? source['notifyUpdate'] : true,
          notifiedVersion: optionalString(source['notifiedVersion']),
          skippedVersion: optionalString(source['skippedVersion']),
          pendingInstallVersion: optionalString(source['pendingInstallVersion']),
          completedVersion: optionalString(source['completedVersion']),
          lastRunVersion: optionalString(source['lastRunVersion']),
        }
      }
    }
  } catch {
    // Missing and corrupt settings use the default.
  }
  return DEFAULT_SETTINGS
}

export function writeUpdateSettings(dir: string, value: UpdateSettings): void {
  writeFileSync(join(dir, UPDATE_SETTINGS_FILE), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const HTML_MARKUP_PATTERN = /<\/?[a-z][^>]*>/iu
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

function decodeEntities(value: string): string {
  return value.replaceAll(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, entity: string) => {
    if (!entity.startsWith('#')) return NAMED_ENTITIES[entity.toLowerCase()] ?? match
    const code = entity.startsWith('#x') || entity.startsWith('#X')
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10)
    return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  })
}

const BLOCK_BREAK_TAGS: ReadonlySet<string> = new Set([
  'blockquote',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'ol',
  'p',
  'pre',
  'table',
  'tr',
  'ul',
])

const RAW_TEXT_TAGS: ReadonlySet<string> = new Set(['script', 'style'])

const TAG_NAME_CHARACTER = /[a-z0-9]/iu

interface HtmlTag {
  name: string
  closing: boolean
  end: number
}

function readTag(value: string, start: number): HtmlTag | undefined {
  const end = value.indexOf('>', start)
  if (end < 0) return undefined
  const closing = value[start + 1] === '/'
  const nameStart = start + (closing ? 2 : 1)
  let cursor = nameStart
  while (cursor < end && TAG_NAME_CHARACTER.test(value[cursor] ?? '')) cursor += 1
  return { name: value.slice(nameStart, cursor).toLowerCase(), closing, end }
}

function skipRawTextElement(value: string, name: string, from: number): number {
  let index = from
  while (index < value.length) {
    const next = value.indexOf('<', index)
    if (next < 0) return value.length
    const tag = readTag(value, next)
    if (tag === undefined) return value.length
    if (tag.closing && tag.name === name) return tag.end + 1
    index = tag.end + 1
  }
  return value.length
}

/**
 * The GitHub provider reads the releases Atom feed, whose `<content>` is the
 * body GitHub has already rendered to HTML. The renderer shows these notes as
 * Markdown, so the tags would print literally — `PyModel/pythinker-code@<tt>`
 * and the rest. Reduce the markup to text here, at the boundary that already
 * owns this field.
 *
 * This walks the input once and copies out only the text it passes, rather
 * than deleting tags from the string. Deletion is what lets `<scr<x>ipt>`
 * close back up into markup; a scan that never re-reads what it emitted cannot
 * produce a tag that was not already there. Markup the scan cannot terminate
 * ends the walk, so an unclosed `<` is dropped with the rest of the tail.
 */
function plainReleaseNotes(value: string): string {
  let text = ''
  let index = 0
  while (index < value.length) {
    const next = value.indexOf('<', index)
    if (next < 0) {
      text += value.slice(index)
      break
    }
    text += value.slice(index, next)
    const tag = readTag(value, next)
    if (tag === undefined) break
    if (!tag.closing && RAW_TEXT_TAGS.has(tag.name)) {
      index = skipRawTextElement(value, tag.name, tag.end + 1)
      continue
    }
    if (tag.name === 'li' && !tag.closing) text += '\n- '
    else if (tag.name === 'br') text += '\n'
    else if (tag.closing && BLOCK_BREAK_TAGS.has(tag.name)) text += '\n'
    index = tag.end + 1
  }
  return decodeEntities(text)
    .replaceAll(/[^\S\n]+\n/gu, '\n')
    .replaceAll(/\n{3,}/gu, '\n\n')
    .trim()
}

function normalizedNote(value: string): string {
  return HTML_MARKUP_PATTERN.test(value) ? plainReleaseNotes(value) : value.trim()
}

function releaseNotesText(value: UpdateInfo['releaseNotes']): string | undefined {
  if (typeof value === 'string') {
    const note = normalizedNote(value)
    return note.length > 0 ? note : undefined
  }
  if (!Array.isArray(value)) return undefined
  const notes = value.flatMap(item => {
    if (typeof item.note !== 'string') return []
    const note = normalizedNote(item.note)
    return note.length > 0 ? [note] : []
  })
  return notes.length > 0 ? notes.join('\n\n') : undefined
}

export function updateReleaseNotesUrl(version: string): string | undefined {
  const normalized = valid(version)
  if (normalized === null || normalized !== version) return undefined
  const url = new URL(`${RELEASE_REPOSITORY_PATH}v${normalized}`, 'https://github.com')
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return undefined
  if (!url.pathname.startsWith(RELEASE_REPOSITORY_PATH)) return undefined
  return url.toString()
}

function isVerifiedUpgrade(currentVersion: string, previousVersion: string | undefined): boolean {
  return valid(currentVersion) !== null && previousVersion !== undefined && valid(previousVersion) !== null
    && gt(currentVersion, previousVersion)
}

/**
 * A silent installer reports nothing back: the app quits, the installer runs
 * hidden, and the only evidence either way is the version that comes back up.
 * A pending receipt that does not match this launch therefore means the install
 * did not take effect, and it has to become a visible error rather than silence.
 */
function reconcileStartupReceipt(
  value: UpdateSettings,
  currentVersion: string,
): { settings: UpdateSettings, failedInstallVersion?: string } {
  let completedVersion = value.completedVersion === currentVersion ? value.completedVersion : undefined
  let failedInstallVersion: string | undefined
  if (value.pendingInstallVersion === currentVersion) {
    if (isVerifiedUpgrade(currentVersion, value.lastRunVersion)) completedVersion = currentVersion
  } else if (value.pendingInstallVersion !== undefined) {
    failedInstallVersion = value.pendingInstallVersion
  }
  return {
    settings: {
      ...value,
      pendingInstallVersion: undefined,
      completedVersion,
      lastRunVersion: currentVersion,
    },
    failedInstallVersion,
  }
}

let settings = DEFAULT_SETTINGS
let state: UpdateState = {
  status: app.isPackaged ? 'idle' : 'disabled',
  installedVersion: app.getVersion(),
  autoUpdate: settings.autoUpdate,
  channel: settings.channel,
  notifyUpdate: settings.notifyUpdate,
}
let getWindow: (() => BrowserWindow | undefined) | undefined
let initialCheckTimer: ReturnType<typeof setTimeout> | undefined
let checkInterval: ReturnType<typeof setInterval> | undefined
let checkPromise: Promise<UpdateState> | undefined
let installRequestedVersion: string | undefined
let activeDownloadToken: CancellationToken | undefined
let restartDownloadWhenSettled = false
let listenersWired = false
let initialized = false
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
      track(
        'desktop_update_available',
        next.availableVersion === undefined ? {} : { version: next.availableVersion },
      )
      break
    case 'downloaded':
      track(
        'desktop_update_downloaded',
        next.availableVersion === undefined ? {} : { version: next.availableVersion },
      )
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

function updateState(next: Partial<UpdateState>): void {
  const previous = state
  state = {
    ...state,
    ...next,
    autoUpdate: settings.autoUpdate,
    channel: settings.channel,
    notifyUpdate: settings.notifyUpdate,
    notifiedVersion: settings.notifiedVersion,
    skippedVersion: settings.skippedVersion,
    completedVersion: settings.completedVersion,
  }
  emitUpdateTelemetry(previous, state)
  const window = getWindow?.()
  if (window === undefined || window.isDestroyed() || window.webContents.isDestroyed()) return
  try {
    window.webContents.send('pythinker:update:state', state)
  } catch {
    // The renderer can disappear between the destroyed check and send.
  }
}

function persistSettings(next: UpdateSettings): void {
  writeUpdateSettings(app.getPath('userData'), next)
  settings = next
  updateState({})
}

function stateError(error: unknown): void {
  updateState({
    status: 'error',
    message: error instanceof Error ? error.message : String(error),
  })
}

/**
 * electron-updater reports a cancelled download through the same `error` path
 * as a genuine failure, and `CancellationError` carries no distinguishing
 * `name`, so the token itself is the discriminator: `cancel()` flips
 * `cancelled` synchronously, before the rejection reaches us. The guard reads
 * the token that owns this rejection rather than the current one.
 *
 * That alone is not enough to make a retry safe — see `beginDownload`.
 */
function downloadError(token: CancellationToken, error: unknown): void {
  if (token.cancelled) return
  stateError(error)
}

function clearTimers(): void {
  if (initialCheckTimer !== undefined) clearTimeout(initialCheckTimer)
  if (checkInterval !== undefined) clearInterval(checkInterval)
  initialCheckTimer = undefined
  checkInterval = undefined
}

function hasUpdateConfig(): boolean {
  return existsSync(join(process.resourcesPath, 'app-update.yml'))
}

function configureExplicitConsent(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.disableDifferentialDownload = true
  autoUpdater.channel = settings.channel === 'stable' ? STABLE_UPDATER_CHANNEL : settings.channel
  autoUpdater.allowPrerelease = settings.channel !== 'stable'
  autoUpdater.allowDowngrade = false
}

function disableUpdates(): UpdateState {
  updateState({
    status: 'disabled',
    message: UPDATES_UNAVAILABLE_MESSAGE,
    availableVersion: undefined,
    releaseDate: undefined,
    releaseNotes: undefined,
    percent: undefined,
    transferred: undefined,
    total: undefined,
    bytesPerSecond: undefined,
  })
  return state
}

function scheduleChecks(): void {
  if (checkInterval !== undefined) return
  checkInterval = setInterval(() => {
    if (settings.autoUpdate) void checkForUpdatesNow()
  }, CHECK_INTERVAL_MS)
}

async function runCheck(): Promise<UpdateState> {
  if (checkPromise !== undefined) return checkPromise
  checkPromise = (async () => {
    updateState({ status: 'checking', message: undefined, failedInstallVersion: undefined })
    try {
      configureExplicitConsent()
      await autoUpdater.checkForUpdates()
    } catch (error) {
      stateError(error)
    }
    return state
  })().finally(() => {
    checkPromise = undefined
  })
  return checkPromise
}

function applyAvailableUpdate(info: UpdateInfo): void {
  const skipped = settings.skippedVersion === info.version
  updateState({
    status: skipped ? 'skipped' : 'available',
    availableVersion: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: releaseNotesText(info.releaseNotes),
    lastCheckedAt: new Date().toISOString(),
    percent: undefined,
    transferred: undefined,
    total: undefined,
    bytesPerSecond: undefined,
    message: undefined,
  })
}

function wireUpdaterEvents(): void {
  if (listenersWired) return
  try {
    autoUpdater.on('checking-for-update', () => {
      updateState({ status: 'checking', message: undefined, failedInstallVersion: undefined })
    })
    autoUpdater.on('update-available', applyAvailableUpdate)
    autoUpdater.on('update-not-available', () => {
      updateState({
        status: 'idle',
        lastCheckedAt: new Date().toISOString(),
        availableVersion: undefined,
        releaseDate: undefined,
        releaseNotes: undefined,
        percent: undefined,
        transferred: undefined,
        total: undefined,
        bytesPerSecond: undefined,
        message: undefined,
      })
    })
    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      if (state.status !== 'downloading') return
      updateState({
        status: 'downloading',
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      })
    })
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      updateState({
        status: 'downloaded',
        availableVersion: info.version,
        releaseDate: info.releaseDate ?? state.releaseDate,
        releaseNotes: releaseNotesText(info.releaseNotes) ?? state.releaseNotes,
        percent: 100,
        transferred: state.total,
        message: undefined,
      })
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
  if (initialized) {
    getWindow = windowGetter
    updateTelemetryTrack = track
    updateState({})
    return
  }
  initialized = true
  getWindow = windowGetter
  updateTelemetryTrack = track
  const userData = app.getPath('userData')
  settings = readUpdateSettings(userData)
  let failedInstallVersion: string | undefined
  if (app.isPackaged) {
    const receipt = reconcileStartupReceipt(settings, app.getVersion())
    settings = receipt.settings
    failedInstallVersion = receipt.failedInstallVersion
    writeUpdateSettings(userData, settings)
  }
  state = {
    status: app.isPackaged ? (failedInstallVersion === undefined ? 'idle' : 'error') : 'disabled',
    message: failedInstallVersion === undefined
      ? undefined
      : `Update to v${failedInstallVersion} did not complete. Pythinker is still on v${app.getVersion()}.`,
    failedInstallVersion,
    installedVersion: app.getVersion(),
    autoUpdate: settings.autoUpdate,
    channel: settings.channel,
    notifyUpdate: settings.notifyUpdate,
    notifiedVersion: settings.notifiedVersion,
    skippedVersion: settings.skippedVersion,
    completedVersion: settings.completedVersion,
  }
  installRequestedVersion = undefined
  updateState({})
  clearTimers()

  if (!app.isPackaged) return
  if (!hasUpdateConfig()) {
    disableUpdates()
    return
  }

  try {
    configureExplicitConsent()
  } catch (error) {
    stateError(error)
    return
  }
  wireUpdaterEvents()
  app.once('will-quit', clearTimers)

  if (settings.autoUpdate) {
    initialCheckTimer = setTimeout(() => { void checkForUpdatesNow() }, INITIAL_CHECK_DELAY_MS)
    scheduleChecks()
  }
}

export function getUpdateState(): UpdateState {
  return state
}

export function setAutoUpdate(enabled: boolean): UpdateState {
  const wasEnabled = settings.autoUpdate
  persistSettings({ ...settings, autoUpdate: enabled })

  if (!app.isPackaged) return state

  try {
    configureExplicitConsent()
  } catch (error) {
    stateError(error)
    return state
  }
  if (enabled) {
    scheduleChecks()
    if (!wasEnabled && state.availableVersion === undefined) void checkForUpdatesNow()
  } else {
    clearTimers()
  }
  return state
}

export function setUpdateChannel(channel: UpdateChannel): UpdateState {
  if (settings.channel === channel) return state
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'downloaded') {
    throw new Error('Cannot change update channel while an update operation is active')
  }

  persistSettings({
    ...settings,
    channel,
    notifiedVersion: undefined,
    skippedVersion: undefined,
  })

  if (app.isPackaged && hasUpdateConfig()) {
    try {
      configureExplicitConsent()
    } catch (error) {
      stateError(error)
      return state
    }
  }

  updateState({
    status: app.isPackaged && hasUpdateConfig() ? 'idle' : 'disabled',
    availableVersion: undefined,
    releaseDate: undefined,
    releaseNotes: undefined,
    lastCheckedAt: undefined,
    percent: undefined,
    transferred: undefined,
    total: undefined,
    bytesPerSecond: undefined,
    message: undefined,
  })
  return state
}

export function setNotifyUpdate(enabled: boolean): UpdateState {
  persistSettings({ ...settings, notifyUpdate: enabled })
  return state
}

export async function checkForUpdatesNow(): Promise<UpdateState> {
  if (!app.isPackaged) {
    updateState({ status: 'disabled' })
    return state
  }
  if (!hasUpdateConfig()) return disableUpdates()
  if (state.status === 'downloading' || state.status === 'downloaded') return state

  try {
    configureExplicitConsent()
  } catch (error) {
    stateError(error)
    return state
  }
  return runCheck()
}

export function markUpdateNotified(version: string): UpdateState {
  if (state.availableVersion !== version) return state
  persistSettings({ ...settings, notifiedVersion: version })
  return state
}

export function skipUpdate(version: string): UpdateState {
  if (state.status !== 'available' || state.availableVersion !== version) return state
  persistSettings({ ...settings, notifiedVersion: version, skippedVersion: version })
  updateState({ status: 'skipped' })
  return state
}

export function undoSkippedUpdate(): UpdateState {
  const skippedVersion = settings.skippedVersion
  if (skippedVersion === undefined) return state
  persistSettings({ ...settings, skippedVersion: undefined })
  if (state.status === 'skipped' && state.availableVersion === skippedVersion) {
    updateState({ status: 'available' })
  }
  return state
}

/**
 * `AppUpdater.downloadUpdate` returns the in-flight `downloadPromise` when one
 * exists and ignores the token it is handed. A download started before the
 * previous one has settled would therefore be bound to the older promise — so
 * cancelling and immediately downloading again would surface the cancelled
 * attempt's rejection as this attempt's error. Hold the new start until the
 * previous promise settles, and only then ask for a fresh one.
 */
function beginDownload(): void {
  const token = new CancellationToken()
  activeDownloadToken = token
  void autoUpdater
    .downloadUpdate(token)
    .catch((error: unknown) => downloadError(token, error))
    .finally(() => {
      if (activeDownloadToken === token) activeDownloadToken = undefined
      token.dispose()
      if (!restartDownloadWhenSettled) return
      restartDownloadWhenSettled = false
      if (state.status === 'downloading') beginDownload()
    })
}

export function startUpdateDownload(): UpdateState {
  const canDownload = state.status === 'available'
    || (state.status === 'error' && state.availableVersion !== undefined)
  if (!app.isPackaged || !hasUpdateConfig() || !canDownload) return state
  try {
    configureExplicitConsent()
    updateState({
      status: 'downloading',
      percent: undefined,
      transferred: undefined,
      total: undefined,
      bytesPerSecond: undefined,
      message: undefined,
    })
    if (activeDownloadToken !== undefined) {
      restartDownloadWhenSettled = true
      return state
    }
    beginDownload()
  } catch (error) {
    activeDownloadToken = undefined
    restartDownloadWhenSettled = false
    stateError(error)
  }
  return state
}

/**
 * Aborts an in-flight download and returns the update to the state it had
 * before the user consented, so the same version can be downloaded again.
 */
export function cancelUpdateDownload(): UpdateState {
  const token = activeDownloadToken
  if (state.status !== 'downloading' || token === undefined) return state
  restartDownloadWhenSettled = false
  token.cancel()
  updateState({
    status: 'available',
    percent: undefined,
    transferred: undefined,
    total: undefined,
    bytesPerSecond: undefined,
    message: undefined,
  })
  return state
}

export function installDownloadedUpdateNow(): UpdateState {
  const version = state.availableVersion
  if (!app.isPackaged || !hasUpdateConfig() || state.status !== 'downloaded' || version === undefined) {
    return state
  }
  if (installRequestedVersion === version) return state
  installRequestedVersion = version
  try {
    persistSettings({ ...settings, pendingInstallVersion: version })
    try {
      updateTelemetryTrack('desktop_update_install', { version })
    } catch {
      // Telemetry must never delay an explicit installation.
    }
    // Silent NSIS install: `--updated /S --force-run`. Without `isSilent` the
    // assisted installer opens its wizard, and relaunch falls to
    // `autoRunAppAfterInstall` instead of `isForceRunAfter`.
    autoUpdater.quitAndInstall(true, true)
  } catch (error) {
    installRequestedVersion = undefined
    if (settings.pendingInstallVersion === version) {
      persistSettings({ ...settings, pendingInstallVersion: undefined })
    }
    stateError(error)
    throw error
  }
  return state
}

export function acknowledgeCompletedUpdate(version: string): UpdateState {
  if (settings.completedVersion !== version) return state
  persistSettings({ ...settings, completedVersion: undefined })
  return state
}
