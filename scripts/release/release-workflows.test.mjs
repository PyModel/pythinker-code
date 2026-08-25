import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

void test('release workflow uses full push-boundary lane signals and isolated jobs', () => {
  const workflow = read('.github/workflows/release.yml');
  const desktopJob = workflow.slice(
    workflow.indexOf('  cut-desktop-tag:'),
    workflow.indexOf('  publish-vscode-extension:'),
  );
  assert.match(workflow, /github\.event\.before/u);
  assert.match(workflow, /pythinker_native_release:.*cli_version_bumped/u);
  assert.match(workflow, /^  cut-desktop-tag:/mu);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/vscode-release\.yml/u);
  assert.match(workflow, /^  release-summary:/mu);
  assert.doesNotMatch(workflow, /HEAD\^:apps\/vscode\/package\.json/u);
  assert.match(desktopJob, /permission-contents: write/u);
  assert.match(workflow, /pythinker_release_tag: \$\{\{ steps\.pythinker-release\.outputs\.tag \|\|/u);
  assert.match(workflow, /APPLE_CERTIFICATE_P12: \$\{\{ secrets\.MAC_CSC_LINK \}\}/u);
  assert.match(workflow, /APPLE_NOTARIZATION_KEY_P8: \$\{\{ secrets\.APPLE_API_KEY_P8 \}\}/u);
});

void test('VS Code release supports isolated recovery and attests verified VSIX files', () => {
  const workflow = read('.github/workflows/vscode-release.yml');
  assert.match(workflow, /^  workflow_call:/mu);
  assert.match(workflow, /^  workflow_dispatch:/mu);
  assert.match(workflow, /actions\/attest@[0-9a-f]{40}/u);
  assert.match(workflow, /artifact-metadata: write/u);
  assert.doesNotMatch(workflow, /continue-on-error: true/u);
});

void test('native releases fail without requested signing and attest each zip', () => {
  const workflow = read('.github/workflows/_native-build.yml');
  const manualWorkflow = read('.github/workflows/manual-native-bundle.yml');
  assert.match(workflow, /Require macOS signing secrets/u);
  assert.match(workflow, /actions\/attest@[0-9a-f]{40}/u);
  assert.match(workflow, /if-no-files-found: error/u);
  assert.doesNotMatch(workflow, /uses: actions\/(checkout|setup-node|upload-artifact)@v\d+/u);
  assert.equal(workflow.match(/persist-credentials: false/gu)?.length, 1);
  assert.match(manualWorkflow, /id-token: write/u);
  assert.match(manualWorkflow, /attestations: write/u);
  assert.match(manualWorkflow, /artifact-metadata: write/u);
});

void test('nightly reconciliation maintains one release drift issue', () => {
  const workflow = read('.github/workflows/nightly.yml');
  assert.match(workflow, /uses: \.\/\.github\/workflows\/desktop-release\.yml/u);
  assert.match(workflow, /^  desktop-nightly:/mu);
  assert.match(workflow, /needs: \[publish, desktop-nightly\]/u);
  assert.doesNotMatch(workflow, /cron: '0 /u);
  assert.match(workflow, /scripts\/release\/release-status\.mjs/u);
  assert.match(workflow, /Release lane drift detected/u);
  assert.match(workflow, /issues: write/u);
  assert.doesNotMatch(workflow, /uses: actions\/(checkout|setup-node)@v\d+/u);
  assert.equal(workflow.match(/persist-credentials: false/gu)?.length, 2);
});
