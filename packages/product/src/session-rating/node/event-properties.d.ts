import type { SurveyEventType, SurveyResponse } from '../common/types';
import type { SurveyPopupConfig } from '../common/survey-popup-config';
export declare const SURVEY_EVENT_NAMES: {
    readonly session: 'feedback_survey';
    readonly long_context: 'long_context_survey';
};
export type SurveyEventName = keyof typeof surveyEventDefinitions;
export interface SurveyEventProperties {
    event_type: 'appeared' | 'responded' | 'abandoned';
    appearance_id: string;
    appearance_index: number;
    response?: 'bad' | 'fine' | 'good' | 'dismissed';
    current_model: string;
    user_turn_count?: number;
    cumulative_tokens: number;
    virtual_context_tokens: number;
    tool_call_count: number;
    compaction_count: number;
    permission_mode: string;
    thinking_effort: string;
    subagent_count: number;
    subagent_models?: string;
    dynamic_workflow_run_count: number;
    dynamic_workflow_models?: string;
    config_probability: number;
    config_min_time_before_feedback_ms: number;
    config_min_user_turns_before_feedback: number;
    config_min_time_between_feedback_ms: number;
    config_min_user_turns_between_feedback: number;
    config_min_time_between_global_feedback_ms: number;
    config_long_context_survey_threshold: number;
    config_long_context_probability: number;
    config_long_context_trigger_mode: 'cumulative' | 'virtual_context';
}
export interface SurveyEventCoreFields {
    readonly event_type: SurveyEventType;
    readonly appearance_id: string;
    readonly appearance_index: number;
    readonly response?: SurveyResponse;
}
export interface SurveyEventEnvironmentFields {
    readonly current_model: string;
    readonly user_turn_count?: number;
    readonly cumulative_tokens: number;
    readonly virtual_context_tokens: number;
    readonly tool_call_count: number;
    readonly compaction_count: number;
    readonly permission_mode: string;
    readonly thinking_effort: string;
    readonly subagent_count: number;
    readonly subagent_models?: string;
    readonly dynamic_workflow_run_count: number;
    readonly dynamic_workflow_models?: string;
}
export declare const surveyEventDefinitions: {
    readonly feedback_survey: import("@pymodel/agent-core-v2").TelemetryEventDefinition<SurveyEventProperties, "none">;
    readonly long_context_survey: import("@pymodel/agent-core-v2").TelemetryEventDefinition<SurveyEventProperties, "none">;
};
export declare function buildSurveyEventProperties(core: SurveyEventCoreFields, environment: SurveyEventEnvironmentFields, config: SurveyPopupConfig): SurveyEventProperties;
