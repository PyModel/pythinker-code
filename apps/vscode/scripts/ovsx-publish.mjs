#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runLocalCli } from './local-cli.mjs';
import { parsePublishArguments, publishUsage } from './publish-args.mjs';
import { messageOf, publishEachTarget } from './publish-retry.mjs';
import { extensionRoot, isMainModule } from './vsix-targets.mjs';
import { verifyVsix } from './vsix-verify.mjs';

/**
 * Open VSX refuses every publish into a namespace that does not exist yet, and
 * the Marketplace has no such concept — so a publisher that works there fails
 * here on all six targets at once. Creating it is idempotent from our side: the
 * namespace already existing is the success case, not an error.
 *
 * This is why 0.8.6 reached the Marketplace but no version ever reached Open VSX.
 */
export function ensureNamespace(namespace, run = runLocalCli) {
  try {
    run('ovsx', 'ovsx', ['create-namespace', namespace], {
      cwd: extensionRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    console.log(`Created Open VSX namespace ${namespace}.`);
  } catch (error) {
    if (/already exists|already owned/i.test(messageOf(error))) return;
    throw error;
  }
}

function publisherName() {
  const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'));
  if (typeof manifest.publisher !== 'string' || manifest.publisher === '') {
    throw new Error('apps/vscode/package.json has no publisher to use as the Open VSX namespace.');
  }
  return manifest.publisher;
}

async function main() {
  const options = parsePublishArguments(process.argv.slice(2));
  if (options.help) {
    console.log(publishUsage('Open VSX'));
    return;
  }
  if (!process.env.OVSX_PAT) throw new Error('OVSX_PAT is required to publish.');

  await verifyInputs(options);
  ensureNamespace(publisherName());
  await publishEachTarget({
    targets: options.targets,
    files: options.files,
    registry: 'Open VSX',
    publishOne: (file) => {
      try {
        runLocalCli('ovsx', 'ovsx', ['publish', file], {
          cwd: extensionRoot,
          encoding: 'utf8',
          stdio: 'pipe',
        });
        return 'published';
      } catch (error) {
        if (/already exists/i.test(messageOf(error))) return 'skipped';
        throw error;
      }
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
    console.error(`Open VSX publish failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
