import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '',
  },
}))

vi.mock('electron-updater', () => ({
  default: { autoUpdater: {} },
}))

import {
  readUpdateSettings,
  trackUpdateTransition,
  writeUpdateSettings,
  type UpdateState,
} from '../src/updater'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
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
