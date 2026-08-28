/* oxlint-disable typescript-eslint/no-unsafe-declaration-merging, eslint-plugin-import/namespace -- Event2 class+payload-interface declaration merging is the sanctioned event-declaration idiom. */
import { z } from 'zod';

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { AgentEvent2 } from '#/app/event/event2';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { IAgentStateService } from '#/agent/state/agentState';
import { defineState } from '#/state/state';
import { IEventDispatcher } from '#/state/eventDispatcher';

import type { SubagentBindingProvenance } from './routing';

const subagentBindingProvenanceRecordedSchema = z.object({
  agentId: z.string(),
  provenance: z.custom<SubagentBindingProvenance>(),
});

export class SubagentBindingProvenanceRecorded extends AgentEvent2<
  z.infer<typeof subagentBindingProvenanceRecordedSchema>
> {
  static override readonly type = 'subagent.binding_provenance.recorded';
  static override readonly durable = true;
  static override readonly schema = subagentBindingProvenanceRecordedSchema;
}
export interface SubagentBindingProvenanceRecorded {
  readonly agentId: string;
  readonly provenance: SubagentBindingProvenance;
}

export const subagentBindingProvenanceKey = defineState(
  'subagent.bindingProvenance',
  (): SubagentBindingProvenance | undefined => undefined,
)
  .replayable({ schema: z.custom<SubagentBindingProvenance | undefined>() })
  .on(SubagentBindingProvenanceRecorded, (_state, event) => event.provenance);

export interface IAgentBindingProvenanceService {
  readonly _serviceBrand: undefined;

  current(): SubagentBindingProvenance | undefined;
  record(provenance: SubagentBindingProvenance): void;
}

export const IAgentBindingProvenanceService: ServiceIdentifier<IAgentBindingProvenanceService> =
  createDecorator<IAgentBindingProvenanceService>('agentBindingProvenanceService');

export class AgentBindingProvenanceService implements IAgentBindingProvenanceService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IEventDispatcher private readonly dispatcher: IEventDispatcher,
    @IAgentScopeContext private readonly scopeContext: IAgentScopeContext,
    @IAgentStateService private readonly agentState: IAgentStateService,
  ) {
    this.agentState.contributeState(subagentBindingProvenanceKey);
  }

  current(): SubagentBindingProvenance | undefined {
    return this.agentState.get(subagentBindingProvenanceKey) as SubagentBindingProvenance | undefined;
  }

  record(provenance: SubagentBindingProvenance): void {
    if (this.current() !== undefined) return;
    void this.dispatcher.dispatch(
      new SubagentBindingProvenanceRecorded({ agentId: this.scopeContext.agentId, provenance }),
    );
  }
}

registerScopedService(
  LifecycleScope.Agent,
  IAgentBindingProvenanceService,
  AgentBindingProvenanceService,
  ScopeActivation.OnScopeCreated,
  'subagent',
);
