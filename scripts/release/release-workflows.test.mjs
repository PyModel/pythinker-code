import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

void test('release workflow uses full push-boundary lane signals and isolated jobs', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /github\.event\.before/u);
  assert.match(workflow, /pythinker_native_release:.*cli_version_bumped/u);
  assert.match(workflow, /^  cut-desktop-tag:/mu);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/vscode-release\.yml/u);
  assert.match(workflow, /^  release-summary:/mu);
  assert.doesNotMatch(workflow, /HEAD\^:apps\/vscode\/package\.json/u);
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
  assert.match(manualWorkflow, /id-token: write/u);
  assert.match(manualWorkflow, /attestations: write/u);
  assert.match(manualWorkflow, /artifact-metadata: write/u);
});

void test('nightly reconciliation maintains one release drift issue', () => {
  const workflow = read('.github/workflows/nightly.yml');
  assert.match(workflow, /scripts\/release\/release-status\.mjs/u);
  assert.match(workflow, /Release lane drift detected/u);
  assert.match(workflow, /issues: write/u);
  assert.doesNotMatch(workflow, /uses: actions\/(checkout|setup-node)@v\d+/u);
});
