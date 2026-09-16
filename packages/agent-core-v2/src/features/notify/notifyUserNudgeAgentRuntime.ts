import { fromCallback, setup } from 'xstate';

import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { IAgentToolRegistryService } from '#/agent/toolRegistry/toolRegistry';
import {
  defineAgentRuntimeContract,
  defineAgentRuntimeProvider,
  type AgentRuntimeContext,
  type AgentRuntimeRestoreEvent,
} from '#/agent/runtime/agentRuntime';
import { IFlagService } from '#/app/flag/flag';
import { AgentReminder } from '#/features/reminder/reminderAgentRuntime';
import type { ContextInjectionContext } from '#/features/reminder/types';
import { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';

import { NOTIFY_USER_FLAG_ID } from './flag';
import {
  NOTIFY_USER_NUDGE_VARIANT,
  lastMidResponsePosition,
  renderMidResponseHint,
  renderNotifyUserNudge,
  shouldNudgeMidResponse,
  shouldNudgeNotifyUser,
  toolCallsSinceLastNotify,
  toolCallsSincePosition,
} from './notifyUserNudge';
import { NOTIFY_USER_TOOL_NAME } from './tools/notify-user/notify-user';

interface NotifyUserNudgeActorContext {
  readonly runtime: AgentRuntimeContext<null>;
}

const notifyUserNudgeReminders = fromCallback(({
  input,
}: {
  input: {
    readonly runtime: AgentRuntimeContext<null>;
  };
}) => {
  const runtime = input.runtime;
  if (!runtime.get(IFlagService).enabled(NOTIFY_USER_FLAG_ID)) return () => {};
  const reminder = runtime.get(IAgentLifecycleService).resolve(runtime.agent, AgentReminder);
  const registration = reminder.register(
    NOTIFY_USER_NUDGE_VARIANT,
    ({ lastInjectedAt }: ContextInjectionContext): string | undefined => {
      if (!runtime.get(IFlagService).enabled(NOTIFY_USER_FLAG_ID)) return undefined;
      if (runtime.get(IAgentToolRegistryService).resolve(NOTIFY_USER_TOOL_NAME) === undefined) {
        return undefined;
      }
      const history = runtime.get(IAgentContextMemoryService).get();
      const streak = toolCallsSinceLastNotify(history);
      const callsSinceLastNudge =
        lastInjectedAt === null ? null : toolCallsSincePosition(history, lastInjectedAt);
      if (shouldNudgeNotifyUser(streak, callsSinceLastNudge)) return renderNotifyUserNudge(streak);
      if (shouldNudgeMidResponse(lastMidResponsePosition(history), lastInjectedAt)) {
        return renderMidResponseHint();
      }
      return undefined;
    },
  );
  return () => {
    registration.dispose();
  };
});

const notifyUserNudgeActorLogic = setup({
  types: {} as {
    context: NotifyUserNudgeActorContext;
    input: AgentRuntimeContext<null>;
    events: AgentRuntimeRestoreEvent;
  },
  actors: { notifyUserNudgeReminders },
}).createMachine({
  context: ({ input }) => ({ runtime: input }),
  initial: 'beforeRestore',
  states: {
    beforeRestore: {
      on: { 'runtime.restore': 'active' },
    },
    active: {
      invoke: {
        src: 'notifyUserNudgeReminders',
        input: ({ context }) => ({ runtime: context.runtime }),
      },
    },
  },
});

export class NotifyUserNudgeRuntime {}

export const AgentNotifyUserNudge = defineAgentRuntimeContract<NotifyUserNudgeRuntime>(
  'notifyUserNudge',
);

export const notifyUserNudgeAgentRuntimeProvider = defineAgentRuntimeProvider<
  null,
  NotifyUserNudgeRuntime
>(AgentNotifyUserNudge, {
  id: 'notifyUserNudge',
  logic: notifyUserNudgeActorLogic,
  eager: true,
  createApi: () => new NotifyUserNudgeRuntime(),
});
