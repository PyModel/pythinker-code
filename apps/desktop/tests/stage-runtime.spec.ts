import { isAbsolute, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEPLOY_ATTEMPTS,
  deployRetryDelayMs,
  deployTargetArgument,
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
    expect(waits).toEqual([deployRetryDelayMs(1), deployRetryDelayMs(2)])
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

  it('backs off further on the second retry', () => {
    expect(deployRetryDelayMs(2)).toBeGreaterThan(deployRetryDelayMs(1))
  })
})
