import { describe, expect, it } from 'vitest'
import { windowsPackageInvocation, windowsSigningArgs } from '../scripts/package-win'

const signingEnvironment: NodeJS.ProcessEnv = {
  AZURE_TENANT_ID: 'tenant-id',
  AZURE_CLIENT_ID: 'client-id',
  AZURE_CLIENT_SECRET: 'client-secret',
  AZURE_SIGNING_ENDPOINT: 'https://example.test',
  AZURE_SIGNING_ACCOUNT: 'signing-account',
  AZURE_SIGNING_CERT_PROFILE: 'certificate-profile',
  AZURE_SIGNING_PUBLISHER_NAME: 'CN=Example Publisher, O=Example Publisher, L=Redmond, S=WA, C=US',
}

describe('Windows Azure signing configuration', () => {
  it('leaves the build unsigned when no signing variables are set', () => {
    expect(windowsSigningArgs({})).toEqual([])
  })

  it('passes Azure signing settings as separate Electron Builder arguments', () => {
    expect(windowsSigningArgs(signingEnvironment)).toEqual([
      '--config.win.azureSignOptions.endpoint', 'https://example.test',
      '--config.win.azureSignOptions.codeSigningAccountName', 'signing-account',
      '--config.win.azureSignOptions.certificateProfileName', 'certificate-profile',
      '--config.win.azureSignOptions.publisherName', 'CN=Example Publisher, O=Example Publisher, L=Redmond, S=WA, C=US',
    ])
  })

  it('rejects a missing Azure credential', () => {
    expect(() => windowsSigningArgs({
      ...signingEnvironment,
      AZURE_CLIENT_SECRET: undefined,
    })).toThrow(
      'Windows signing is partially configured; missing: AZURE_CLIENT_SECRET. Set all seven signing variables or none.',
    )
  })

  it('rejects a missing Azure signing setting', () => {
    expect(() => windowsSigningArgs({
      ...signingEnvironment,
      AZURE_SIGNING_ACCOUNT: undefined,
    })).toThrow(
      'Windows signing is partially configured; missing: AZURE_SIGNING_ACCOUNT. Set all seven signing variables or none.',
    )
  })

  it('treats whitespace-only signing values as absent', () => {
    expect(() => windowsSigningArgs({
      ...signingEnvironment,
      AZURE_SIGNING_PUBLISHER_NAME: '   ',
    })).toThrow('AZURE_SIGNING_PUBLISHER_NAME')
  })
})

describe('Windows package invocation', () => {
  it('quotes the publisher name on Windows', () => {
    const invocation = windowsPackageInvocation('win32', signingEnvironment, 'never')

    expect(invocation.args).toContain('"CN=Example Publisher, O=Example Publisher, L=Redmond, S=WA, C=US"')
    expect(invocation.shell).toBe(true)
  })

  it('leaves the publisher name unquoted outside Windows', () => {
    const invocation = windowsPackageInvocation('darwin', signingEnvironment, 'never')

    expect(invocation.args).toContain('CN=Example Publisher, O=Example Publisher, L=Redmond, S=WA, C=US')
    expect(invocation.shell).toBe(false)
  })

  it('preserves argument order and content outside Windows', () => {
    expect(windowsPackageInvocation('darwin', signingEnvironment, 'never').args).toEqual([
      'exec', 'electron-builder', '--win', 'nsis', '--x64', '--publish', 'never',
      '--config.win.azureSignOptions.endpoint', 'https://example.test',
      '--config.win.azureSignOptions.codeSigningAccountName', 'signing-account',
      '--config.win.azureSignOptions.certificateProfileName', 'certificate-profile',
      '--config.win.azureSignOptions.publisherName', 'CN=Example Publisher, O=Example Publisher, L=Redmond, S=WA, C=US',
    ])
  })

  it('omits signing arguments when signing is not configured', () => {
    const expectedArgs = ['exec', 'electron-builder', '--win', 'nsis', '--x64', '--publish', 'never']
    const darwin = windowsPackageInvocation('darwin', {}, 'never')
    const win32 = windowsPackageInvocation('win32', {}, 'never')

    expect(darwin.args).toEqual(expectedArgs)
    expect(win32.args).toEqual(expectedArgs)
    expect(darwin.args.some(argument => argument.startsWith('--config.win.'))).toBe(false)
    expect(win32.args.some(argument => argument.startsWith('--config.win.'))).toBe(false)
  })

  it('uses pnpm on both platforms', () => {
    expect(windowsPackageInvocation('darwin', signingEnvironment, 'never').command).toBe('pnpm')
    expect(windowsPackageInvocation('win32', signingEnvironment, 'never').command).toBe('pnpm')
  })
})
