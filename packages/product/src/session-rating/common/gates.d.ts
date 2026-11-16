import type { SurveyKind } from './types';
import type { SurveyPopupConfig } from './survey-popup-config';
export type SurveyGateSkipReason = 'mount-roll-consumed' | 'mount-survey-shown' | 'turn-in-progress' | 'feature-disabled' | 'telemetry-disabled' | 'warmup' | 'pacing' | 'threshold-invalid' | 'below-threshold' | 'sampled-out' | 'global-cooldown';
export interface SharedArmGateInput {
    readonly turnInProgress: boolean;
    readonly feedbackSurveyDisabled: boolean;
    readonly telemetryDisabled: boolean;
}
export interface SessionArmGateInput extends SharedArmGateInput {
    readonly mountedForMs: number;
    readonly userTurnsSinceMount: number;
    readonly msSinceLastShown: number | undefined;
    readonly userTurnsSinceLastShown: number | undefined;
    readonly sample: number;
    readonly msSinceGlobalLastShown: number | undefined;
}
export interface LongContextArmGateInput extends SharedArmGateInput {
    readonly cumulativeTokens: number;
    readonly virtualContextTokens: number;
    readonly mountRollConsumed: boolean;
    readonly mountSurveyShown: boolean;
    readonly msSinceGlobalLastShown: number | undefined;
    readonly drawMountRoll: () => number;
}
export interface SurveyGateInput {
    readonly session: SessionArmGateInput;
    readonly longContext: LongContextArmGateInput;
    readonly config: SurveyPopupConfig;
}
export type SurveyGateVerdict = {
    readonly show: true;
    readonly survey: SurveyKind;
    readonly longContextRollConsumed?: boolean;
} | {
    readonly show: false;
    readonly reason: SurveyGateSkipReason;
    readonly longContextRollConsumed?: boolean;
};
export declare function evaluateLongContextArm(input: SurveyGateInput): SurveyGateVerdict;
export declare function evaluateSurveyGate(input: SurveyGateInput): SurveyGateVerdict;
