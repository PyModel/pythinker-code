import { describe, expect, it, vi } from 'vitest';

import type { CoreRPC, PythinkerConfig } from '../../src';
import {
  ConfigService,
  type ICoreProcessService,
  type IEventService,
} from '../../src/services';

describe('ConfigService', () => {
  it('converts underscores but preserves hyphens in nested record keys', async () => {
    const setPythinkerConfig = vi.fn(async (patch: unknown) => patch as PythinkerConfig);
    const core = {
      rpc: { setPythinkerConfig } as unknown as CoreRPC,
    } as ICoreProcessService;
    const eventService = { publish: vi.fn() } as unknown as IEventService;
    const service = new ConfigService(core, eventService);

    await service.set({
      providers: {
        provider_with_underscore: { type: 'openai' },
        'provider-with-hyphen': { type: 'openai' },
      },
      models: {
        model_with_underscore: {
          provider: 'provider_with_underscore',
          model: 'model_with_underscore',
          max_context_size: 1000,
        },
        'model-with-hyphen': {
          provider: 'provider-with-hyphen',
          model: 'model-with-hyphen',
          max_context_size: 1000,
        },
      },
    });

    expect(setPythinkerConfig).toHaveBeenCalledWith({
      providers: {
        providerWithUnderscore: { type: 'openai' },
        'provider-with-hyphen': { type: 'openai' },
      },
      models: {
        modelWithUnderscore: {
          provider: 'provider_with_underscore',
          model: 'model_with_underscore',
          maxContextSize: 1000,
        },
        'model-with-hyphen': {
          provider: 'provider-with-hyphen',
          model: 'model-with-hyphen',
          maxContextSize: 1000,
        },
      },
    });
  });
});
