import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAPABILITY_MARKER,
  FORBIDDEN_CAPABILITY_MARKER,
  VSCODE_DISPLAY_NAME,
  VSCODE_NAME,
  VSCODE_PUBLISHER,
  compareSemver,
  evaluate,
  firstChangelogHeading,
  moonshotHitAllowed,
  parseSemver,
} from './check-identity-freeze.mjs';

const good = {
  vscode: {
    publisher: VSCODE_PUBLISHER,
    name: VSCODE_NAME,
    displayName: VSCODE_DISPLAY_NAME,
  },
  versions: { cli: '2.1.0', vscode: '0.9.7', desktop: '1.2.0' },
  changelogHeadings: { cli: '2.1.0', vscode: '0.9.7', desktop: '1.2.0' },
  capabilitySources: {
    'packages/kosong/src/capability.ts': `Symbol.for('${CAPABILITY_MARKER}')`,
  },
  moonshotHits: [],
};

void test('parseSemver keeps prerelease identifiers', () => {
  assert.deepEqual(parseSemver('2.1.0'), { core: [2, 1, 0], pre: null });
  assert.deepEqual(parseSemver('2.1.0-beta.1'), { core: [2, 1, 0], pre: ['beta', '1'] });
  assert.equal(parseSemver('not-a-version'), null);
});

void test('compareSemver orders stable and prerelease lines', () => {
  assert.ok(compareSemver('2.1.0', '0.43.0') > 0);
  assert.ok(compareSemver('0.43.0', '2.1.0') < 0);
  assert.equal(compareSemver('2.1.0', '2.1.0'), 0);
  assert.ok(compareSemver('2.1.0', '2.1.0-beta.1') > 0);
  assert.ok(compareSemver('2.1.0-beta.2', '2.1.0-beta.1') > 0);
  assert.ok(compareSemver('2.1.0-beta.1', '2.1.0') < 0);
  assert.equal(compareSemver('bad', '2.1.0'), null);
});

void test('firstChangelogHeading reads stable and prerelease headings', () => {
  assert.equal(firstChangelogHeading('# pkg\n\n## 2.1.0\n\n### Minor\n'), '2.1.0');
  assert.equal(firstChangelogHeading('# pkg\n\n## 2.1.0-beta.1\n\n### Minor\n'), '2.1.0-beta.1');
  assert.equal(firstChangelogHeading('# pkg\n\nno heading\n'), null);
});

void test('evaluate accepts a live Pythinker identity', () => {
  const result = evaluate(good);
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

void test('evaluate rejects a moonshot publisher and a rewound changelog', () => {
  const result = evaluate({
    ...good,
    vscode: { ...good.vscode, publisher: 'moonshot-ai' },
    changelogHeadings: { ...good.changelogHeadings, cli: '0.43.0' },
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((line) => line.includes('publisher')));
  assert.ok(result.failures.some((line) => line.includes('changelog heading 0.43.0')));
});

void test('evaluate rejects a capability marker from the reference product', () => {
  const result = evaluate({
    ...good,
    capabilitySources: {
      'packages/kosong/src/capability.ts': `Symbol.for('${FORBIDDEN_CAPABILITY_MARKER}')`,
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((line) => line.includes(FORBIDDEN_CAPABILITY_MARKER)));
});

void test('evaluate rejects a version below npm latest or below the base branch', () => {
  const npm = evaluate({ ...good, versions: { ...good.versions, cli: '0.43.0' }, npmLatest: '2.1.0' });
  assert.equal(npm.ok, false);
  assert.ok(npm.failures.some((line) => line.includes('below npm latest')));

  const base = evaluate({
    ...good,
    versions: { ...good.versions, vscode: '0.7.6' },
    baseVersions: { vscode: '0.9.7' },
  });
  assert.equal(base.ok, false);
  assert.ok(base.failures.some((line) => line.includes('rewound 0.9.7 -> 0.7.6')));

  const stableToPre = evaluate({
    ...good,
    versions: { ...good.versions, cli: '2.1.0-beta.1' },
    changelogHeadings: { ...good.changelogHeadings, cli: '2.1.0-beta.1' },
    baseVersions: { cli: '2.1.0' },
  });
  assert.equal(stableToPre.ok, false);
  assert.ok(stableToPre.failures.some((line) => line.includes('rewound 2.1.0 -> 2.1.0-beta.1')));

  const preToPre = evaluate({
    ...good,
    versions: { ...good.versions, cli: '2.1.0-beta.1' },
    changelogHeadings: { ...good.changelogHeadings, cli: '2.1.0-beta.1' },
    baseVersions: { cli: '2.1.0-beta.2' },
  });
  assert.equal(preToPre.ok, false);
  assert.ok(preToPre.failures.some((line) => line.includes('rewound 2.1.0-beta.2 -> 2.1.0-beta.1')));
});

void test('evaluate accepts a matching prerelease changelog heading', () => {
  const result = evaluate({
    ...good,
    versions: { ...good.versions, cli: '2.1.0-beta.1' },
    changelogHeadings: { ...good.changelogHeadings, cli: '2.1.0-beta.1' },
  });
  assert.equal(result.ok, true);
});

void test('moonshotHitAllowed keeps provider hosts and oauth platform files', () => {
  assert.equal(moonshotHitAllowed('apps/vscode/package.json', '"publisher": "moonshot-ai"'), false);
  assert.equal(moonshotHitAllowed('packages/oauth/src/open-platform.ts', "id: 'moonshot-ai'"), true);
  assert.equal(
    moonshotHitAllowed('packages/oauth/src/region.ts', 'https://api.moonshot.ai/v1'),
    true,
  );
  assert.equal(
    moonshotHitAllowed('apps/vscode/package.json', "name: 'moonshot-ai' https://api.moonshot.ai/v1"),
    false,
  );
});
