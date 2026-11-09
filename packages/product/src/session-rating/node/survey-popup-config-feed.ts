import { DEFAULT_SURVEY_POPUP_PAYLOAD, type SurveyPopupPayload } from '../common/survey-popup-config';
import type { RatingConfigFeed } from './engine';

export function localSurveyPopupConfigFeed(
  payload: SurveyPopupPayload = DEFAULT_SURVEY_POPUP_PAYLOAD,
): RatingConfigFeed {
  return {
    readyForEvaluation: () => true,
    payload: () => payload,
  };
}
