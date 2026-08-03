import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applyManagedPythinkerCodeConfig,
  PYTHINKER_CODE_PROVIDER_NAME,
  PythinkerOAuthToolkit,
  type DeviceAuthorization,
  type PythinkerHostIdentity,
  type ManagedPythinkerConfigShape,
} from '@pythoughts/pythinker-code-oauth';

async function main(): Promise<void> {
  const explicitHomeDir = process.env['PYTHINKER_OAUTH_SMOKE_HOME'];
  const homeDir = explicitHomeDir ?? (await mkdtemp(join(tmpdir(), 'pythinker-oauth-smoke-')));
  const keepToken = shouldKeepToken(explicitHomeDir !== undefined);
  const forceLogin = process.env['PYTHINKER_OAUTH_SMOKE_FORCE_LOGIN'] === '1';
  const config: ManagedPythinkerConfigShape = { providers: {} };

  const toolkit = new PythinkerOAuthToolkit<ManagedPythinkerConfigShape>({
    homeDir,
    identity: smokeIdentityFromEnv(),
    configAdapter: {
      read: () => config,
      write: () => {},
      apply: applyManagedPythinkerCodeConfig,
      configPath: '<memory>',
    },
  });

  process.stdout.write(`home: ${homeDir}\n`);

  try {
    if (forceLogin) {
      await toolkit.logout(PYTHINKER_CODE_PROVIDER_NAME);
      process.stdout.write('cleared existing smoke token\n');
    }

    const login = await toolkit.login(PYTHINKER_CODE_PROVIDER_NAME, {
      onDeviceCode: printDeviceCode,
    });
    const status = await toolkit.status(PYTHINKER_CODE_PROVIDER_NAME);
    const accessToken = await toolkit.tokenProvider(PYTHINKER_CODE_PROVIDER_NAME).getAccessToken();
    const usage = await toolkit.getManagedUsage(PYTHINKER_CODE_PROVIDER_NAME);

    if (login.provision?.defaultModel === undefined) {
      throw new Error('login did not provision a default model');
    }
    if (status.providers[0]?.hasToken !== true) {
      throw new Error('status did not report a stored token after login');
    }
    if (accessToken.length === 0) {
      throw new Error('token provider returned an empty access token');
    }
    if (config.providers[PYTHINKER_CODE_PROVIDER_NAME] === undefined) {
      throw new Error('managed provider was not written to config');
    }

    process.stdout.write(`provider: ${login.providerName}\n`);
    process.stdout.write(`default model: ${login.provision.defaultModel}\n`);
    process.stdout.write(`models: ${String(login.provision.models.length)}\n`);
    printUsage(usage);
    process.stdout.write('oauth smoke passed\n');
  } finally {
    if (!keepToken) {
      await toolkit.logout(PYTHINKER_CODE_PROVIDER_NAME).catch(() => {});
    }
    if (explicitHomeDir === undefined && !keepToken) {
      await rm(homeDir, { recursive: true, force: true });
    }
  }
}

function smokeIdentityFromEnv(): PythinkerHostIdentity {
  const version = process.env['PYTHINKER_CODE_SMOKE_VERSION'];
  if (version === undefined || version.trim().length === 0) {
    throw new Error('PYTHINKER_CODE_SMOKE_VERSION is required for Pythinker OAuth smoke.');
  }
  return {
    userAgentProduct: "pythinker-code-cli",
    version,
  };
}

function printDeviceCode(auth: DeviceAuthorization): void {
  process.stdout.write(
    [
      'Complete Pythinker OAuth device login:',
      `  URL: ${auth.verificationUriComplete || auth.verificationUri}`,
      `  Code: ${auth.userCode}`,
      auth.expiresIn === null ? undefined : `  Expires in: ${String(auth.expiresIn)}s`,
      '',
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n'),
  );
}

function printUsage(
  usage: Awaited<ReturnType<PythinkerOAuthToolkit<ManagedPythinkerConfigShape>['getManagedUsage']>>,
): void {
  if (usage.kind === 'error') {
    process.stderr.write(`usage request returned: ${usage.message}\n`);
    return;
  }
  const summary = usage.summary;
  if (summary === null) {
    process.stdout.write(`usage: no summary, limits=${String(usage.limits.length)}\n`);
    return;
  }
  process.stdout.write(
    `usage: ${summary.label} ${String(summary.used)}/${String(summary.limit)}\n`,
  );
}

function shouldKeepToken(hasExplicitHomeDir: boolean): boolean {
  const value = process.env['PYTHINKER_OAUTH_SMOKE_KEEP_TOKEN'];
  if (value !== undefined) return value === '1' || value === 'true';
  return hasExplicitHomeDir;
}

try {
  await main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
