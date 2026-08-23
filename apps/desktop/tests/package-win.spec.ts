import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  requireWindowsReleaseSigning,
  windowsPackageInvocation,
  windowsSigningArgs,
} from '../scripts/package-win'

type JsonObject = Record<string, unknown>

const requireFromTests = createRequire(import.meta.url)
const electronBuilderPath = requireFromTests.resolve('electron-builder')
const schema: unknown = requireFromTests(
  requireFromTests.resolve('app-builder-lib/scheme.json', { paths: [electronBuilderPath] }),
)
const Ajv = requireFromTests(requireFromTests.resolve('ajv', { paths: [electronBuilderPath] })) as {
  readonly default: new (options: JsonObject) => {
    compile: (schema: unknown) => ((data: unknown) => boolean) & { errors?: readonly { instancePath: string, keyword: string, message?: string, params: JsonObject }[] }
  }
}
// The same Ajv settings app-builder-lib validates a release configuration with,
// so a configuration this accepts is one Electron Builder accepts.
const validateConfiguration = new Ajv.default({
  allErrors: true,
  verbose: true,
  coerceTypes: true,
  strict: false,
}).compile(schema)

const baseConfiguration = (requireFromTests('../package.json') as { readonly build: JsonObject }).build

/**
 * Apply generated `--config.<path> <value>` arguments to the packaged build configuration.
 * @param args - Arguments as they reach Electron Builder.
 * @returns The configuration Electron Builder would validate.
 */
function configurationFrom(args: readonly string[]): JsonObject {
  const configuration = structuredClone(baseConfiguration)
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (!argument.startsWith('--config.')) continue
    const path = argument.slice('--config.'.length).split('.')
    let node = configuration
    for (const key of path.slice(0, -1)) {
      node[key] ??= {}
      node = node[key] as JsonObject
    }
    node[path.at(-1)!] = args[index + 1]
    index += 1
  }
  return configuration
}

/**
 * Assert Electron Builder would accept the configuration these arguments produce.
 *
 * Comparing generated arguments against a hand-written array cannot tell that
 * the arguments are invalid — both copies carry the same mistake. Electron
 * Builder validates the merged configuration before it packages anything, so
 * running that same validation here fails in the suite instead of at the tag.
 * @param args - Arguments as they reach Electron Builder.
 */
function assertConfigurationAccepted(args: readonly string[]): void {
  if (validateConfiguration(configurationFrom(args))) return
  const errors = validateConfiguration.errors ?? []
  const unknown = errors
    .filter(error => error.keyword === 'additionalProperties')
    .map(error => `${error.instancePath}.${String(error.params['additionalProperty'])}`)
  if (unknown.length > 0) throw new Error(`Electron Builder rejects unknown options: ${unknown.join(', ')}`)
  // anyOf/type noise follows every real error; the specific keywords name the cause.
  const specific = errors.filter(error => error.keyword !== 'anyOf' && error.keyword !== 'type')
  const reported = (specific.length > 0 ? specific : errors)
    .map(error => `${error.instancePath === '' ? 'configuration' : error.instancePath} ${error.message ?? 'is invalid'}`)
  throw new Error(`Electron Builder rejects the configuration: ${[...new Set(reported)].join('; ')}`)
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

describe('Electron Builder configuration', () => {
  const certificateEnvironment: NodeJS.ProcessEnv = {
    WIN_CSC_LINK: 'certificate.p12',
    WIN_CSC_KEY_PASSWORD: 'password',
    WINDOWS_SIGNING_PUBLISHER_NAME: 'CN=Example Publisher, O=Example Publisher',
  }

  it('accepts the packaged configuration on its own', () => {
    expect(() => { assertConfigurationAccepted([]) }).not.toThrow()
  })

  it('accepts the configuration every signing method produces', () => {
    for (const environment of [signingEnvironment, certificateEnvironment]) {
      const args = windowsSigningArgs(environment)
      expect(args.length).toBeGreaterThan(0)
      expect(() => { assertConfigurationAccepted(args) }).not.toThrow()
    }
  })

  it('rejects an option Electron Builder has removed', () => {
    expect(() => { assertConfigurationAccepted(['--config.win.publisherName', 'CN=Example Publisher']) })
      .toThrow('Electron Builder rejects unknown options: /win.publisherName')
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
