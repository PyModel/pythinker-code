import assert from 'node:assert/strict';
import test from 'node:test';

import {
  configureDesktopPackage,
  desktopManifestName,
  desktopReleaseNotes,
  nightlyDesktopVersion,
  resolveDesktopRelease,
} from '../../apps/desktop/scripts/desktop-release.mjs';

const desktopPackage = {
  version: '0.2.1',
  build: {
    publish: [{
      provider: 'github',
      owner: 'PyModel',
      repo: 'pythinker-desktop-releases',
      releaseType: 'release',
    }],
  },
};

void test('resolves reviewed Stable and Beta tags without rewriting their versions', () => {
  assert.deepEqual(resolveDesktopRelease({
    eventName: 'push',
    packageVersion: '0.2.2',
    tagName: 'desktop-v0.2.2',
    commitCount: '4100',
  }), {
    channel: 'stable',
    feedChannel: 'latest',
    macManifest: 'latest-mac.yml',
    prerelease: false,
    publish: true,
    releaseTag: 'v0.2.2',
    version: '0.2.2',
    winManifest: 'latest.yml',
  });
  assert.equal(resolveDesktopRelease({
    eventName: 'push',
    packageVersion: '0.3.0-beta.2',
    tagName: 'desktop-v0.3.0-beta.2',
    commitCount: '4101',
  }).channel, 'beta');
});

void test('derives one ordered Nightly version from each main commit', () => {
  assert.equal(nightlyDesktopVersion('0.2.1', '4102'), '0.2.2-nightly.4102');
  assert.equal(nightlyDesktopVersion('0.3.0-beta.2', '4103'), '0.3.0-nightly.4103');
  assert.deepEqual(resolveDesktopRelease({
    eventName: 'workflow_call',
    packageVersion: '0.2.1',
    commitCount: '4102',
    publishNightly: true,
  }), {
    channel: 'nightly',
    feedChannel: 'nightly',
    macManifest: 'nightly-mac.yml',
    prerelease: true,
    publish: true,
    releaseTag: 'v0.2.2-nightly.4102',
    version: '0.2.2-nightly.4102',
    winManifest: 'nightly.yml',
  });
});

void test('keeps manual channel runs non-publishing rehearsals', () => {
  const beta = resolveDesktopRelease({
    eventName: 'workflow_dispatch',
    packageVersion: '0.2.1',
    requestedChannel: 'beta',
    commitCount: '4102',
  });

  assert.equal(beta.version, '0.2.2-beta.4102');
  assert.equal(beta.publish, false);
  assert.equal(beta.prerelease, true);
});

void test('configures the package and manifest names for each feed', () => {
  const configured = configureDesktopPackage(desktopPackage, '0.2.2-nightly.4102', 'nightly');

  assert.equal(configured.version, '0.2.2-nightly.4102');
  assert.deepEqual(configured.build.publish[0], {
    provider: 'github',
    owner: 'PyModel',
    repo: 'pythinker-desktop-releases',
    releaseType: 'prerelease',
    channel: 'nightly',
  });
  assert.equal(desktopManifestName('stable', 'mac'), 'latest-mac.yml');
  assert.equal(desktopManifestName('beta', 'win'), 'beta.yml');
});

void test('rejects mismatched tags and unsupported prerelease channels', () => {
  assert.throws(() => resolveDesktopRelease({
    eventName: 'push',
    packageVersion: '0.2.2',
    tagName: 'desktop-v9.9.9',
    commitCount: '4102',
  }), /does not match/u);
  assert.throws(() => resolveDesktopRelease({
    eventName: 'push',
    packageVersion: '0.3.0-rc.1',
    tagName: 'desktop-v0.3.0-rc.1',
    commitCount: '4102',
  }), /Unsupported desktop release channel/u);
  assert.throws(() => resolveDesktopRelease({
    eventName: 'push',
    packageVersion: '0.2.2-nightly.4102',
    tagName: 'desktop-v0.2.2-nightly.4102',
    commitCount: '4102',
  }), /scheduled workflow/u);
  assert.throws(() => resolveDesktopRelease({
    eventName: 'workflow_call',
    packageVersion: '0.2.1',
    commitCount: '4102',
    publishNightly: false,
  }), /explicit Nightly publishing permission/u);
});

const changelog = [
  '# @pymodel/pythinker-desktop',
  '',
  '## 0.3.8',
  '',
  '### Patch Changes',
  '',
  '- [#225](https://example.com/pull/225) [`f27686a`](https://example.com/commit/f27686a) Thanks [@someone](https://example.com/someone)! - Install Windows updates in the background.',
  '- [#226](https://example.com/pull/226) Thanks [@someone](https://example.com/someone)! - Report an update that did not take effect.',
  '',
  '## 0.3.1',
  '',
  '- [#190](https://example.com/pull/190) Thanks [@someone](https://example.com/someone)! - Restore downloadable desktop releases.',
  '',
].join('\n');

void test('release notes carry the changelog entries without changesets attribution', () => {
  assert.equal(
    desktopReleaseNotes({
      changelog,
      version: '0.3.8',
      channel: 'stable',
      sourceUrl: 'https://example.com/commit/f27686a',
    }),
    [
      '- Install Windows updates in the background.',
      '- Report an update that did not take effect.',
      '',
      '---',
      '',
      'Built from https://example.com/commit/f27686a.',
      '',
    ].join('\n'),
  );
});

void test('release notes stop at the next version heading', () => {
  const notes = desktopReleaseNotes({
    changelog,
    version: '0.3.1',
    channel: 'stable',
    sourceUrl: 'https://example.com/commit/f27686a',
  });
  assert.match(notes, /Restore downloadable desktop releases\./u);
  assert.doesNotMatch(notes, /Install Windows updates/u);
});

void test('a stable release without a changelog entry fails instead of shipping', () => {
  assert.throws(() => desktopReleaseNotes({
    changelog,
    version: '0.4.0',
    channel: 'stable',
    sourceUrl: 'https://example.com/commit/f27686a',
  }), /no entries for 0\.4\.0/u);
});

void test('a preview channel without a changelog entry still describes itself', () => {
  assert.equal(
    desktopReleaseNotes({
      changelog,
      version: '0.4.0-nightly.4200',
      channel: 'nightly',
      sourceUrl: 'https://example.com/commit/f27686a',
    }),
    '- Preview build of the nightly channel.\n\n---\n\nBuilt from https://example.com/commit/f27686a.\n',
  );
});

void test('release notes require the source commit URL the resume check reads', () => {
  assert.throws(() => desktopReleaseNotes({
    changelog,
    version: '0.3.8',
    channel: 'stable',
    sourceUrl: '',
  }), /source commit URL/u);
});
