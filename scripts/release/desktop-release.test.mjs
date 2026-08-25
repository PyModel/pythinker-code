import assert from 'node:assert/strict';
import test from 'node:test';

import {
  configureDesktopPackage,
  desktopManifestName,
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
