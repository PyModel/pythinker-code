import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { linkDesktop, linkDesktopChangesets } from './link-desktop-changesets.mjs';

const cliOnly = '---\n"@pymodel/pythinker-code": minor\n---\n\nAdd panel tabs.\n';

void test('adds the desktop package at the CLI bump level', () => {
  assert.equal(
    linkDesktop(cliOnly),
    '---\n"@pymodel/pythinker-code": minor\n"@pymodel/pythinker-desktop": minor\n---\n\nAdd panel tabs.\n',
  );
});

void test('leaves a changeset that already names desktop alone', () => {
  const both = '---\n"@pymodel/pythinker-desktop": patch\n"@pymodel/pythinker-code": patch\n---\n\nx\n';
  assert.equal(linkDesktop(both), null);
  assert.equal(linkDesktop(linkDesktop(cliOnly)), null);
});

void test('ignores changesets that do not name the CLI', () => {
  assert.equal(linkDesktop('---\n"@pymodel/klient": patch\n---\n\nx\n'), null);
  assert.equal(linkDesktop('no frontmatter\n'), null);
});

void test('keeps other packages and the prose intact', () => {
  const source = '---\n"@pymodel/klient": patch\n"@pymodel/pythinker-code": patch\n---\n\nBody mentions "@pymodel/pythinker-desktop": major but that is prose.\n';
  const next = linkDesktop(source);
  assert.equal(
    next,
    '---\n"@pymodel/klient": patch\n"@pymodel/pythinker-code": patch\n"@pymodel/pythinker-desktop": patch\n---\n\nBody mentions "@pymodel/pythinker-desktop": major but that is prose.\n',
  );
});

void test('rewrites only the changesets that need it and is idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'changesets-'));
  writeFileSync(join(dir, 'README.md'), '---\n"@pymodel/pythinker-code": patch\n---\n');
  writeFileSync(join(dir, 'config.json'), '{}');
  writeFileSync(join(dir, 'a.md'), cliOnly);
  writeFileSync(join(dir, 'b.md'), '---\n"@pymodel/klient": patch\n---\n\nx\n');
  assert.deepEqual(linkDesktopChangesets(dir), ['a.md']);
  assert.match(readFileSync(join(dir, 'a.md'), 'utf8'), /pythinker-desktop": minor/u);
  assert.deepEqual(linkDesktopChangesets(dir), []);
  assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), '---\n"@pymodel/pythinker-code": patch\n---\n');
});
