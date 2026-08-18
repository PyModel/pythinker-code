/**
 * `CapabilityService` — registry semantics, readiness computation, and
 * install orchestration (progress transitions, serialized runs, coded
 * errors). Entries are fakes; entry internals are covered per-entry.
 */

import { describe, expect, it } from 'vitest';

import { isError2 } from '#/_base/errors/errors';
import { CapabilityErrors } from '#/app/capability/errors';
import { CapabilityService } from '#/app/capability/capabilityService';
import type {
  CapabilityDetectResult,
  CapabilityEntry,
  CapabilityInstallReporter,
} from '#/app/capability/types';

function fakeEntry(overrides: {
  id: 'pythinker-cu' | 'pythinker-webbridge';
  supported?: boolean;
  detect?: CapabilityDetectResult;
  install?: (report: CapabilityInstallReporter) => Promise<void>;
}): CapabilityEntry {
  return {
    id: overrides.id,
    displayName: overrides.id,
    description: 'fake',
    supported: overrides.supported ?? true,
    detect: () =>
      Promise.resolve(
        overrides.detect ?? { steps: [{ id: 'plugin', state: 'ok' }] },
      ),
    install: overrides.install ?? (() => Promise.resolve()),
  };
}

function fakeService(entries: readonly CapabilityEntry[]): CapabilityService {
  // bootstrap / hostProcess are unused when entries are injected.
  return new CapabilityService(
    undefined as never,
    undefined as never,
    undefined as never,
    entries,
  );
}

function expectErrorCode(error: unknown, code: string): void {
  expect(isError2(error)).toBe(true);
  expect((error as { code: string }).code).toBe(code);
}

describe('CapabilityService', () => {
  it('lists entries with readiness computed from required steps', async () => {
    const service = fakeService([
      fakeEntry({ id: 'pythinker-cu', detect: { steps: [{ id: 'plugin', state: 'ok' }] } }),
      fakeEntry({
        id: 'pythinker-webbridge',
        detect: {
          steps: [
            { id: 'daemon', state: 'ok' },
            { id: 'skill', state: 'missing' },
            { id: 'extension', state: 'missing', optional: true },
          ],
        },
      }),
    ]);
    const list = await service.listCapabilities();
    expect(list.map((c) => [c.id, c.state])).toEqual([
      ['pythinker-cu', 'ready'],
      ['pythinker-webbridge', 'partial'],
    ]);
  });

  it('isolates a failing detector to its own entry', async () => {
    const broken: CapabilityEntry = {
      id: 'pythinker-cu',
      displayName: 'pythinker-cu',
      description: 'fake',
      supported: true,
      detect: () => Promise.reject(new Error('probe timed out')),
      install: () => Promise.resolve(),
    };
    const service = fakeService([
      broken,
      fakeEntry({ id: 'pythinker-webbridge', detect: { steps: [{ id: 'daemon', state: 'ok' }] } }),
    ]);

    // One entry's broken probe must not take down the whole list.
    const list = await service.listCapabilities();
    expect(list.find((c) => c.id === 'pythinker-webbridge')?.state).toBe('ready');
    const cu = list.find((c) => c.id === 'pythinker-cu');
    expect(cu?.state).toBe('partial');
    expect(cu?.steps).toEqual([{ id: 'detect', state: 'failed', detail: 'probe timed out' }]);
  });

  it('marks optional steps as non-blocking for ready', async () => {
    const service = fakeService([
      fakeEntry({
        id: 'pythinker-webbridge',
        detect: {
          version: 'v1.11.3',
          steps: [
            { id: 'daemon', state: 'ok' },
            { id: 'extension', state: 'missing', optional: true },
          ],
        },
      }),
    ]);
    const status = await service.getCapability('pythinker-webbridge');
    expect(status.state).toBe('ready');
    expect(status.version).toBe('v1.11.3');
  });

  it('reports not_installed when no step is ok, and unsupported as-is', async () => {
    const service = fakeService([
      fakeEntry({ id: 'pythinker-cu', detect: { steps: [{ id: 'plugin', state: 'missing' }] } }),
      fakeEntry({ id: 'pythinker-webbridge', supported: false }),
    ]);
    const list = await service.listCapabilities();
    expect(list.find((c) => c.id === 'pythinker-cu')?.state).toBe('not_installed');
    const unsupported = list.find((c) => c.id === 'pythinker-webbridge');
    expect(unsupported?.state).toBe('unsupported');
    expect(unsupported?.supported).toBe(false);
  });

  it('throws capability.not_found for unknown ids', async () => {
    const service = fakeService([]);
    await service.getCapability('nope').then(
      () => {
        expect.unreachable();
      },
      (error) => {
        expectErrorCode(error, CapabilityErrors.codes.CAPABILITY_NOT_FOUND);
      },
    );
    await service.installCapability('nope').then(
      () => {
        expect.unreachable();
      },
      (error) => {
        expectErrorCode(error, CapabilityErrors.codes.CAPABILITY_NOT_FOUND);
      },
    );
  });

  it('rejects install on an unsupported entry', async () => {
    const service = fakeService([fakeEntry({ id: 'pythinker-cu', supported: false })]);
    await service.installCapability('pythinker-cu').then(
      () => {
        expect.unreachable();
      },
      (error) => {
        expectErrorCode(error, CapabilityErrors.codes.CAPABILITY_UNSUPPORTED);
      },
    );
  });

  it('serializes installs and clears progress on success', async () => {
    let release: (() => void) | undefined;
    const service = fakeService([
      fakeEntry({
        id: 'pythinker-cu',
        install: (report) => {
          report('download', 42);
          return new Promise<void>((resolve) => {
            release = () => {
              resolve();
            };
          });
        },
      }),
    ]);

    const started = await service.installCapability('pythinker-cu');
    expect(started.install.running).toBe(true);

    await service.installCapability('pythinker-cu').then(
      () => {
        expect.unreachable();
      },
      (error) => {
        expectErrorCode(error, CapabilityErrors.codes.CAPABILITY_INSTALL_IN_PROGRESS);
      },
    );

    const during = await service.getCapability('pythinker-cu');
    expect(during.install).toEqual({ running: true, step: 'download', percent: 42 });

    release?.();
    // Wait for the background install to settle.
    for (let i = 0; i < 50; i += 1) {
      const status = await service.getCapability('pythinker-cu');
      if (!status.install.running) {
        expect(status.install.error).toBeUndefined();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect.unreachable('install never settled');
  });

  it('surfaces install errors through progress until the next attempt', async () => {
    let attempts = 0;
    const service = fakeService([
      fakeEntry({
        id: 'pythinker-cu',
        install: () => {
          attempts += 1;
          return attempts === 1
            ? Promise.reject(new Error('boom'))
            : Promise.resolve();
        },
      }),
    ]);
    await service.installCapability('pythinker-cu');
    for (let i = 0; i < 50; i += 1) {
      const status = await service.getCapability('pythinker-cu');
      if (!status.install.running) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const failed = await service.getCapability('pythinker-cu');
    expect(failed.install).toEqual({ running: false, error: 'boom' });

    // Retry clears the error.
    await service.installCapability('pythinker-cu');
    for (let i = 0; i < 50; i += 1) {
      const status = await service.getCapability('pythinker-cu');
      if (!status.install.running) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const retried = await service.getCapability('pythinker-cu');
    expect(retried.install.error).toBeUndefined();
    expect(attempts).toBe(2);
  });
});
