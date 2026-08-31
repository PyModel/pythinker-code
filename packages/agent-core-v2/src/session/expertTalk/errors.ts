import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';

export const ExpertTalkErrors = {
  codes: {
    EXPERT_TALK_RUN_NOT_FOUND: 'expert_talk.run_not_found',
    EXPERT_TALK_FEATURE_DISABLED: 'expert_talk.feature_disabled',
    EXPERT_TALK_PAIR_NOT_CONFIGURED: 'expert_talk.pair_not_configured',
    EXPERT_TALK_PAIR_INVALID: 'expert_talk.pair_invalid',
    EXPERT_TALK_PAIR_COLLAPSED: 'expert_talk.pair_collapsed',
    EXPERT_TALK_ALREADY_ARMED: 'expert_talk.already_armed',
    EXPERT_TALK_NOT_ARMED: 'expert_talk.not_armed',
    EXPERT_TALK_BUSY: 'expert_talk.busy',
    EXPERT_TALK_RUN_NOT_RETRYABLE: 'expert_talk.run_not_retryable',
    EXPERT_TALK_CLIENT_UNSUPPORTED: 'expert_talk.client_unsupported',
    EXPERT_TALK_CONTEXT_INSUFFICIENT: 'expert_talk.context_insufficient',
    EXPERT_TALK_BUDGET_EXCEEDED: 'expert_talk.budget_exceeded',
    EXPERT_TALK_CONFIG_VERSION_CONFLICT: 'expert_talk.config_version_conflict',
  },
  retryable: [
    'expert_talk.busy',
    'expert_talk.context_insufficient',
    'expert_talk.budget_exceeded',
  ],
} as const satisfies ErrorDomain;

registerErrorDomain(ExpertTalkErrors);
