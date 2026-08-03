/*
 * Derives renderer-neutral tool call presentation state and grouping decisions.
 */

/** The current presentation status of a tool call. */
export type ToolStatus = 'streaming' | 'truncated' | 'running' | 'done' | 'failed';

/** The verb used to describe a tool call's presentation status. */
export type ToolVerb = 'Using' | 'Truncated' | 'Used';

/** Inputs used to derive a tool call's presentation status. */
export interface ToolStatusInput {
  readonly hasResult: boolean;
  readonly isError?: boolean;
  readonly truncated?: boolean;
  readonly streamingArguments?: string;
}

/** Derives a tool call's presentation status using renderer-independent precedence rules. */
export function deriveToolStatus(input: ToolStatusInput): ToolStatus {
  if (input.hasResult && input.isError) {
    return 'failed';
  }

  if (input.hasResult) {
    return 'done';
  }

  if (input.truncated) {
    return 'truncated';
  }

  if (typeof input.streamingArguments === 'string') {
    return 'streaming';
  }

  return 'running';
}

/** Maps a tool call status to its renderer-neutral presentation verb. */
export function deriveToolVerb(status: ToolStatus): ToolVerb {
  if (status === 'done' || status === 'failed') {
    return 'Used';
  }

  if (status === 'truncated') {
    return 'Truncated';
  }

  return 'Using';
}

/** Inputs used to plan the placement of a tool call. */
export interface GroupPlanInput {
  readonly toolCallId: string;
  readonly name: string;
  readonly step: number;
  readonly turnId: string;
}

/** A renderer-neutral placement decision for a tool call. */
export type ToolPlacement =
  | { readonly kind: 'deferred' }
  | { readonly kind: 'standalone'; readonly toolCallId: string }
  | {
      readonly kind: 'open-group';
      readonly groupKey: string;
      readonly toolCallIds: readonly string[];
    }
  | { readonly kind: 'append-group'; readonly groupKey: string; readonly toolCallId: string };

interface SoloSlot {
  readonly step: number;
  readonly turnId: string;
  readonly soloId: string;
}

interface GroupSlot {
  readonly step: number;
  readonly turnId: string;
  readonly groupKey: string;
}

type PendingSlot = SoloSlot | GroupSlot;
type GroupableToolName = 'Agent' | 'Read';

/** Plans deterministic grouping for consecutive groupable tool calls. */
export class ToolGroupPlanner {
  private readonly pending: {
    Agent: PendingSlot | undefined;
    Read: PendingSlot | undefined;
  } = {
    Agent: undefined,
    Read: undefined,
  };

  private nextGroupNumber = 0;

  /** Determines where a tool call belongs without retaining renderer or component state. */
  place(input: GroupPlanInput): ToolPlacement {
    if (input.name === 'AskUserQuestion') {
      return { kind: 'deferred' };
    }

    const groupableName = this.toGroupableName(input.name);
    this.clearOtherSlots(groupableName);

    if (groupableName === undefined) {
      return { kind: 'standalone', toolCallId: input.toolCallId };
    }

    let slot = this.pending[groupableName];
    if (slot !== undefined && (slot.step !== input.step || slot.turnId !== input.turnId)) {
      this.pending[groupableName] = undefined;
      slot = undefined;
    }

    if (slot === undefined) {
      this.pending[groupableName] = {
        step: input.step,
        turnId: input.turnId,
        soloId: input.toolCallId,
      };
      return { kind: 'standalone', toolCallId: input.toolCallId };
    }

    if ('groupKey' in slot) {
      return {
        kind: 'append-group',
        groupKey: slot.groupKey,
        toolCallId: input.toolCallId,
      };
    }

    const groupKey = `group:${groupableName}:${this.nextGroupNumber}`;
    this.nextGroupNumber += 1;
    this.pending[groupableName] = {
      step: input.step,
      turnId: input.turnId,
      groupKey,
    };
    return {
      kind: 'open-group',
      groupKey,
      toolCallIds: [slot.soloId, input.toolCallId],
    };
  }

  /** Clears all pending groups and restarts deterministic group-key numbering. */
  reset(): void {
    this.pending.Agent = undefined;
    this.pending.Read = undefined;
    this.nextGroupNumber = 0;
  }

  private toGroupableName(name: string): GroupableToolName | undefined {
    if (name === 'Agent' || name === 'Read') {
      return name;
    }

    return undefined;
  }

  private clearOtherSlots(name: GroupableToolName | undefined): void {
    if (name !== 'Agent') {
      this.pending.Agent = undefined;
    }

    if (name !== 'Read') {
      this.pending.Read = undefined;
    }
  }
}
