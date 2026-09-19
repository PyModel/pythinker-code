import type { ProviderMediaContribution } from '#/llm/media/upload';
import { modelKey, type LlmModel } from '#/llm/model';

import { PythinkerFiles } from './files';
import { PYTHINKER_DEFAULT_BASE_URL } from './trait';

const filesByModel = new Map<string, PythinkerFiles>();

function resolveFiles(model: LlmModel): PythinkerFiles {
  const key = modelKey(model);
  let files = filesByModel.get(key);
  if (files === undefined) {
    files = new PythinkerFiles({
      apiKey: model.apiKey,
      baseUrl: model.baseUrl ?? PYTHINKER_DEFAULT_BASE_URL,
      defaultHeaders:
        model.defaultHeaders === undefined ? undefined : { ...model.defaultHeaders },
    });
    filesByModel.set(key, files);
  }
  return files;
}

export const pythinkerMediaContribution: ProviderMediaContribution = {
  uploadVideo: (video, { model, signal }) => resolveFiles(model).uploadVideo(video, { signal }),
};
