import { describe, expect, it } from 'vitest'
import { adaptMacReleaseEnvironment, assertMacReleaseReady } from '../scripts/release-preflight'

const DEVELOPER_ID_OUTPUT = `
  1) 0123456789ABCDEF "Developer ID Application: Mengxin Yang (TEAM123456)"
     1 valid identities found
`

function ready(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return assertMacReleaseReady({
    env: { APPLE_KEYCHAIN_PROFILE: 'pythinker-notary', ...overrides },
    platform: 'darwin',
    listCodeSigningIdentities: () => DEVELOPER_ID_OUTPUT,
  })
}

describe('macOS release preflight', () => {
  it('accepts a valid Developer ID identity and Keychain notary profile', () => {
    expect(ready()).toEqual({
      identity: 'Developer ID Application: Mengxin Yang (TEAM123456)',
      notarization: 'keychain-profile',
      signing: 'keychain',
    })
  })

  it.each([
    {
      env: {
        APPLE_API_KEY: '/private/AuthKey.p8',
        APPLE_API_KEY_ID: 'KEY123',
        APPLE_API_ISSUER: 'issuer-id',
        APPLE_KEYCHAIN_PROFILE: undefined,
      },
      source: 'api-key',
    },
    {
      env: {
        APPLE_ID: 'developer@example.test',
        APPLE_APP_SPECIFIC_PASSWORD: 'secret',
        APPLE_TEAM_ID: 'TEAM123456',
        APPLE_KEYCHAIN_PROFILE: undefined,
      },
      source: 'apple-id',
    },
  ])('accepts a complete $source credential set', ({ env, source }) => {
    expect(ready(env).notarization).toBe(source)
  })

  it('rejects a missing Developer ID Application identity', () => {
    expect(() => assertMacReleaseReady({
      env: { APPLE_KEYCHAIN_PROFILE: 'pythinker-notary' },
      platform: 'darwin',
      listCodeSigningIdentities: () => '0 valid identities found',
    })).toThrow('Developer ID Application')
  })

  it('rejects an explicitly selected development identity', () => {
    expect(() => ready({ CSC_NAME: 'Apple Development: Developer (TEAM123456)' }))
      .toThrow('CSC_NAME must select a Developer ID Application')
  })

  it('adapts the supplied PKCS#12 variables without writing a certificate file', () => {
    const env = adaptMacReleaseEnvironment({
      APPLE_ID: 'developer@example.test',
      APPLE_APP_SPECIFIC_PASSWORD: 'secret',
      APPLE_TEAM_ID: 'TEAM123456',
      CSC_KEY_PASSWORD: 'p12-secret',
      MAC_CERT_P12_BASE64: Buffer.from([0x30, 0x03, 0x02, 0x01, 0x00]).toString('base64'),
      MACOS_SIGN_IDENTITY: 'Developer ID Application: Mengxin Yang (TEAM123456)',
    })
    expect(env['CSC_LINK']).toMatch(/^data:application\/x-pkcs12;base64,/)
    expect(env['CSC_NAME']).toBe('Mengxin Yang (TEAM123456)')
    expect(assertMacReleaseReady({
      env,
      platform: 'darwin',
      listCodeSigningIdentities: () => '0 valid identities found',
    }).signing).toBe('p12')
  })

  it('normalizes a shell-escaped Developer ID identity from an env file', () => {
    const env = adaptMacReleaseEnvironment({
      CSC_KEY_PASSWORD: 'p12-secret',
      MAC_CERT_P12_BASE64: Buffer.from([0x30, 0x03, 0x02, 0x01, 0x00]).toString('base64'),
      MACOS_SIGN_IDENTITY: String.raw`Developer\ ID\ Application:\ Mengxin\ Yang\ (TEAM123456)`,
    })

    expect(env['CSC_NAME']).toBe('Mengxin Yang (TEAM123456)')
  })

  it('rejects an incomplete or non-Developer-ID PKCS#12 signing group', () => {
    expect(() => adaptMacReleaseEnvironment({
      MAC_CERT_P12_BASE64: 'MA==',
    })).toThrow('MACOS_SIGN_IDENTITY')
    expect(() => adaptMacReleaseEnvironment({
      CSC_KEY_PASSWORD: 'secret',
      MAC_CERT_P12_BASE64: 'MA==',
      MACOS_SIGN_IDENTITY: 'Apple Development: Developer (TEAM123456)',
    })).toThrow('Developer ID Application')
  })

  it('rejects partial notarization credentials before electron-builder can skip notarization', () => {
    expect(() => ready({
      APPLE_API_KEY: '/private/AuthKey.p8',
      APPLE_KEYCHAIN_PROFILE: undefined,
    })).toThrow('APPLE_API_KEY_ID, APPLE_API_ISSUER')
  })

  it('rejects release execution away from macOS', () => {
    expect(() => assertMacReleaseReady({
      env: { APPLE_KEYCHAIN_PROFILE: 'pythinker-notary' },
      platform: 'win32',
      listCodeSigningIdentities: () => DEVELOPER_ID_OUTPUT,
    })).toThrow('must be built on macOS')
  })
})
