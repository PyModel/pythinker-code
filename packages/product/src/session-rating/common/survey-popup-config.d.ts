export interface SurveyPopupConfig {
    probability: number;
    min_time_before_feedback_ms: number;
    min_user_turns_before_feedback: number;
    min_time_between_feedback_ms: number;
    min_user_turns_between_feedback: number;
    min_time_between_global_feedback_ms: number;
    long_context_survey_threshold: number;
    long_context_probability: number;
    long_context_trigger_mode: 'cumulative' | 'virtual_context';
}
export declare const DEFAULT_SURVEY_POPUP_CONFIG: SurveyPopupConfig;
export type SurveyPopupPayload = SurveyPopupConfig;
export declare const DEFAULT_SURVEY_POPUP_PAYLOAD: SurveyPopupPayload;
