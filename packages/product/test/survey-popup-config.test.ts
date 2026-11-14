import { describe, expect, it } from 'vitest';

import { localSurveyPopupConfigFeed } from '#/session-rating/node/survey-popup-config-feed';
import { DEFAULT_SURVEY_POPUP_PAYLOAD } from '#/session-rating/common/survey-popup-config';

describe('localSurveyPopupConfigFeed', () => {
  it('serves the built-in defaults without any network refresh', () => {
    const feed = localSurveyPopupConfigFeed();
    expect(feed.payload()).toEqual(DEFAULT_SURVEY_POPUP_PAYLOAD);
    expect(feed.readyForEvaluation()).toBe(true);
  });
});
