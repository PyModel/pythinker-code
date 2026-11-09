import assert from 'node:assert/strict';
import test from 'node:test';

import { createReleaseSummary } from './render-summary.mjs';

const successful = {
  RELEASE_RESULT: 'success',
  CLI_EXPECTED: 'true',
  CLI_PUBLISHED: 'true',
  NATIVE_RESULT: 'success',
  CDN_ENABLED: 'true',
  CDN_DEPLOY_RESULT: 'success',
  CDN_VERIFY_RESULT: 'success',
  BREW_ENABLED: 'true',
  BREW_RESULT: 'success',
  DESKTOP_EXPECTED: 'true',
  DESKTOP_ENABLED: 'true',
  DESKTOP_RESULT: 'success',
  VSCODE_EXPECTED: 'true',
  VSCODE_ENABLED: 'true',
  VSCODE_RESULT: 'success',
};

void test('passes when every expected release lane succeeds', () => {
  const summary = createReleaseSummary(successful);
  assert.equal(summary.ok, true);
  assert.match(summary.markdown, /\| npm CLI \| expected \| PASS \| attested \|/u);
  assert.match(summary.markdown, /\| Desktop tag \| expected \| PASS \| n\/a \|/u);
  assert.match(summary.markdown, /\| VS Code \| expected \| PASS \| attested \|/u);
});

void test('fails when an expected CDN deployment fails', () => {
  const summary = createReleaseSummary({ ...successful, CDN_DEPLOY_RESULT: 'failure' });
  assert.equal(summary.ok, false);
  assert.match(summary.markdown, /CDN deploy=failure/u);
});

void test('accepts an explicit lane disable and shows it', () => {
  const summary = createReleaseSummary({
    ...successful,
    VSCODE_ENABLED: 'false',
    VSCODE_RESULT: 'skipped',
  });
  assert.equal(summary.ok, true);
  assert.match(summary.markdown, /\| VS Code \| disabled \| SKIP \| n\/a \|/u);
});
