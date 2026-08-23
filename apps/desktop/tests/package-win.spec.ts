import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  requireWindowsReleaseSigning,
  windowsPackageInvocation,
  windowsSigningArgs,
} from '../scripts/package-win'

interface SchemaNode {
  readonly $ref?: string
  readonly anyOf?: readonly SchemaNode[]
  readonly properties?: Readonly<Record<string, SchemaNode>>
}

const requireFromTests = createRequire(import.meta.url)
const schema = requireFromTests(
  requireFromTests.resolve('app-builder-lib/scheme.json', {
    paths: [requireFromTests.resolve('electron-builder')],
  }),
) as { readonly definitions: Readonly<Record<string, SchemaNode>> }

function referencedDefinition(node: SchemaNode): SchemaNode | undefined {
  const reference = node.$ref ?? node.anyOf?.find(branch => branch.$ref !== undefined)?.$ref
  return reference === undefined ? undefined : schema.definitions[reference.replace('#/definitions/', '')]
}

/**
 * Assert that a `--config.<path>` option exists in the installed Electron Builder schema.
 *
 * `WindowsConfiguration` sets `additionalProperties: false`, so an option that
 * the schema does not declare fails validation before any build work and takes
 * the whole `win` object down with it. Comparing against the real schema keeps
 * these arguments honest across Electron Builder upgrades, which is what an
 * expected-array assertion cannot do.
 * @param path - Dotted option path with the `--config.` prefix removed.
 */
function assertSchemaOption(path: string): void {
  const [root, ...rest] = path.split('.')
  expect(root).toBe('win')
  let definition = schema.definitions['WindowsConfiguration']!
  rest.forEach((segment, index) => {
    const property = definition.properties?.[segment]
    if (property === undefined) {
      throw new Error(`Electron Builder has no option '${rest.slice(0, index + 1).join('.')}' under win`)
    }
    const next = referencedDefinition(property)
    if (next !== undefined) definition = next
    else if (index !== rest.length - 1) {
      throw new Error(`Electron Builder option 'win.${rest.slice(0, index + 1).join('.')}' has no nested options`)
    }
  })
}

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

describe('Electron Builder option names', () => {
  const certificateEnvironment: NodeJS.ProcessEnv = {
    WIN_CSC_LINK: 'certificate.p12',
    WIN_CSC_KEY_PASSWORD: 'password',
    WINDOWS_SIGNING_PUBLISHER_NAME: 'CN=Example Publisher, O=Example Publisher',
  }

  it('emits only options the installed Electron Builder schema declares', () => {
    for (const environment of [signingEnvironment, certificateEnvironment]) {
      const options = windowsSigningArgs(environment).filter(argument => argument.startsWith('--config.'))
      expect(options.length).toBeGreaterThan(0)
      for (const option of options) assertSchemaOption(option.slice('--config.'.length))
    }
  })

  it('rejects an option the schema does not declare', () => {
    expect(() => { assertSchemaOption('win.publisherName') })
      .toThrow("Electron Builder has no option 'publisherName' under win")
  })
})

describe('Windows tagged-release signing', () => {
  it('rejects an unsigned tagged release', () => {
    expect(() => requireWindowsReleaseSigning({})).toThrow('Windows release signing is not configured')
  })

  it('accepts a complete certificate configuration and sets the updater publisher', () => {
    const environment = {
      WIN_CSC_LINK: 'certificate.p12',
      WIN_CSC_KEY_PASSWORD: 'password',
      WINDOWS_SIGNING_PUBLISHER_NAME: 'CN=Example Publisher, O=Example Publisher',
    }

    expect(requireWindowsReleaseSigning(environment)).toBe('CN=Example Publisher, O=Example Publisher')
    expect(windowsSigningArgs(environment)).toEqual([
      '--config.win.signtoolOptions.publisherName', 'CN=Example Publisher, O=Example Publisher',
    ])
  })

  it('rejects a partial certificate configuration', () => {
    expect(() => requireWindowsReleaseSigning({ WIN_CSC_LINK: 'certificate.p12' }))
      .toThrow('WIN_CSC_KEY_PASSWORD, WINDOWS_SIGNING_PUBLISHER_NAME')
  })

  it('rejects simultaneous certificate and Azure signing', () => {
    expect(() => requireWindowsReleaseSigning({
      ...signingEnvironment,
      WIN_CSC_LINK: 'certificate.p12',
      WIN_CSC_KEY_PASSWORD: 'password',
      WINDOWS_SIGNING_PUBLISHER_NAME: 'CN=Other Publisher',
    })).toThrow('Choose one Windows signing method')
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
