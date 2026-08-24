/**
 * Gate: a `major` changeset needs a human decision, recorded on the pull
 * request.
 *
 * `.agents/skills/gen-changesets/SKILL.md` already says never to choose a
 * `major` bump alone — stop and get explicit approval. Nothing enforced it, so
 * a `major` could ride into `main` inside a large squash and set the next
 * release's version on its own. This turns that rule into a check: a pull
 * request that ADDS a `major` changeset fails unless it carries the approval
 * label.
 *
 * Only added files count. Editing prose in a `major` changeset that is already
 * on the base branch is not a new decision, and re-gating it would block every
 * follow-up touching the same file.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const APPROVAL_LABEL = 'breaking-change-approved';

/**
 * Read the bump levels a changeset declares.
 *
 * The frontmatter is the block between the first two `---` fences; each entry
 * reads `"package": level`. Anything outside that block is the changelog prose
 * and must not be scanned — a body that mentions the word "major" is not a
 * `major` bump.
 *
 * @param source - Raw changeset file contents.
 * @returns The declared levels, lowercased, in file order.
 */
export function parseBumpLevels(source) {
  const normalized = source.replaceAll(/\r\n/gu, '\n');
  if (!normalized.startsWith('---\n')) return [];
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) return [];
  const frontmatter = normalized.slice(4, end + 1);

  const levels = [];
  for (const line of frontmatter.split('\n')) {
    const match = /^\s*(?:"[^"]+"|'[^']+'|[^:]+)\s*:\s*([A-Za-z]+)\s*$/u.exec(line);
    if (match !== null) levels.push(match[1].toLowerCase());
  }
  return levels;
}

/** Changeset paths, ignoring the directory's own README and config. */
export function isChangesetFile(path) {
  return path.startsWith('.changeset/') && path.endsWith('.md') && !path.endsWith('/README.md');
}

/**
 * Decide whether the gate passes.
 *
 * @param input.addedFiles - Paths added by the pull request.
 * @param input.labels - Label names on the pull request.
 * @param input.readFile - Reads one path; injected so this stays pure.
 * @returns The offending changesets and whether they are approved.
 */
export function evaluate(input) {
  const majors = input.addedFiles
    .filter(isChangesetFile)
    .filter((path) => parseBumpLevels(input.readFile(path)).includes('major'));
  const approved = input.labels.includes(APPROVAL_LABEL);
  return { majors, approved, ok: majors.length === 0 || approved };
}

function selfTest() {
  const cases = [
    { name: 'major in frontmatter', source: '---\n"@pymodel/pythinker-code": major\n---\n\nDrop it.\n', expected: ['major'] },
    { name: 'minor only', source: '---\n"@pymodel/pythinker-code": minor\n---\n\nAdd it.\n', expected: ['minor'] },
    // The body can hold a `key: value` line of its own; only the frontmatter
    // declares bumps, so the boundary has to be respected, not just the words.
    { name: 'prose with a colon line', source: '---\n"a": patch\n---\n\nBreaking: major\n', expected: ['patch'] },
    { name: 'crlf frontmatter', source: '---\r\n"a": major\r\n---\r\n\r\nText.\r\n', expected: ['major'] },
    { name: 'multi package', source: '---\n"a": patch\n"b": major\n---\n\nText.\n', expected: ['patch', 'major'] },
    { name: 'no frontmatter', source: 'Just prose about a major change.\n', expected: [] },
    { name: 'unterminated frontmatter', source: '---\n"a": major\n', expected: [] },
  ];
  let failures = 0;
  for (const { name, source, expected } of cases) {
    const actual = parseBumpLevels(source);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      console.error(`self-test FAILED: ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      failures += 1;
    }
  }

  const files = { '.changeset/a.md': '---\n"a": major\n---\n\nText.\n' };
  const readFile = (path) => files[path];
  const blocked = evaluate({ addedFiles: ['.changeset/a.md'], labels: [], readFile });
  if (blocked.ok || blocked.majors.length !== 1) {
    console.error('self-test FAILED: an unlabelled major must be blocked');
    failures += 1;
  }
  const allowed = evaluate({ addedFiles: ['.changeset/a.md'], labels: [APPROVAL_LABEL], readFile });
  if (!allowed.ok) {
    console.error('self-test FAILED: a labelled major must pass');
    failures += 1;
  }
  const readmeOnly = evaluate({ addedFiles: ['.changeset/README.md'], labels: [], readFile: () => '---\n"a": major\n---\n' });
  if (!readmeOnly.ok) {
    console.error('self-test FAILED: the changeset README is not a changeset');
    failures += 1;
  }

  const labelCases = [
    { name: 'absent', raw: undefined, expected: [] },
    { name: 'empty', raw: '', expected: [] },
    { name: 'json array', raw: '["a","breaking-change-approved"]', expected: ['a', APPROVAL_LABEL] },
    { name: 'not json', raw: 'breaking-change-approved', expected: [] },
    { name: 'not an array', raw: '{"name":"x"}', expected: [] },
    { name: 'non-string members', raw: '[1,"a"]', expected: ['a'] },
  ];
  for (const { name, raw, expected } of labelCases) {
    const actual = parseLabels(raw);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      console.error(`self-test FAILED: labels ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      failures += 1;
    }
  }

  if (failures > 0) process.exit(1);
  console.log(`check-major-changeset: self-test OK (${cases.length + labelCases.length + 3} cases)`);
}

/**
 * Label names as the workflow passes them: a JSON array, so a label containing
 * a comma or a newline cannot smuggle in a second name.
 *
 * @param raw - The `PR_LABELS_JSON` value, or undefined when unset.
 * @returns The label names; empty when the value is absent or not an array.
 */
export function parseLabels(raw) {
  if (raw === undefined || raw.length === 0) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter((name) => typeof name === 'string') : [];
}

function addedFilesAgainst(baseSha) {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=A', `${baseSha}...HEAD`, '--', '.changeset'],
    { encoding: 'utf8' },
  );
  return output.split('\n').filter((line) => line.length > 0);
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  const baseSha = process.env['BASE_SHA'];
  if (baseSha === undefined || !/^[0-9a-f]{7,40}$/u.test(baseSha)) {
    console.error('check-major-changeset: BASE_SHA must be the pull request base commit.');
    process.exit(1);
  }

  const result = evaluate({
    addedFiles: addedFilesAgainst(baseSha),
    labels: parseLabels(process.env['PR_LABELS_JSON']),
    readFile: (path) => readFileSync(path, 'utf8'),
  });

  if (result.ok) {
    const note = result.majors.length === 0 ? 'no new major changeset' : 'major approved by label';
    console.log(`check-major-changeset: OK (${note})`);
    return;
  }

  console.error('check-major-changeset: FAILED');
  console.error('');
  console.error('This pull request adds a major changeset:');
  for (const path of result.majors) console.error(`  - ${path}`);
  console.error('');
  console.error('A major bump is a product decision, not a mechanical one: it renames the');
  console.error('release, breaks every pinned consumer, and cannot be walked back once');
  console.error('published. Either lower the bump to minor or patch, or have a maintainer');
  console.error(`add the "${APPROVAL_LABEL}" label to confirm the break is intended.`);
  process.exit(1);
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) {
  main();
}
