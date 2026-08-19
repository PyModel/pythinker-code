import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { OAuthConnectionError, OAuthUnauthorizedError } from '@pymodel/pythinker-code-oauth';

import { DisposableStore, type IDisposable } from '#/_base/di/lifecycle';
import { type IAgentScopeHandle } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { createServices, type TestInstantiationService } from '#/_base/di/test';
import { Emitter } from '#/_base/event';
import { IOAuthService } from '#/app/auth/auth';
import { IFlagService } from '#/app/flag/flag';
import { IEventService } from '#/app/event/event';
import type { Event2 } from '#/app/event/event2';
import { IHostRequestHeaders } from '#/kosong/model/hostRequestHeaders';
import {
  IProviderService,
  type OAuthRef,
  type ProviderConfig,
} from '#/kosong/provider/provider';
import { ISessionContext, makeSessionContext } from '#/session/sessionContext/sessionContext';
import {
  IAgentLifecycleService,
  MAIN_AGENT_ID,
} from '#/session/agentLifecycle/agentLifecycle';
import {
  IAgentTitlePromptSource,
  type TitleDigestExcerpt,
  type TitleTurnExcerpt,
} from '#/session/sessionTitle/agentTitlePromptSource';
import { ISessionTitleService } from '#/session/sessionTitle/sessionTitle';
import { SessionTitleService } from '#/session/sessionTitle/sessionTitleService';
import {
  ISessionMetadata,
  type SessionMeta,
  type SessionMetaPatch,
  type SessionMetadataChangedEvent,
} from '#/session/sessionMetadata/sessionMetadata';
import { SessionMetaUpdated } from '#/session/sessionMetadata/sessionMetaEvents';
import '#/kosong/provider/providers/pythinker/pythinker.contrib';

import { registerLogServices } from '../../_base/log/stubs';
import { stubProviderService } from '../../app/provider/stubs';

const SESSION_ID = 'sess-1';
const MANAGED_PROVIDER: ProviderConfig = {
  type: 'pythinker',
  baseUrl: 'https://api.example.test/coding/v1',
  oauth: { storage: 'file', key: 'pythinker-code' },
};

class FakeEventService implements IEventService {
  declare readonly _serviceBrand: undefined;
  private readonly emitter = new Emitter<Event2>();
  readonly onDidPublish = this.emitter.event;
  readonly published: Event2[] = [];

  publish(event: Event2): void {
    this.published.push(event);
    this.emitter.fire(event);
  }

  subscribe(handler: (event: Event2) => void): IDisposable {
    return this.emitter.event(handler);
  }
}

class FakeSessionMetadata implements ISessionMetadata {
  declare readonly _serviceBrand: undefined;
  readonly ready = Promise.resolve();
  private readonly emitter = new Emitter<SessionMetadataChangedEvent>();
  readonly onDidChangeMetadata = this.emitter.event;
  meta: SessionMeta;

  constructor() {
    this.meta = {
      id: SESSION_ID,
      createdAt: 0,
      updatedAt: 0,
      archived: false,
    };
  }

  read(): Promise<SessionMeta> {
    return Promise.resolve(this.meta);
  }

  update(patch: SessionMetaPatch): Promise<void> {
    this.meta = { ...this.meta, ...patch };
    this.emitter.fire({ changed: Object.keys(patch) as (keyof SessionMeta)[] });
    return Promise.resolve();
  }

  setTitle(title: string): Promise<void> {
    return this.update({ title, titleKind: 'custom' });
  }

  async setGeneratedTitleIfUncustomized(
    title: string,
    opts?: { force?: boolean },
  ): Promise<boolean> {
    if (opts?.force !== true && this.meta.titleKind === 'custom') return false;
    await this.update({ title, titleKind: 'generated' });
    return true;
  }

  setArchived(archived: boolean): Promise<void> {
    return this.update({ archived });
  }

  registerAgent(): Promise<void> {
    return Promise.resolve();
  }
}

function createPendingFetch() {
  let markStarted!: () => void;
  let resolveResponse!: (response: Response) => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const response = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  return {
    fetch: async () => {
      markStarted();
      return response;
    },
    started,
    resolve: resolveResponse,
  };
}

describe('SessionTitleService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let events: FakeEventService;
  let metadata: FakeSessionMetadata;
  let providers: Record<string, ProviderConfig>;
  let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
  let tokenError: Error | undefined;
  let forceTokenError: Error | undefined;
  let resolvedOAuthRefs: Array<OAuthRef | undefined>;
  let titlePrompts: readonly string[];
  let promptSourceImpl: (limit: number) => Promise<readonly string[]>;
  let turnExcerpt: TitleTurnExcerpt;
  let digestExcerpt: TitleDigestExcerpt;
  let tokenCalls: boolean[];
  let flagEnabled: boolean;

  beforeEach(() => {
    tokenError = undefined;
    forceTokenError = undefined;
    resolvedOAuthRefs = [];
    titlePrompts = [];
    promptSourceImpl = async (limit) => titlePrompts.slice(0, limit);
    turnExcerpt = {};
    digestExcerpt = {};
    tokenCalls = [];
    flagEnabled = true;
    providers = { 'managed:pythinker-code': MANAGED_PROVIDER };
    metadata = new FakeSessionMetadata();
    events = new FakeEventService();
    fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ title: '\u751F\u6210\u7684\u6807\u9898' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    disposables = new DisposableStore();
    ix = createServices(disposables, {
      base: [registerLogServices],
      additionalServices: (reg) => {
        reg.defineInstance(
          ISessionContext,
          makeSessionContext({
            sessionId: SESSION_ID,
            workspaceId: 'ws-1',
            sessionDir: '/tmp/sess-1',
            sessionScope: 'sessions/sess-1',
            cwd: '/tmp',
          }),
        );
        reg.defineInstance(ISessionMetadata, metadata);
        const promptSource: IAgentTitlePromptSource = {
          _serviceBrand: undefined,
          firstUserPrompts: (limit) => promptSourceImpl(limit),
          firstTurnExcerpt: async () => turnExcerpt,
          digestExcerpt: async () => digestExcerpt,
        };
        const mainAgent: IAgentScopeHandle = {
          id: MAIN_AGENT_ID,
          kind: LifecycleScope.Agent,
          accessor: { get: <T>() => promptSource as T },
          dispose: () => undefined,
        };
        reg.definePartialInstance(IAgentLifecycleService, {
          get: () => mainAgent,
        });
        reg.defineInstance(IEventService, events);
        reg.defineInstance(IProviderService, stubProviderService(providers));
        reg.definePartialInstance(IOAuthService, {
          resolveTokenProvider: (_provider, oauthRef) => {
            resolvedOAuthRefs.push(oauthRef);
            return {
              getAccessToken: async (options) => {
                tokenCalls.push(options?.force === true);
                if (tokenError !== undefined) throw tokenError;
                if (options?.force === true && forceTokenError !== undefined) {
                  throw forceTokenError;
                }
                return 'test-token';
              },
            };
          },
        });
        reg.defineInstance(IHostRequestHeaders, {
          headers: { 'User-Agent': 'test' },
          thirdPartyHeaders: {},
        });
        reg.definePartialInstance(IFlagService, { enabled: () => flagEnabled });
        reg.define(ISessionTitleService, SessionTitleService);
      },
    });
    ix.get(ISessionTitleService);
  });

  afterEach(() => {
    disposables.dispose();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('is unavailable while the experimental auto_session_title flag is off', async () => {
    flagEnabled = false;
    titlePrompts = ['hello'];

    await expect(ix.get(ISessionTitleService).generateTitle()).resolves.toBeUndefined();
    await expect(
      ix.get(ISessionTitleService).generateTitle({ force: true, source: 'digest' }),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('replaces the easy title with the generated one', async () => {
    titlePrompts = ['\u5E2E\u6211\u770B\u4E00\u4E0B\u8FD9\u4E2A Go \u7684 nil pointer \u62A5\u9519'];

    const title = await ix.get(ISessionTitleService).generateTitle();

    expect(title).toBe('\u751F\u6210\u7684\u6807\u9898');
    expect(metadata.meta.title).toBe('\u751F\u6210\u7684\u6807\u9898');
    expect(metadata.meta.titleKind).toBe('generated');

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init?.body as string)).toEqual({
      method: 'chat_title',
      params: { chat_content: 'user: \u5E2E\u6211\u770B\u4E00\u4E0B\u8FD9\u4E2A Go \u7684 nil pointer \u62A5\u9519' },
    });
    expect(new Headers(init?.headers as Record<string, string>).get('authorization')).toBe(
      'Bearer test-token',
    );

    const rebroadcast = events.published.find(
      (event): event is SessionMetaUpdated =>
        event.type === 'session.meta.updated' &&
        (event as SessionMetaUpdated).payload.patch.title === '\u751F\u6210\u7684\u6807\u9898',
    );
    expect(rebroadcast).toBeDefined();
  });

  it('composes the title input from the recorded prompts in order', async () => {
    titlePrompts = ['\u5148\u5E2E\u6211\u642D\u4E00\u4E2A Vite \u9879\u76EE', '\u52A0\u4E0A\u8DEF\u7531', '\u73B0\u5728\u914D\u4E00\u4E0B ESLint'];

    await ix.get(ISessionTitleService).generateTitle();

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init?.body as string)).toEqual({
      method: 'chat_title',
      params: {
        chat_content: 'user: \u5148\u5E2E\u6211\u642D\u4E00\u4E2A Vite \u9879\u76EE\nuser: \u52A0\u4E0A\u8DEF\u7531\nuser: \u73B0\u5728\u914D\u4E00\u4E0B ESLint',
      },
    });
  });

  it('truncates the composed title input to the total budget, keeping the head', async () => {
    titlePrompts = ['\u5F88\u957F\u7684\u8F93\u5165'.repeat(400), '\u7B2C\u4E8C\u6761'];

    await ix.get(ISessionTitleService).generateTitle();

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init?.body as string) as { params: { chat_content: string } };
    expect(body.params.chat_content.startsWith('user: \u5F88\u957F\u7684\u8F93\u5165')).toBe(true);
    expect(body.params.chat_content).toHaveLength(1000);
  });

  it('returns unavailable when only a slash activation updated lastPrompt', async () => {
    await metadata.update({ lastPrompt: '/compact' });

    await expect(ix.get(ISessionTitleService).generateTitle()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing without a managed OAuth provider', async () => {
    delete providers['managed:pythinker-code'];
    titlePrompts = ['hello'];

    await expect(ix.get(ISessionTitleService).generateTitle()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never overwrites a custom title set while generation is in flight', async () => {
    const pendingFetch = createPendingFetch();
    fetchMock.mockImplementationOnce(pendingFetch.fetch);

    titlePrompts = ['hello'];
    const generation = ix.get(ISessionTitleService).generateTitle();
    await pendingFetch.started;
    await metadata.setTitle('user \u53D6\u7684\u6807\u9898');
    pendingFetch.resolve(
      new Response(JSON.stringify({ title: '\u751F\u6210\u7684\u6807\u9898' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(generation).resolves.toBeUndefined();
    expect(metadata.meta.title).toBe('user \u53D6\u7684\u6807\u9898');
    expect(metadata.meta.titleKind).toBe('custom');
  });

  it('skips generation when the current title was already generated', async () => {
    await metadata.setGeneratedTitleIfUncustomized('\u5DF2\u751F\u6210\u7684\u6807\u9898');
    titlePrompts = ['hello'];

    await expect(ix.get(ISessionTitleService).generateTitle()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(metadata.meta.title).toBe('\u5DF2\u751F\u6210\u7684\u6807\u9898');
  });

  it('force regenerates an already-generated title', async () => {
    await metadata.setGeneratedTitleIfUncustomized('\u5DF2\u751F\u6210\u7684\u6807\u9898');
    titlePrompts = ['hello'];

    await expect(
      ix.get(ISessionTitleService).generateTitle({ force: true }),
    ).resolves.toBe('\u751F\u6210\u7684\u6807\u9898');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(metadata.meta.title).toBe('\u751F\u6210\u7684\u6807\u9898');
    expect(metadata.meta.titleKind).toBe('generated');
  });

  it('force overwrites a custom title and drops its custom marking', async () => {
    await metadata.setTitle('user \u53D6\u7684\u6807\u9898');
    titlePrompts = ['hello'];

    await expect(
      ix.get(ISessionTitleService).generateTitle({ force: true }),
    ).resolves.toBe('\u751F\u6210\u7684\u6807\u9898');
    expect(metadata.meta.title).toBe('\u751F\u6210\u7684\u6807\u9898');
    expect(metadata.meta.titleKind).toBe('generated');
  });

  it('force still degrades when the backend request fails', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 500 }));
    await metadata.setTitle('user \u53D6\u7684\u6807\u9898');
    titlePrompts = ['hello'];

    await expect(
      ix.get(ISessionTitleService).generateTitle({ force: true }),
    ).resolves.toBeUndefined();
    expect(metadata.meta.title).toBe('user \u53D6\u7684\u6807\u9898');
    expect(metadata.meta.titleKind).toBe('custom');
  });

  it('first_turn composes the opening prompt with the first reply, within budget', async () => {
    turnExcerpt = { user: '\u6700\u521D\u7684\u95EE\u9898', assistant: '\u7B2C\u4E00\u8F6E\u7684\u56DE\u7B54' };

    await expect(
      ix.get(ISessionTitleService).generateTitle({ source: 'first_turn' }),
    ).resolves.toBe('\u751F\u6210\u7684\u6807\u9898');

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init?.body as string)).toEqual({
      method: 'chat_title',
      params: { chat_content: 'user: \u6700\u521D\u7684\u95EE\u9898\nassistant: \u7B2C\u4E00\u8F6E\u7684\u56DE\u7B54' },
    });
  });

  it('first_turn is strict: no assistant reply yet means unavailable', async () => {
    turnExcerpt = { user: '\u53EA\u6709\u95EE\u9898' };

    await expect(
      ix.get(ISessionTitleService).generateTitle({ source: 'first_turn' }),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('first_turn truncates each segment to its budget', async () => {
    turnExcerpt = { user: '\u95EE'.repeat(500), assistant: '\u7B54'.repeat(1000) };

    await expect(
      ix.get(ISessionTitleService).generateTitle({ source: 'first_turn' }),
    ).resolves.toBe('\u751F\u6210\u7684\u6807\u9898');

    const [, init] = fetchMock.mock.calls[0]!;
    const content = (JSON.parse(init?.body as string) as { params: { chat_content: string } })
      .params.chat_content;
    expect(content).toBe(`user: ${'\u95EE'.repeat(300)}\nassistant: ${'\u7B54'.repeat(600)}`);
  });

  it('digest composes head and tail segments, tolerating a missing reply', async () => {
    digestExcerpt = { firstUser: '\u5F00\u573A', lastUser: '\u6700\u65B0\u8FFD\u95EE', assistant: '\u5F53\u524D\u8FDB\u5C55' };

    await expect(
      ix.get(ISessionTitleService).generateTitle({ source: 'digest' }),
    ).resolves.toBe('\u751F\u6210\u7684\u6807\u9898');

    let [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init?.body as string)).toEqual({
      method: 'chat_title',
      params: { chat_content: 'user: \u5F00\u573A\nuser: \u6700\u65B0\u8FFD\u95EE\nassistant: \u5F53\u524D\u8FDB\u5C55' },
    });

    fetchMock.mockClear();
    digestExcerpt = { firstUser: '\u5F00\u573A' };
    await expect(
      ix.get(ISessionTitleService).generateTitle({ force: true, source: 'digest' }),
    ).resolves.toBe('\u751F\u6210\u7684\u6807\u9898');
    [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init?.body as string)).toEqual({
      method: 'chat_title',
      params: { chat_content: 'user: \u5F00\u573A' },
    });
  });

  it('digest is unavailable when the window yields no segments at all', async () => {
    digestExcerpt = {};

    await expect(
      ix.get(ISessionTitleService).generateTitle({ source: 'digest' }),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the current title when the backend request fails', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 500 }));
    titlePrompts = ['hello'];
    await metadata.update({ title: 'hello', titleKind: 'replaceable' });

    await expect(ix.get(ISessionTitleService).generateTitle()).resolves.toBeUndefined();
    expect(metadata.meta.title).toBe('hello');
    expect(tokenCalls).toEqual([false]);
  });

  it('retries once with a force-refreshed token on a 401', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 401 }));
    titlePrompts = ['hello'];

    await expect(ix.get(ISessionTitleService).generateTitle()).resolves.toBe('\u751F\u6210\u7684\u6807\u9898');
    expect(metadata.meta.title).toBe('\u751F\u6210\u7684\u6807\u9898');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(tokenCalls).toEqual([false, true]);
  });

  it('gives up when the 401 persists after the force refresh', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 401 }));
    titlePrompts = ['hello'];

    await expect(ix.get(ISessionTitleService).generateTitle()).resolves.toBeUndefined();
    expect(metadata.meta.title).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(tokenCalls).toEqual([false, true]);
  });

  it('degrades when the force refresh after a 401 fails', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 401 }));
    forceTokenError = new OAuthUnauthorizedError('refresh rejected');
    titlePrompts = ['hello'];

    await expect(ix.get(ISessionTitleService).generateTitle()).resolves.toBeUndefined();
    expect(metadata.meta.title).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tokenCalls).toEqual([false, true]);
  });

  it('returns unavailable when the OAuth token is missing or revoked', async () => {
    tokenError = new OAuthUnauthorizedError('re-login required');
    titlePrompts = ['hello'];

    const svc = ix.get(ISessionTitleService);
    await expect(svc.generateTitle()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns unavailable when OAuth token retrieval has an operational failure', async () => {
    tokenError = new OAuthConnectionError('connection failed');
    titlePrompts = ['hello'];

    await expect(ix.get(ISessionTitleService).generateTitle()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propagates unexpected token provider failures', async () => {
    tokenError = new Error('unexpected failure');
    titlePrompts = ['hello'];

    await expect(ix.get(ISessionTitleService).generateTitle()).rejects.toThrow(
      'unexpected failure',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('includes environment custom headers', async () => {
    vi.stubEnv('PYTHINKER_CODE_CUSTOM_HEADERS', 'X-Proxy-Header: from-env\n');
    titlePrompts = ['hello'];

    await ix.get(ISessionTitleService).generateTitle();

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers as Record<string, string>);
    expect(headers.get('x-proxy-header')).toBe('from-env');
    expect(headers.get('user-agent')).toBe('test');
  });

  it('pairs the environment endpoint with its credential slot when it overrides persisted config', async () => {
    vi.stubEnv('PYTHINKER_CODE_BASE_URL', 'https://api.env.example.test/coding/v1');
    vi.stubEnv('PYTHINKER_CODE_OAUTH_HOST', 'https://auth.env.example.test');
    titlePrompts = ['hello'];

    await ix.get(ISessionTitleService).generateTitle();

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.env.example.test/coding/v1/tools');
    expect(resolvedOAuthRefs[0]).toMatchObject({
      storage: 'file',
      oauthHost: 'https://auth.env.example.test',
    });
    expect(resolvedOAuthRefs[0]?.key).not.toBe(MANAGED_PROVIDER.oauth?.key);
  });

  it('shares an in-flight generation between concurrent requests', async () => {
    const pendingFetch = createPendingFetch();
    fetchMock.mockImplementationOnce(pendingFetch.fetch);

    titlePrompts = ['hello'];
    const first = ix.get(ISessionTitleService).generateTitle();
    const second = ix.get(ISessionTitleService).generateTitle();
    await pendingFetch.started;

    pendingFetch.resolve(
      new Response(JSON.stringify({ title: '\u751F\u6210\u7684\u6807\u9898' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(first).resolves.toBe('\u751F\u6210\u7684\u6807\u9898');
    await expect(second).resolves.toBe('\u751F\u6210\u7684\u6807\u9898');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns unavailable without calling the backend when no prompt was seen', async () => {
    await expect(ix.get(ISessionTitleService).generateTitle()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
