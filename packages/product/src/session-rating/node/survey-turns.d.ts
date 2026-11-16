import type { IEventDispatcher, IDisposable } from '@pymodel/agent-core-v2';
export interface SurveyTurnRecovery {
    readonly userTurnCount: number;
    readonly firstPromptAt?: number;
    readonly origin: unknown;
    readonly traceId?: string;
    readonly endedAt?: number;
}
export interface MountedSurveyTurnCounter extends IDisposable {
    readonly count: number | undefined;
    readonly whenAttached: Promise<void>;
    recovery(): SurveyTurnRecovery | undefined;
}
export declare function mountSurveyTurnCounter(dispatcher: IEventDispatcher): MountedSurveyTurnCounter;
export declare class SurveyTurnCounter {
    private history;
    get count(): number | undefined;
    observe(record: unknown, position: number): void;
    invalidate(): void;
}
export declare function isSurveyTurnOrigin(origin: unknown): boolean | undefined;
