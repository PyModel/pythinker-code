import type { SurveyEventName, SurveyEventProperties } from './event-properties';
import type { RatingReport, RatingTrackContext } from '../common/types';
export declare const RATING_REPORT_RETENTION_MS: number;
export declare const RATING_REPORT_CAPACITY = 1024;
export type RatingTracker = (event: SurveyEventName, properties: SurveyEventProperties, context: RatingTrackContext) => void;
export interface RatingRegistration {
    readonly mount: symbol;
    readonly event: SurveyEventName;
    readonly properties: SurveyEventProperties;
    readonly context: RatingTrackContext;
    readonly track: RatingTracker;
}
export declare class SessionRatingLedger {
    private readonly deps;
    private readonly entries;
    constructor(deps: {
        readonly telemetryDisabled: () => boolean;
        readonly now?: () => number;
    });
    register(registration: RatingRegistration): void;
    report(sessionId: string, report: RatingReport): void;
    detach(mount: symbol): void;
    clear(): void;
    private track;
    private prune;
    private now;
}
