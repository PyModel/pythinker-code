import { spawn, spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createHostSupervisor,
  createReadinessParser,
  requestHostShutdown,
  resolveHostExecutable,
  type HostChild,
} from '../src/host-supervisor'
import * as hostSupervisor from '../src/host-supervisor'

vi.mock('node:child_process', { spy: true })

type HostExitListener = Parameters<HostChild['onExit']>[0]
type HostExitSignal = Parameters<HostExitListener>[1]

class FakeOutput {
  private readonly listeners = new Set<(chunk: string) => void>()

  onData(listener: (chunk: string) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  emit(chunk: string): void {
    for (const listener of this.listeners) listener(chunk)
  }
}

class FakeHostChild implements HostChild {
  readonly pid = 123
  readonly stdout = new FakeOutput()
  readonly stderr = new FakeOutput()
  readonly signals: Array<'SIGTERM' | 'SIGKILL'> = []
  private readonly exitListeners = new Set<HostExitListener>()
  private readonly errorListeners = new Set<(error: Error) => void>()

  onExit(listener: HostExitListener): () => void {
    this.exitListeners.add(listener)
    return () => { this.exitListeners.delete(listener) }
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener)
    return () => { this.errorListeners.delete(listener) }
  }

  kill(signal: 'SIGTERM' | 'SIGKILL'): void {
    this.signals.push(signal)
  }

  emitExit(code: number | null = 0, signal: HostExitSignal = null): void {
    for (const listener of this.exitListeners) listener(code, signal)
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error)
  }
}

function observeSettlement<T>(promise: Promise<T>): ReturnType<typeof vi.fn> {
  const settled = vi.fn()
  void promise.then(settled, settled)
  return settled
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('desktop Host readiness', () => {
  it('extracts the canonical URL from arbitrarily chunked output and ignores unrelated URLs', () => {
    const parser = createReadinessParser()

    expect(parser.push('Node warning: see https://nodejs.org/docs\n')).toBeUndefined()
    expect(parser.push('Pythinker se')).toBeUndefined()
    expect(parser.push('rver: http://127.0.')).toBeUndefined()
    expect(parser.push('0.1:4173 (LAN: http://192.0.2.10:4173)')).toBeUndefined()
    expect(parser.push('\nstartup complete\n')).toEqual({ origin: 'http://127.0.0.1:4173' })
    expect(parser.finalize()).toEqual({ origin: 'http://127.0.0.1:4173' })
  })

  it('accepts a complete unterminated readiness line when the stream ends', () => {
    const parser = createReadinessParser()

    expect(parser.push('diagnostic\nPythinker server: http://localhost:51234')).toBeUndefined()
    expect(parser.finalize()).toEqual({ origin: 'http://localhost:51234' })
  })

  it.each([
    'Pythinker server: https://127.0.0.1:4173',
    'Pythinker server: http://0.0.0.0:4173',
    'Pythinker server: http://127.0.0.1:0',
    'Pythinker server: http://127.0.0.1:65536',
    'Pythinker server: http://127.0.0.1:not-a-port',
  ])('rejects an invalid readiness line: %s', (line) => {
    const parser = createReadinessParser()

    expect(() => parser.push(`${line}\n`)).toThrow(/readiness/iu)
  })

  it('fails when the stream ends before a readiness line arrives', () => {
    const parser = createReadinessParser()

    parser.push('ordinary startup output\n')
    expect(() => parser.finalize()).toThrow(/readiness/iu)
  })

  it('rejects conflicting readiness URLs', () => {
    const parser = createReadinessParser()

    expect(parser.push('Pythinker server: http://127.0.0.1:4173\n')).toEqual({ origin: 'http://127.0.0.1:4173' })
    expect(() => parser.push('Pythinker server: http://127.0.0.1:4174\n')).toThrow(/conflicting readiness URLs/iu)
  })

  it('captures the bearer token from the #token= readiness fragment', () => {
    const parser = createReadinessParser()

    expect(parser.push('Pythinker server: http://127.0.0.1:4173/#token=s3cret\n'))
      .toEqual({ origin: 'http://127.0.0.1:4173', token: 's3cret' })
    expect(parser.finalize()).toEqual({ origin: 'http://127.0.0.1:4173', token: 's3cret' })
  })
})

describe('desktop Host port', () => {
  it('uses fixed ports for packaged and development builds without an override', () => {
    expect(hostSupervisor.DESKTOP_PACKAGED_PORT).toBe(24_827)
    expect(hostSupervisor.DESKTOP_DEV_PORT).toBe(24_828)
    expect(hostSupervisor.resolveDesktopPort({}, true)).toBe(24_827)
    expect(hostSupervisor.resolveDesktopPort({}, false)).toBe(24_828)
  })

  it('uses a valid port override for packaged and development builds', () => {
    const env = { PYTHINKER_DESKTOP_PORT: '45231' }

    expect(hostSupervisor.resolveDesktopPort(env, true)).toBe(45_231)
    expect(hostSupervisor.resolveDesktopPort(env, false)).toBe(45_231)
  })

  it.each(['not-a-port', '70000'])('rejects an invalid port override: %s', (value) => {
    expect(() => hostSupervisor.resolveDesktopPort({ PYTHINKER_DESKTOP_PORT: value }, true))
      .toThrow(new RegExp(`PYTHINKER_DESKTOP_PORT.*${value}`, 'u'))
  })

  it('detects output that reports a port collision', () => {
    expect(hostSupervisor.isPortInUseError(
      'listen EADDRINUSE: address already in use 127.0.0.1:24827',
    )).toBe(true)
    expect(hostSupervisor.isPortInUseError('desktop Host exited before readiness (code 1, signal null)')).toBe(false)
  })

  it('detects output that reports a single-instance lock conflict', () => {
    // Verbatim failure observed when a CLI server held the global lock.
    const observed = [
      'desktop Host exited before readiness (code 1, signal null)',
      'Host output:',
      'server already running (pid=78405, port=58700, started=2026-08-17T18:06:12.341Z)',
    ].join('\n')

    expect(hostSupervisor.parseRunningServerConflict(observed)).toEqual({
      pid: 78_405,
      port: 58_700,
      startedAt: '2026-08-17T18:06:12.341Z',
    })
  })

  it('ignores failures that are not a lock conflict', () => {
    expect(hostSupervisor.parseRunningServerConflict(
      'listen EADDRINUSE: address already in use 127.0.0.1:24827',
    )).toBeUndefined()
    expect(hostSupervisor.parseRunningServerConflict('server already running')).toBeUndefined()
  })
})

describe('desktop Host supervisor', () => {
  it('starts one child for concurrent callers and returns its stdout readiness URL', async () => {
    const child = new FakeHostChild()
    const spawnHost = vi.fn(() => child)
    const supervisor = createHostSupervisor({ spawnHost })

    const first = supervisor.start()
    const second = supervisor.start()
    expect(second).toBe(first)
    expect(spawnHost).toHaveBeenCalledOnce()

    child.stdout.emit('Pythinker server: http://127.0.0.1:4567\n')
    await expect(first).resolves.toEqual({ origin: 'http://127.0.0.1:4567' })
    expect(child.signals).toEqual([])
  })

  it('does not combine stderr and stdout fragments into a readiness line', async () => {
    const child = new FakeHostChild()
    const supervisor = createHostSupervisor({ spawnHost: () => child })
    const starting = supervisor.start()
    const settled = observeSettlement(starting)

    child.stderr.emit('Pythinker se')
    child.stdout.emit('rver: http://127.0.0.1:4567\n')
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    child.stdout.emit('Pythinker server: http://127.0.0.1:4567\n')
    await expect(starting).resolves.toEqual({ origin: 'http://127.0.0.1:4567' })
  })

  it('reports output when the Host exits before readiness', async () => {
    const child = new FakeHostChild()
    const supervisor = createHostSupervisor({ spawnHost: () => child })
    const starting = supervisor.start()

    child.stderr.emit('configuration rejected\n')
    child.emitExit(7)

    await expect(starting).rejects.toThrow(/exited before readiness \(code 7, signal null\).*configuration rejected/su)
  })

  it('keeps the bearer token out of the log and the failure diagnostic', async () => {
    const child = new FakeHostChild()
    const logged: string[] = []
    const supervisor = createHostSupervisor({ spawnHost: () => child, log: chunk => { logged.push(chunk) } })
    const starting = supervisor.start()

    child.stdout.emit('Pythinker server: http://127.0.0.1:4567/#token=s3cret\n')
    await expect(starting).resolves.toEqual({ origin: 'http://127.0.0.1:4567', token: 's3cret' })

    expect(logged.join('')).not.toContain('s3cret')
    expect(logged.join('')).toContain('#token=[redacted]')
  })

  it('keeps the bearer token out of a rejected malformed readiness URL', async () => {
    const child = new FakeHostChild()
    const supervisor = createHostSupervisor({ spawnHost: () => child })
    const starting = supervisor.start()

    child.stdout.emit('Pythinker server: https://127.0.0.1:4567/#token=s3cret\n')

    await expect(starting).rejects.toThrow(/must be loopback HTTP/su)
    await expect(starting).rejects.not.toThrow(/s3cret/su)
  })

  it('keeps the bearer token out of the pre-readiness exit diagnostic', async () => {
    const child = new FakeHostChild()
    const supervisor = createHostSupervisor({ spawnHost: () => child })
    const starting = supervisor.start()

    child.stderr.emit('Pythinker server: http://127.0.0.1:4567/#token=s3cret\n')
    child.emitExit(7)

    await expect(starting).rejects.toThrow(/#token=\[redacted\]/su)
    await expect(starting).rejects.not.toThrow(/s3cret/su)
  })

  it('contains a synchronous spawn failure as a rejected start', async () => {
    const failure = new Error('spawn unavailable')
    const supervisor = createHostSupervisor({
      spawnHost: () => { throw failure },
    })

    await expect(supervisor.start()).rejects.toBe(failure)
  })

  it('forbids starting after shutdown', async () => {
    const spawnHost = vi.fn(() => new FakeHostChild())
    const supervisor = createHostSupervisor({ spawnHost })

    await expect(supervisor.shutdown()).resolves.toBeUndefined()
    await expect(supervisor.start()).rejects.toThrow('desktop Host cannot start after shutdown')
    expect(spawnHost).not.toHaveBeenCalled()
  })

  it('rejects startup when the child exits after an unterminated readiness fragment', async () => {
    const child = new FakeHostChild()
    const supervisor = createHostSupervisor({ spawnHost: () => child })
    const starting = supervisor.start()

    child.stdout.emit('Pythinker server: http://127.0.0.1:4567')
    child.emitExit(0)

    await expect(starting).rejects.toThrow(/exited before readiness/iu)
  })

  it('times out startup once and terminates the unready child', async () => {
    vi.useFakeTimers()
    const child = new FakeHostChild()
    const supervisor = createHostSupervisor({
      spawnHost: () => child,
      readinessTimeoutMs: 25,
    })
    const starting = supervisor.start()
    const rejected = expect(starting).rejects.toThrow('desktop Host readiness timed out after 25ms')

    await vi.advanceTimersByTimeAsync(24)
    expect(child.signals).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await rejected
    expect(child.signals).toEqual(['SIGTERM'])

    await vi.advanceTimersByTimeAsync(100)
    expect(child.signals).toEqual(['SIGTERM'])
  })

  it('reports a ready Host exit only when shutdown does not own it', async () => {
    const child = new FakeHostChild()
    const onUnexpectedExit = vi.fn()
    const supervisor = createHostSupervisor({
      spawnHost: () => child,
      onUnexpectedExit,
    })
    const starting = supervisor.start()
    await Promise.resolve()
    child.stdout.emit('Pythinker server: http://127.0.0.1:4567\n')
    await starting

    child.emitExit(9, null)

    expect(onUnexpectedExit).toHaveBeenCalledOnce()
    expect(onUnexpectedExit).toHaveBeenCalledWith({ code: 9, signal: null })
  })

  it('coalesces shutdown and waits for the ready child to exit after SIGTERM', async () => {
    vi.useFakeTimers()
    const child = new FakeHostChild()
    const onUnexpectedExit = vi.fn()
    const supervisor = createHostSupervisor({
      spawnHost: () => child,
      shutdownTimeoutMs: 25,
      onUnexpectedExit,
    })
    const starting = supervisor.start()
    child.stdout.emit('Pythinker server: http://127.0.0.1:4567\n')
    await starting

    const first = supervisor.shutdown()
    const second = supervisor.shutdown()
    const settled = observeSettlement(first)
    expect(second).toBe(first)
    expect(child.signals).toEqual(['SIGTERM'])
    expect(onUnexpectedExit).not.toHaveBeenCalled()

    child.emitExit(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toHaveBeenCalledOnce()
    await expect(first).resolves.toBeUndefined()

    await vi.advanceTimersByTimeAsync(25)
    expect(child.signals).toEqual(['SIGTERM'])
  })

  it('uses the authenticated Host shutdown API before sending a process signal', async () => {
    const child = new FakeHostChild()
    const requestShutdown = vi.fn(() => Promise.resolve())
    const supervisor = createHostSupervisor({
      spawnHost: () => child,
      requestShutdown,
      shutdownTimeoutMs: 25,
    })
    const starting = supervisor.start()
    child.stdout.emit('Pythinker server: http://127.0.0.1:4567/#token=s3cret\n')
    await starting

    const closing = supervisor.shutdown()
    await Promise.resolve()
    expect(requestShutdown).toHaveBeenCalledOnce()
    expect(requestShutdown).toHaveBeenCalledWith({ origin: 'http://127.0.0.1:4567', token: 's3cret' })
    expect(child.signals).toEqual([])

    child.emitExit(0)
    await expect(closing).resolves.toBeUndefined()
    expect(child.signals).toEqual([])
  })

  it('falls back to process termination when the Host shutdown API fails', async () => {
    const child = new FakeHostChild()
    const supervisor = createHostSupervisor({
      spawnHost: () => child,
      requestShutdown: () => Promise.reject(new Error('shutdown endpoint unavailable')),
      shutdownTimeoutMs: 25,
    })
    const starting = supervisor.start()
    child.stdout.emit('Pythinker server: http://127.0.0.1:4567\n')
    await starting

    const closing = supervisor.shutdown()
    await Promise.resolve()
    expect(child.signals).toEqual(['SIGTERM'])
    child.emitExit(0)
    await expect(closing).resolves.toBeUndefined()
  })

  it('escalates a stuck shutdown once and still waits for child exit', async () => {
    vi.useFakeTimers()
    const child = new FakeHostChild()
    const supervisor = createHostSupervisor({
      spawnHost: () => child,
      shutdownTimeoutMs: 25,
    })
    const starting = supervisor.start()
    child.stdout.emit('Pythinker server: http://127.0.0.1:4567\n')
    await starting

    const closing = supervisor.shutdown()
    const settled = observeSettlement(closing)
    expect(child.signals).toEqual(['SIGTERM'])
    await vi.advanceTimersByTimeAsync(24)
    expect(child.signals).toEqual(['SIGTERM'])
    await vi.advanceTimersByTimeAsync(1)
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(settled).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(100)
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
    child.emitExit(null, 'SIGKILL')
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toHaveBeenCalledOnce()
    await expect(closing).resolves.toBeUndefined()
  })
})

describe('desktop Host shutdown request', () => {
  it('posts the bearer token only to the validated loopback shutdown route', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))

    await requestHostShutdown({ origin: 'http://127.0.0.1:4567', token: 's3cret' })

    expect(fetch).toHaveBeenCalledOnce()
    expect(String(fetch.mock.calls[0]?.[0])).toBe('http://127.0.0.1:4567/api/v1/shutdown')
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer s3cret' },
    })
  })

  it('rejects a non-loopback shutdown origin before making a request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')

    await expect(requestHostShutdown({ origin: 'https://example.test', token: 's3cret' }))
      .rejects.toThrow('loopback HTTP origin')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('desktop Host process', () => {
  it('opts the packaged Electron executable into its Node runtime', async () => {
    const spawned = {
      stdout: { on: vi.fn(), off: vi.fn() },
      stderr: { on: vi.fn(), off: vi.fn() },
      on: vi.fn(),
      off: vi.fn(),
      kill: vi.fn(),
    }
    vi.mocked(spawn).mockReturnValue(spawned as never)

    const { spawnPythinkerServer } = await import('../src/host-supervisor')
    spawnPythinkerServer({
      nodeExecutable: '/Applications/Pythinker.app/Contents/MacOS/Pythinker',
      cliEntry: '/Applications/Pythinker.app/Contents/Resources/host/node_modules/@pymodel/pythinker-code/dist/main.mjs',
      cwd: '/Users/tester',
      env: { PYTHINKER_DESKTOP: '1' },
      port: 24_827,
      electronRunAsNode: true,
    })

    expect(spawn).toHaveBeenCalledWith(
      '/Applications/Pythinker.app/Contents/MacOS/Pythinker',
      [
        '/Applications/Pythinker.app/Contents/Resources/host/node_modules/@pymodel/pythinker-code/dist/main.mjs',
        'web',
        '--no-open',
        '--port',
        '24827',
        '--log-level',
        'error',
      ],
      expect.objectContaining({ env: { PYTHINKER_DESKTOP: '1', ELECTRON_RUN_AS_NODE: '1' } }),
    )
  })

  it('kills the Windows Host process tree', async () => {
    const child = {
      pid: 4242,
      stdout: { on: vi.fn(), off: vi.fn() },
      stderr: { on: vi.fn(), off: vi.fn() },
      on: vi.fn(),
      off: vi.fn(),
      kill: vi.fn(),
    }
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(spawnSync).mockReturnValue({
      pid: 4242,
      output: [],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      status: 0,
      signal: 'SIGTERM',
    })
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')

    const { spawnPythinkerServer } = await import('../src/host-supervisor')
    const host = spawnPythinkerServer({
      nodeExecutable: 'node',
      cliEntry: '/tmp/launcher.mjs',
      cwd: '/tmp',
      env: {},
      port: 24_827,
    })
    host.kill('SIGTERM')

    expect(spawnSync).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', '4242', '/T', '/F'],
      { windowsHide: true, timeout: 5_000 },
    )
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('falls back to killing the Windows Host when taskkill times out', async () => {
    const child = {
      pid: 4242,
      stdout: { on: vi.fn(), off: vi.fn() },
      stderr: { on: vi.fn(), off: vi.fn() },
      on: vi.fn(),
      off: vi.fn(),
      kill: vi.fn(),
    }
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(spawnSync).mockReturnValue({
      pid: 4242,
      output: [],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      status: null,
      signal: null,
      error: Object.assign(new Error('spawnSync taskkill ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    })
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')

    const { spawnPythinkerServer } = await import('../src/host-supervisor')
    const host = spawnPythinkerServer({
      nodeExecutable: 'node',
      cliEntry: '/tmp/launcher.mjs',
      cwd: '/tmp',
      env: {},
      port: 24_827,
    })
    host.kill('SIGTERM')

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('uses child.kill unchanged on non-Windows', async () => {
    const child = {
      pid: 4242,
      stdout: { on: vi.fn(), off: vi.fn() },
      stderr: { on: vi.fn(), off: vi.fn() },
      on: vi.fn(),
      off: vi.fn(),
      kill: vi.fn(),
    }
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(spawnSync).mockClear()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')

    const { spawnPythinkerServer } = await import('../src/host-supervisor')
    const host = spawnPythinkerServer({
      nodeExecutable: 'node',
      cliEntry: '/tmp/launcher.mjs',
      cwd: '/tmp',
      env: {},
      port: 24_827,
    })
    host.kill('SIGTERM')

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(spawnSync).not.toHaveBeenCalled()
  })
})

describe('resolveHostExecutable', () => {
  const APP = '/Applications/Pythinker.app/Contents/MacOS/Pythinker'
  const FRAMEWORKS = '/Applications/Pythinker.app/Contents/Frameworks'
  const HELPER = `${FRAMEWORKS}/Pythinker Helper.app/Contents/MacOS/Pythinker Helper`

  it('runs the Host from the LSUIElement helper so it takes no Dock tile of its own', () => {
    // Re-execing the app's own binary registers a second Foreground app under
    // the same bundle id, which shows up as a stray generic-executable icon in
    // the Dock next to the real app.
    const seen: string[] = []
    const resolved = resolveHostExecutable({
      platform: 'darwin',
      execPath: APP,
      frameworksPath: FRAMEWORKS,
      exists: path => {
        seen.push(path)
        return path === HELPER
      },
    })
    expect(resolved).toBe(HELPER)
    expect(seen).toEqual([HELPER])
  })

  it('keeps the app executable when the bundle ships no matching helper', () => {
    expect(
      resolveHostExecutable({
        platform: 'darwin',
        execPath: APP,
        frameworksPath: FRAMEWORKS,
        exists: () => false,
      }),
    ).toBe(APP)
  })

  it('leaves non-macOS platforms alone', () => {
    for (const platform of ['win32', 'linux']) {
      expect(
        resolveHostExecutable({
          platform,
          execPath: 'C:\\Program Files\\Pythinker\\Pythinker.exe',
          frameworksPath: 'C:\\Program Files\\Pythinker\\Frameworks',
          exists: () => true,
        }),
      ).toBe('C:\\Program Files\\Pythinker\\Pythinker.exe')
    }
  })
})
