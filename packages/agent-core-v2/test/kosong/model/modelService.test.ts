import { describe, expect, it } from 'vitest';

import { modelsFromToml, modelsToToml } from '#/app/kosongConfig/configSection';
import { type ProviderConfig, IProviderService } from '#/kosong/provider/provider';
import { IEventService } from '#/app/event/event';
import { ConfigWarning } from '#/app/config/configEvents';
import { type ModelRecord } from '#/kosong/model/model';
import { ModelService } from '#/kosong/model/modelService';

describe('models TOML transforms', () => {
  it('converts snake_case entries to camelCase and back', () => {
    const from = modelsFromToml({
      k1: {
        provider: 'pymodel',
        model: 'kimi-k2',
        max_context_size: 262144,
        max_output_size: 8192,
        display_name: 'K2',
        reasoning_key: 'reasoning_content',
        adaptive_thinking: true,
        beta_api: true,
        support_efforts: ['low', 'high'],
        default_effort: 'high',
        overrides: { max_output_size: 4096, default_effort: 'low' },
      },
    }) as Record<string, Record<string, unknown>>;
    expect(from['k1']).toEqual({
      provider: 'pymodel',
      model: 'kimi-k2',
      maxContextSize: 262144,
      maxOutputSize: 8192,
      displayName: 'K2',
      reasoningKey: 'reasoning_content',
      adaptiveThinking: true,
      betaApi: true,
      supportEfforts: ['low', 'high'],
      defaultEffort: 'high',
      overrides: { maxOutputSize: 4096, defaultEffort: 'low' },
    });

    const back = modelsToToml(from, undefined) as Record<string, Record<string, unknown>>;
    expect(back['k1']).toEqual({
      provider: 'pymodel',
      model: 'kimi-k2',
      max_context_size: 262144,
      max_output_size: 8192,
      display_name: 'K2',
      reasoning_key: 'reasoning_content',
      adaptive_thinking: true,
      beta_api: true,
      support_efforts: ['low', 'high'],
      default_effort: 'high',
      overrides: { max_output_size: 4096, default_effort: 'low' },
    });
  });
});

describe('ModelService', () => {
  function stubProviders(
    providers: Record<string, ProviderConfig> = { pymodel: { type: 'openai', apiKey: 'k' } },
  ): IProviderService {
    return {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChangeProviders: () => ({ dispose: () => {} }),
      onDidChangeDefaultProvider: () => ({ dispose: () => {} }),
      get: (name) => providers[name],
      list: () => providers,
      getDefaultProvider: () => undefined,
      set: async () => {},
      delete: async () => {},
      loadAll: () => {},
      replaceAll: async () => {},
      setDefaultProvider: async () => {},
    };
  }

  function stubEvents(): IEventService {
    return {
      _serviceBrand: undefined,
      onDidPublish: undefined,
      publish: () => {},
      subscribe: () => ({ dispose: () => {} }),
    } as unknown as IEventService;
  }

  function createService(models: Readonly<Record<string, ModelRecord>> = {}): ModelService {
    const service = new ModelService(stubProviders(), stubEvents());
    service.loadAll({ ...models }, undefined);
    return service;
  }

  it('resolves ready on the first loadAll and exposes the default pointer', async () => {
    const service = new ModelService(stubProviders(), stubEvents());
    let ready = false;
    void service.ready.then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);

    service.loadAll({ k1: { provider: 'pymodel', model: 'kimi-k2', maxContextSize: 262144 } }, 'k1');
    await service.ready;
    expect(ready).toBe(true);
    expect(service.getDefaultModel()).toBe('k1');
  });

  it('supports CRUD and diffs state changes into onDidChangeModels', async () => {
    const service = createService();
    const events: Array<{
      added: readonly string[];
      removed: readonly string[];
      changed: readonly string[];
    }> = [];
    service.onDidChangeModels((e) =>
      events.push({ added: e.added, removed: e.removed, changed: e.changed }),
    );

    const k1: ModelRecord = { provider: 'pymodel', model: 'kimi-k2', maxContextSize: 262144 };
    await service.set('k1', k1);
    expect(service.get('k1')).toEqual(k1);
    expect(service.list()).toEqual({ k1 });
    expect(events).toEqual([{ added: ['k1'], removed: [], changed: [] }]);

    const updated: ModelRecord = { ...k1, displayName: 'K2' };
    await service.set('k1', updated);
    expect(events.at(-1)).toEqual({ added: [], removed: [], changed: ['k1'] });

    await service.set('k1', updated);
    expect(events).toHaveLength(2);

    await service.delete('k1');
    expect(service.get('k1')).toBeUndefined();
    expect(events.at(-1)).toEqual({ added: [], removed: ['k1'], changed: [] });
  });

  it('replaceAll keeps a default the new records still contain', async () => {
    const service = createService({ a: { provider: 'pymodel', model: 'm-a', maxContextSize: 1000 }, b: { provider: 'pymodel', model: 'm-b', maxContextSize: 2000 } });
    await service.setDefaultModel('b');

    await service.replaceAll({ b: { provider: 'pymodel', model: 'm-b', maxContextSize: 2000 }, c: { provider: 'pymodel', model: 'm-c', maxContextSize: 3000 } });
    expect(service.getDefaultModel()).toBe('b');
  });

  it('replaceAll re-picks a ranked default when the new records dropped the pointer', async () => {
    const service = createService({ a: { provider: 'pymodel', model: 'm-a', maxContextSize: 1000 }, b: { provider: 'pymodel', model: 'm-b', maxContextSize: 2000 } });
    await service.setDefaultModel('a');

    await service.replaceAll({ c: { provider: 'pymodel', model: 'm-c', maxContextSize: 3000 } });
    expect(service.list()).toEqual({ c: { provider: 'pymodel', model: 'm-c', maxContextSize: 3000 } });
    expect(service.getDefaultModel()).toBe('c');
  });

  it('fires the pointer event only on real pointer changes', async () => {
    const service = createService();
    const pointerEvents: Array<string | undefined> = [];
    service.onDidChangeDefaultModel((e) => pointerEvents.push(e.id));

    await service.setDefaultModel('k1');
    await service.setDefaultModel('k1');
    expect(pointerEvents).toEqual(['k1']);

    await service.setDefaultModel(undefined);
    expect(pointerEvents).toEqual(['k1', undefined]);
  });

  it('adopts an eligible default when the catalog arrives without one', () => {
    const service = new ModelService(stubProviders(), stubEvents());
    service.loadAll(
      {
        embed: { provider: 'pymodel', model: 'embed', capabilities: ['image_in'], maxContextSize: 8192 },
        chat: { provider: 'pymodel', model: 'chat', capabilities: ['tool_use'], maxContextSize: 262144 },
      },
      undefined,
    );
    expect(service.getDefaultModel()).toBe('chat');
  });

  it('keeps a ready default the user already chose', () => {
    const service = new ModelService(stubProviders(), stubEvents());
    service.loadAll(
      {
        small: {
          provider: 'pymodel',
          model: 'small',
          capabilities: ['tool_use'],
          maxContextSize: 8192,
        },
        big: {
          provider: 'pymodel',
          model: 'big',
          capabilities: ['tool_use'],
          maxContextSize: 1_000_000,
        },
      },
      'small',
    );
    expect(service.getDefaultModel()).toBe('small');
  });

  it('replaces a dead default with the best READY candidate, not the best-ranked overall', () => {
    const service = new ModelService(stubProviders(), stubEvents());
    service.loadAll(
      {
        huge: { model: 'huge', maxContextSize: 10_000_000 },
        big: {
          provider: 'pymodel',
          model: 'big',
          capabilities: ['tool_use'],
          maxContextSize: 1_000_000,
        },
      },
      'huge',
    );
    expect(service.getDefaultModel()).toBe('big');
  });

  it('publishes a config warning naming the replaced and selected model when the default is rewritten', async () => {
    const published: ConfigWarning[] = [];
    const events = {
      _serviceBrand: undefined,
      onDidPublish: undefined,
      publish: (event: ConfigWarning) => {
        published.push(event);
      },
      subscribe: () => ({ dispose: () => {} }),
    } as unknown as IEventService;
    const service = new ModelService(stubProviders(), events);
    service.loadAll(
      {
        small: {
          provider: 'pymodel',
          model: 'small',
          capabilities: ['tool_use'],
          maxContextSize: 8192,
        },
        big: {
          provider: 'pymodel',
          model: 'big',
          capabilities: ['tool_use'],
          maxContextSize: 1_000_000,
        },
      },
      'small',
    );
    expect(service.getDefaultModel()).toBe('small');

    await service.delete('small');

    expect(service.getDefaultModel()).toBe('big');
    const warnings = published.flatMap((event) => event.payload.warnings);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.domain).toBe('default_model');
    expect(warnings[0]?.message).toContain('"small"');
    expect(warnings[0]?.message).toContain('"big"');
    expect(warnings[0]?.message).toContain('dangling-alias');
  });

  it('reaches the empty state when models exist but none are ready', () => {
    const service = new ModelService(stubProviders({}), stubEvents());
    service.loadAll(
      {
        lone: {
          provider: 'pymodel',
          model: 'lone',
          capabilities: ['tool_use'],
          maxContextSize: 8_000,
        },
      },
      'lone',
    );
    expect(service.getDefaultModel()).toBeUndefined();
  });

  it('leaves the default unset when no model is eligible', () => {
    const service = new ModelService(stubProviders(), stubEvents());
    service.loadAll({ embed: { model: 'embed', capabilities: ['image_in'] } }, undefined);
    expect(service.getDefaultModel()).toBeUndefined();
  });

  it('adopts on the first catalog write when the registry started empty', async () => {
    const service = createService();
    expect(service.getDefaultModel()).toBeUndefined();

    await service.set('a', { provider: 'pymodel', model: 'm-a', capabilities: ['tool_use'], maxContextSize: 1000 });
    expect(service.getDefaultModel()).toBe('a');
  });

  it('adopts again once an explicit clear leaves no default', async () => {
    const service = createService({
      a: { provider: 'pymodel', model: 'm-a', capabilities: ['tool_use'], maxContextSize: 1000 },
      b: { provider: 'pymodel', model: 'm-b', capabilities: ['tool_use'], maxContextSize: 2000 },
    });
    expect(service.getDefaultModel()).toBe('b');

    await service.setDefaultModel(undefined);
    await service.delete('b');
    expect(service.getDefaultModel()).toBe('a');
  });

  it('hydrates the last-used model from loadAll and persists setter changes', async () => {
    const service = new ModelService(stubProviders(), stubEvents());
    const events: Array<string | undefined> = [];
    service.onDidChangeLastUsedModel((e) => events.push(e.id));

    service.loadAll(
      { k1: { provider: 'pymodel', model: 'kimi-k2', maxContextSize: 262144 } },
      'k1',
      'k1',
    );
    await service.ready;
    expect(service.getLastUsedModel()).toBe('k1');
    expect(events).toEqual(['k1']);

    await service.setLastUsedModel('k2');
    expect(service.getLastUsedModel()).toBe('k2');
    expect(events).toEqual(['k1', 'k2']);

    await service.setLastUsedModel('k2');
    expect(events).toEqual(['k1', 'k2']);

    await service.setLastUsedModel(undefined);
    expect(service.getLastUsedModel()).toBeUndefined();
    expect(events).toEqual(['k1', 'k2', undefined]);
  });

  it('replaces a dead default with the ready last-used model and says so in the warning', async () => {
    const published: ConfigWarning[] = [];
    const events = {
      _serviceBrand: undefined,
      onDidPublish: undefined,
      publish: (event: ConfigWarning) => {
        published.push(event);
      },
      subscribe: () => ({ dispose: () => {} }),
    } as unknown as IEventService;
    const service = new ModelService(
      stubProviders({ zai: { type: 'openai', apiKey: 'k' } }),
      events,
    );
    service.loadAll(
      {
        'zai/glm-5.2': {
          provider: 'zai',
          model: 'glm-5.2',
          capabilities: ['tool_use'],
          maxContextSize: 1_000_000,
        },
        'zai/glm-5.3-flash': {
          provider: 'zai',
          model: 'glm-5.3-flash',
          capabilities: ['tool_use'],
          maxContextSize: 1_000_000,
        },
      },
      'zai/glm-5.3-flash',
      'zai/glm-5.3-flash',
    );
    expect(service.getDefaultModel()).toBe('zai/glm-5.3-flash');

    await service.delete('zai/glm-5.3-flash');

    expect(service.getLastUsedModel()).toBe('zai/glm-5.3-flash');
    expect(service.getDefaultModel()).toBe('zai/glm-5.2');
    const warnings = published.flatMap((event) => event.payload.warnings);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.domain).toBe('default_model');
    expect(warnings[0]?.message).toContain('"zai/glm-5.3-flash"');
    expect(warnings[0]?.message).toContain('"zai/glm-5.2"');
  });

  it('falls through to the ranking when the last-used model is not ready either', () => {
    const service = new ModelService(stubProviders(), stubEvents());
    service.loadAll(
      {
        gone: { provider: 'zai', model: 'gone', capabilities: ['tool_use'], maxContextSize: 1_000_000 },
        live: { provider: 'pymodel', model: 'live', capabilities: ['tool_use'], maxContextSize: 1_000 },
      },
      'gone',
      'gone',
    );
    expect(service.getLastUsedModel()).toBe('gone');
    expect(service.getDefaultModel()).toBe('live');
  });

  it('keeps the last-used model through a catalog wipe and restores it as the default when the provider returns', async () => {
    const flash: ModelRecord = {
      provider: 'zai',
      model: 'glm-5.3-flash',
      capabilities: ['tool_use'],
      maxContextSize: 1_000_000,
    };
    const service = new ModelService(stubProviders({ zai: { type: 'openai', apiKey: 'k' } }), stubEvents());
    service.loadAll({ 'zai/glm-5.3-flash': flash }, 'zai/glm-5.3-flash', 'zai/glm-5.3-flash');
    await service.ready;
    expect(service.getDefaultModel()).toBe('zai/glm-5.3-flash');

    await service.replaceAll({});
    expect(service.getDefaultModel()).toBeUndefined();
    expect(service.getLastUsedModel()).toBe('zai/glm-5.3-flash');

    await service.replaceAll({ 'zai/glm-5.3-flash': flash });
    expect(service.getDefaultModel()).toBe('zai/glm-5.3-flash');
  });
});
