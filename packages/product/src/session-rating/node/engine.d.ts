import type { PromptOrigin } from '@pymodel/agent-core-v2';
import { type SurveyTurnRecovery } from './survey-turns';
import type { RatingCooldownStore } from './cooldown-store';
import { SessionRatingLedger, type RatingTracker } from './ledger';
import type { RatingOffer } from '../common/types';
import { type SurveyPopupPayload } from '../common/survey-popup-config';
export type SessionFact = {
    readonly kind: 'turn-started';
    readonly origin: PromptOrigin | undefined;
} | {
    readonly kind: 'turn-ended';
    readonly traceId?: string;
} | {
    readonly kind: 'tool-call-started';
    readonly toolCallId: string;
    readonly toolName: string;
} | {
    readonly kind: 'tool-call-ended';
    readonly toolCallId: string;
} | {
    readonly kind: 'subagent-spawned';
    readonly parentToolCallId?: string;
    readonly dynamicWorkflowIndex?: number;
    readonly model?: string;
} | {
    readonly kind: 'compaction-completed';
};
export interface ResumedAgentSeed {
    readonly type: string;
    readonly profileName?: string;
    readonly dynamicWorkflowItem?: string;
    readonly sessionInit?: string;
}
export interface RatingEnvironment {
    readonly sessionId: string;
    readonly currentModel: string;
    readonly cumulativeTokens: number;
    readonly contextTokens: number;
    readonly permissionMode: string;
    readonly thinkingEffort: string;
    readonly busy: boolean;
    readonly telemetryDisabled: boolean;
    readonly ratingDisabled: boolean;
    readonly historyUserTurnCount?: number;
    readonly resumedAgents?: Readonly<Record<string, ResumedAgentSeed>>;
}
export interface RatingConfigFeed {
    readyForEvaluation(): boolean;
    payload(): SurveyPopupPayload;
}
export interface SessionRatingDeps {
    readonly environment: () => RatingEnvironment;
    readonly config: RatingConfigFeed;
    readonly cooldown: RatingCooldownStore;
    readonly ledger: SessionRatingLedger;
    readonly track: RatingTracker;
    readonly now?: () => number;
    readonly wallNow?: () => number;
    readonly random?: () => number;
    readonly appearanceId?: () => string;
}
export interface SessionRatingMount {
    observe(fact: SessionFact): void;
    recover(recovery: SurveyTurnRecovery): void;
    evaluate(): RatingOffer | undefined;
    end(): void;
}
export declare function mountSessionRating(deps: SessionRatingDeps): SessionRatingMount;
