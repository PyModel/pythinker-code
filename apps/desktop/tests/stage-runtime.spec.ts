import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  DEPLOY_ATTEMPTS,
  assertWindowsNodePty,
  deployRetryDelayMs,
  deployTargetArgument,
  dereferenceSymlinks,
  packageManagerInvocation,
  withDeployRetries,
} from '../scripts/stage-runtime'

describe('package manager invocation', () => {
  it('leaves non-Windows invocations untouched', () => {
    const args = ['--filter', 'x', '/tmp/a b']

    expect(packageManagerInvocation('darwin', 'pnpm', args)).toEqual({
      command: 'pnpm',
      args,
      shell: false,
    })
  })

  it('uses a shell on Windows', () => {
    expect(packageManagerInvocation('win32', 'pnpm', ['deploy']).shell).toBe(true)
  })

  it('quotes a Windows path containing a space', () => {
    expect(packageManagerInvocation('win32', 'pnpm', ['deploy', 'C:\\Users\\John Doe\\tmp']).args)
      .toEqual(['deploy', '"C:\\Users\\John Doe\\tmp"'])
  })

  it('leaves a safe Windows argument alone', () => {
    expect(packageManagerInvocation('win32', 'pnpm', ['--config.node-linker=hoisted']).args)
      .toEqual(['--config.node-linker=hoisted'])
  })

  it('quotes a Windows cmd metacharacter', () => {
    expect(packageManagerInvocation('win32', 'pnpm', ['deploy&verify']).args)
      .toEqual(['"deploy&verify"'])
  })
})

describe('deploy target argument', () => {
  it('is relative to the workspace root', () => {
    expect(deployTargetArgument('/repo', '/repo/node_modules/.pythinker-desktop-staging/runtime-abc123'))
      .toBe(join('node_modules', '.pythinker-desktop-staging', 'runtime-abc123'))
  })

  it('is never absolute', () => {
    expect(isAbsolute(deployTargetArgument('/repo', '/repo/node_modules/.pythinker-desktop-staging/runtime-abc123')))
      .toBe(false)
  })

  it('never returns the target unchanged', () => {
    const target = '/repo/node_modules/.pythinker-desktop-staging/runtime-abc123'

    expect(deployTargetArgument('/repo', target)).not.toBe(target)
  })
})

describe('Windows node-pty materialization', () => {
  it('replaces a symlink with the file it names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pythinker-deref-'))
    try {
      const real = join(root, 'real.node')
      const link = join(root, 'tree', 'pty.node')
      await writeFile(real, 'addon')
      await mkdir(join(root, 'tree'))
      await symlink(real, link)

      await dereferenceSymlinks(join(root, 'tree'))

      const metadata = await lstat(link)
      expect(metadata.isSymbolicLink()).toBe(false)
      expect(metadata.isFile()).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a staged Host whose pty.node is still a symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pythinker-pty-assert-'))
    try {
      const real = join(root, 'real.node')
      const nodeModules = join(root, 'node_modules')
      const link = join(nodeModules, 'node-pty', 'prebuilds', 'win32-x64', 'pty.node')
      await writeFile(real, 'addon')
      await mkdir(join(link, '..'), { recursive: true })
      await symlink(real, link)
      await writeFile(join(link, '..', 'conpty.node'), '')
      await writeFile(join(link, '..', 'conpty_console_list.node'), '')

      await expect(assertWindowsNodePty(nodeModules)).rejects.toThrow(/pty\.node/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('deploy retries', () => {
  function recorder() {
    const waits: number[] = []
    return { waits, sleep: async (milliseconds: number) => { waits.push(milliseconds) } }
  }

  it('does not retry a first-attempt success', async () => {
    const { waits, sleep } = recorder()
    let calls = 0

    await withDeployRetries(async () => { calls += 1 }, { sleep })

    expect(calls).toBe(1)
    expect(waits).toEqual([])
  })

  it('retries a transient failure and resolves', async () => {
    const { waits, sleep } = recorder()
    const retried: number[] = []

    await withDeployRetries(
      async (attempt) => { if (attempt < 3) throw new Error('ERR_PNPM_NO_MATCHING_VERSION') },
      { sleep, onRetry: (attempt) => retried.push(attempt) },
    )

    expect(retried).toEqual([1, 2])
    expect(waits).toEqual([5_000, 20_000])
  })

  // A deterministic failure must still fail the build, and must surface its own
  // error rather than a wrapper that hides which command broke.
  it('rethrows the last failure once the attempts run out', async () => {
    const { waits, sleep } = recorder()
    let calls = 0

    await expect(withDeployRetries(
      async () => { calls += 1; throw new Error(`attempt ${String(calls)} failed`) },
      { sleep },
    )).rejects.toThrow('attempt 3 failed')

    expect(calls).toBe(DEPLOY_ATTEMPTS)
    expect(waits).toHaveLength(DEPLOY_ATTEMPTS - 1)
  })

  // Ordering alone would accept a 0ms/1ms backoff, which retries faster than a
  // registry propagates and turns one retry into three failures in a row.
  it('waits five seconds before the first retry and twenty before the second', () => {
    expect(deployRetryDelayMs(1)).toBe(5_000)
    expect(deployRetryDelayMs(2)).toBe(20_000)
    expect(deployRetryDelayMs(2)).toBeGreaterThan(deployRetryDelayMs(1))
  })
})
