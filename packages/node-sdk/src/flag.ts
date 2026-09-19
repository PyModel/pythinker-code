import type {
  FlagDefinitionInput,
  FlagId,
} from '@pymodel/agent-core-v2/app/flag/flagRegistry';

export type {
  ExperimentalFeatureState,
  ExperimentalFlagMap,
  ExperimentalFlagSource,
} from '@pymodel/agent-core-v2/app/flag/flag';
export type {
  FlagDefinitionInput,
  FlagId,
  FlagSurface,
} from '@pymodel/agent-core-v2/app/flag/flagRegistry';

export type FlagDefinition = FlagDefinitionInput & { readonly id: FlagId };
