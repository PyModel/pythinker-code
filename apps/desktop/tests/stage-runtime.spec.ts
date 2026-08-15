import { describe, expect, it } from 'vitest'
import { packageManagerInvocation } from '../scripts/stage-runtime'

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
