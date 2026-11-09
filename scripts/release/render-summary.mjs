#!/usr/bin/env node

import { appendFile } from 'node:fs/promises';

const enabled = (value) => value === 'true';
const expected = (value) => value === 'true';
const succeeded = (value) => value === 'success';
const displayResult = (value) => value === undefined || value === '' ? 'missing' : value;

function laneRow(name, isExpected, isEnabled, result, hasProvenance = false) {
  if (!isEnabled) {
    return { lane: name, expectation: 'disabled', status: 'SKIP', provenance: 'n/a', details: 'explicit opt-out', ok: true };
  }
  if (!isExpected) {
    return { lane: name, expectation: 'not expected', status: 'SKIP', provenance: 'n/a', details: 'version unchanged', ok: true };
  }
  return {
    lane: name,
    expectation: 'expected',
    status: succeeded(result) ? 'PASS' : 'FAIL',
    provenance: hasProvenance && succeeded(result) ? 'attested' : hasProvenance ? 'missing' : 'n/a',
    details: `job=${displayResult(result)}`,
    ok: succeeded(result),
  };
}

function markdownCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll(/\r?\n/gu, ' ');
}

export function createReleaseSummary(environment) {
  const cliExpected = expected(environment.CLI_EXPECTED) || expected(environment.CLI_PUBLISHED);
  const cliChecks = [
    ['publish', environment.CLI_PUBLISHED, expected(environment.CLI_PUBLISHED)],
    ['native assets', environment.NATIVE_RESULT, succeeded(environment.NATIVE_RESULT)],
  ];
  if (enabled(environment.CDN_ENABLED)) {
    cliChecks.push(
      ['CDN deploy', environment.CDN_DEPLOY_RESULT, succeeded(environment.CDN_DEPLOY_RESULT)],
      ['CDN verify', environment.CDN_VERIFY_RESULT, succeeded(environment.CDN_VERIFY_RESULT)],
    );
  }
  if (enabled(environment.BREW_ENABLED)) {
    cliChecks.push(['Homebrew', environment.BREW_RESULT, succeeded(environment.BREW_RESULT)]);
  }

  const cliOk = !cliExpected || cliChecks.every(([, , ok]) => ok);
  const cliDetails = cliExpected
    ? cliChecks.map(([name, result, ok]) => `${name}=${ok ? 'success' : displayResult(result)}`).join(', ')
    : 'version unchanged';
  const rows = [
    {
      lane: 'Orchestrator',
      expectation: 'required',
      status: succeeded(environment.RELEASE_RESULT) ? 'PASS' : 'FAIL',
      provenance: 'n/a',
      details: `job=${displayResult(environment.RELEASE_RESULT)}`,
      ok: succeeded(environment.RELEASE_RESULT),
    },
    {
      lane: 'npm CLI',
      expectation: cliExpected ? 'expected' : 'not expected',
      status: cliExpected ? (cliOk ? 'PASS' : 'FAIL') : 'SKIP',
      provenance: cliExpected ? (succeeded(environment.NATIVE_RESULT) ? 'attested' : 'missing') : 'n/a',
      details: cliDetails,
      ok: cliOk,
    },
    laneRow(
      'Desktop tag',
      expected(environment.DESKTOP_EXPECTED),
      enabled(environment.DESKTOP_ENABLED),
      environment.DESKTOP_RESULT,
    ),
    laneRow(
      'VS Code',
      expected(environment.VSCODE_EXPECTED),
      enabled(environment.VSCODE_ENABLED),
      environment.VSCODE_RESULT,
      true,
    ),
  ];
  const markdown = [
    '# Release lanes',
    '',
    '| Lane | Expectation | Status | Provenance | Details |',
    '|---|---|---|---|---|',
    ...rows.map((row) => `| ${markdownCell(row.lane)} | ${row.expectation} | ${row.status} | ${row.provenance} | ${markdownCell(row.details)} |`),
    '',
  ].join('\n');
  return { ok: rows.every((row) => row.ok), rows, markdown };
}

async function main() {
  const summary = createReleaseSummary(process.env);
  process.stdout.write(`${summary.markdown}\n`);
  if (process.env.GITHUB_STEP_SUMMARY !== undefined && process.env.GITHUB_STEP_SUMMARY !== '') {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary.markdown);
  }
  if (!summary.ok) process.exitCode = 1;
}

if (process.argv[1] === import.meta.filename) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
