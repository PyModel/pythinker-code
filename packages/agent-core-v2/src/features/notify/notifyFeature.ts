import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';

import { notifyUserNudgeAgentRuntimeProvider } from './notifyUserNudgeAgentRuntime';
import { ISessionNotify } from './sessionNotify';
import { INotifyUserTool, NOTIFY_USER_TOOL_NAME } from './tools/notify-user/notify-user';
import { NotifyUserTool } from './tools/notify-user/notifyUserTool';

import './flag';
import './sessionNotify';

export class NotifyFeature extends Feature {
  static override readonly name = 'notify';

  constructor() {
    super();
    this.contributeTool(INotifyUserTool, NotifyUserTool, {
      name: NOTIFY_USER_TOOL_NAME,
      domain: 'notify',
      when: (accessor) => accessor.get(ISessionNotify).enabled,
    });
    this.contributeAgentRuntime(notifyUserNudgeAgentRuntimeProvider);
  }
}

registerFeature(NotifyFeature);
