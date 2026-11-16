export declare const RATING_COOLDOWN_FILE_NAME = "feedback-survey-state.json";
export interface RatingCooldownStore {
    read(): number | undefined;
    write(lastShownTime: number): void;
}
export declare function ratingCooldownFile(dataDir: string): RatingCooldownStore;
