import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SURVEY_POPUP_CONFIG,
  getSurveyPopupConfig,
  peekSurveyPopupConfig,
  peekSurveyPopupConfigFresh,
} from '#/utils/survey-popup-config';

describe('survey popup config', () => {
  it('returns the built-in defaults', () => {
    expect(getSurveyPopupConfig()).toEqual(DEFAULT_SURVEY_POPUP_CONFIG);
    expect(peekSurveyPopupConfig()).toEqual(DEFAULT_SURVEY_POPUP_CONFIG);
    expect(peekSurveyPopupConfigFresh()).toBe(true);
  });

  it('copies the model list so callers cannot mutate the defaults', () => {
    const first = getSurveyPopupConfig();
    first.on_for_models.push('other');
    expect(DEFAULT_SURVEY_POPUP_CONFIG.on_for_models).toEqual(['*']);
  });
});
