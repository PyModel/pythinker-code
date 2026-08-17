import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildNotarytoolArguments,
  finalizeMacArtifacts,
  rewriteLatestMacYaml,
} from '../scripts/finalize-mac-artifacts'

const directories: string[] = []

interface NotarytoolCase {
  readonly args: readonly string[]
  readonly env: Readonly<NodeJS.ProcessEnv>
}

const notarytoolCases: readonly NotarytoolCase[] = [
  {
    args: ['--key', '/private/AuthKey.p8', '--key-id', 'KEY123', '--issuer', 'issuer-id'],
    env: {
      APPLE_API_KEY: '/private/AuthKey.p8',
      APPLE_API_KEY_ID: 'KEY123',
      APPLE_API_ISSUER: 'issuer-id',
    },
  },
  {
    args: [
      '--apple-id', 'developer@example.test',
      '--password', 'app-password',
      '--team-id', 'TEAM123456',
    ],
    env: {
      APPLE_ID: 'developer@example.test',
      APPLE_APP_SPECIFIC_PASSWORD: 'app-password',
      APPLE_TEAM_ID: 'TEAM123456',
    },
  },
  {
    args: [
      '--keychain-profile', 'pythinker-notary',
      '--keychain', '/private/login.keychain-db',
    ],
    env: {
      APPLE_KEYCHAIN: '/private/login.keychain-db',
      APPLE_KEYCHAIN_PROFILE: 'pythinker-notary',
    },
  },
]

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('macOS artifact finalization', () => {
  it.each(notarytoolCases)('builds notarytool arguments for $args', (testCase: NotarytoolCase) => {
    expect(buildNotarytoolArguments(testCase.env)).toEqual(testCase.args)
  })

  it('preserves the partial Apple ID credential failure with an API key trio', () => {
    expect(() => buildNotarytoolArguments({
      APPLE_API_KEY: '/private/AuthKey.p8',
      APPLE_API_KEY_ID: 'KEY123',
      APPLE_API_ISSUER: 'issuer-id',
      APPLE_TEAM_ID: 'TEAM123456',
    })).toThrow('Incomplete macOS notarization credentials: missing APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD')
  })

  it('updates both checksums and the file size without changing other metadata', () => {
    const input = `version: 0.1.3
files:
  - url: Pythinker-0.1.3-arm64.dmg
    sha512: old-files-checksum
    size: 166113403
path: Pythinker-0.1.3-arm64.dmg
sha512: old-top-level-checksum
releaseDate: '2026-08-17T19:11:07.700Z'
`
    const output = rewriteLatestMacYaml(
      input,
      'Pythinker-0.1.3-arm64.dmg',
      'new-base64-checksum',
      166125225,
    )

    expect(output).toBe(`version: 0.1.3
files:
  - url: Pythinker-0.1.3-arm64.dmg
    sha512: new-base64-checksum
    size: 166125225
path: Pythinker-0.1.3-arm64.dmg
sha512: new-base64-checksum
releaseDate: '2026-08-17T19:11:07.700Z'
`)
  })

  it('uses the injected runner, repairs metadata, and removes the stale blockmap', () => {
    const distDir = mkdtempSync(join(tmpdir(), 'pythinker-mac-artifacts-'))
    directories.push(distDir)
    const filename = 'Pythinker-0.1.3-arm64.dmg'
    const dmg = Buffer.from('stapled dmg fixture')
    writeFileSync(join(distDir, filename), dmg)
    writeFileSync(join(distDir, `${filename}.blockmap`), 'stale')
    writeFileSync(join(distDir, 'latest-mac.yml'), `files:
  - url: ${filename}
    sha512: old
    size: 1
path: ${filename}
sha512: old
`)
    const runCommand = vi.fn(() => ({
      status: 0,
      stderr: '',
      stdout: '{"status":"Accepted"}',
    }))

    finalizeMacArtifacts({
      distDir,
      env: { APPLE_KEYCHAIN_PROFILE: 'pythinker-notary' },
      log: () => {},
      runCommand,
    })

    const checksum = createHash('sha512').update(dmg).digest('base64')
    expect(readFileSync(join(distDir, 'latest-mac.yml'), 'utf8')).toContain(`sha512: ${checksum}`)
    expect(() => readFileSync(join(distDir, `${filename}.blockmap`))).toThrow('ENOENT')
    expect(runCommand).toHaveBeenCalledTimes(2)
    expect(runCommand).toHaveBeenNthCalledWith(1, 'xcrun', expect.arrayContaining([
      'notarytool', 'submit', join(distDir, filename), '--wait',
    ]))
    expect(runCommand).toHaveBeenNthCalledWith(2, 'xcrun', ['stapler', 'staple', join(distDir, filename)])
  })

  it('prints and rejects a non-accepted notarytool result before stapling', () => {
    const distDir = mkdtempSync(join(tmpdir(), 'pythinker-mac-artifacts-'))
    directories.push(distDir)
    const filename = 'Pythinker-0.1.3-arm64.dmg'
    writeFileSync(join(distDir, filename), 'signed dmg fixture')
    writeFileSync(join(distDir, 'latest-mac.yml'), `files:
  - url: ${filename}
    sha512: old
    size: 1
`)
    const output = '{"status":"Invalid","message":"The signature is invalid"}'
    const runCommand = vi.fn(() => ({ status: 0, stderr: '', stdout: output }))
    const log = vi.fn()

    expect(() => {
      finalizeMacArtifacts({
        distDir,
        env: { APPLE_KEYCHAIN_PROFILE: 'pythinker-notary' },
        log: (message) => { log(message) },
        runCommand,
      })
    }).toThrow('status: Invalid')
    expect(log).toHaveBeenCalledWith(output)
    expect(runCommand).toHaveBeenCalledTimes(1)
  })
})
