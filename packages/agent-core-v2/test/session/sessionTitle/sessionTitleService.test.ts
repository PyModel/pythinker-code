import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { DisposableStore } from '#/_base/di/lifecycle';
import { createServices, type TestInstantiationService } from '#/_base/di/test';
import { registerLogServices } from '../../_base/log/stubs';
import { IFlagService } from '#/app/flag/flag';
import { ISessionMetadata, type SessionMeta } from '#/session/sessionMetadata/sessionMetadata';
import { AUTO_SESSION_TITLE_FLAG_ID } from '#/session/sessionTitle/flag';
import { SessionTitleService } from '#/session/sessionTitle/sessionTitleService';

function meta(titleKind: SessionMeta['titleKind']): SessionMeta {
  return {
    id: 'sess-1',
    createdAt: 0,
    updatedAt: 0,
    archived: false,
    titleKind,
  } as SessionMeta;
}

describe('SessionTitleService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let read: Mock<() => Promise<SessionMeta>>;
  let enabled: Mock<(id: string) => boolean>;

  beforeEach(() => {
    read = vi.fn(async () => meta('replaceable'));
    enabled = vi.fn((id: string) => id === AUTO_SESSION_TITLE_FLAG_ID);

    disposables = new DisposableStore();
    ix = createServices(disposables, {
      base: [registerLogServices],
      additionalServices: (reg) => {
        reg.definePartialInstance(ISessionMetadata, { read });
        reg.definePartialInstance(IFlagService, { enabled });
      },
    });
  });

  afterEach(() => {
    disposables.dispose();
    vi.restoreAllMocks();
  });

  function makeService(): SessionTitleService {
    return ix.createInstance(SessionTitleService);
  }

  it('reports generation unavailable: no hosted title endpoint is used', async () => {
    await expect(makeService().generateTitle()).resolves.toBeUndefined();
  });

  it('short-circuits before reading metadata when the flag is off', async () => {
    enabled.mockReturnValue(false);
    await expect(makeService().generateTitle()).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it('never overwrites a custom title', async () => {
    read.mockResolvedValue(meta('custom'));
    await expect(makeService().generateTitle()).resolves.toBeUndefined();
  });

  it('never regenerates over an already-generated title', async () => {
    read.mockResolvedValue(meta('generated'));
    await expect(makeService().generateTitle()).resolves.toBeUndefined();
  });

  it('skips the metadata guards when forced, and still reports unavailable', async () => {
    await expect(makeService().generateTitle({ force: true })).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });
});
