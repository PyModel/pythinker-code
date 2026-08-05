#!/usr/bin/env node
import { existsSync } from 'node:fs';

import { runLocalCli } from './local-cli.mjs';
import { parsePublishArguments, publishUsage } from './publish-args.mjs';
import { publishEachTarget } from './publish-retry.mjs';
import { extensionRoot, isMainModule } from './vsix-targets.mjs';
import { verifyVsix } from './vsix-verify.mjs';

async function main() {
  const options = parsePublishArguments(process.argv.slice(2));
  if (options.help) {
    console.log(publishUsage('Visual Studio Marketplace'));
    return;
  }
  // A token is the only option in CI, but a maintainer publishing by hand can
  // authenticate as the Entra identity `az login` already established instead.
  const azureCredential = process.env.VSCE_AZURE_CREDENTIAL === '1';
  if (!azureCredential && !process.env.VSCE_PAT) {
    throw new Error('Set VSCE_PAT, or VSCE_AZURE_CREDENTIAL=1 to publish as the signed-in Entra identity.');
  }

  await verifyInputs(options);
  await publishEachTarget({
    targets: options.targets,
    files: options.files,
    registry: 'Marketplace',
    publishOne: (file) => {
      const result = runLocalCli(
        '@vscode/vsce',
        'vsce',
        ['publish', '--packagePath', file, '--skip-duplicate', ...(azureCredential ? ['--azure-credential'] : [])],
        { cwd: extensionRoot, encoding: 'utf8', stdio: 'pipe' },
      );
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      process.stdout.write(output);
      return /already published/i.test(output) ? 'skipped' : 'published';
    },
  });
}

async function verifyInputs(options) {
  for (let index = 0; index < options.targets.length; index += 1) {
    const file = options.files[index];
    if (!existsSync(file)) {
      throw new Error(`Missing VSIX ${file}. Run pnpm run package:platform first.`);
    }
    await verifyVsix(file, options.targets[index], { sourceRoot: extensionRoot });
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(`Marketplace publish failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
