import { uploadFilename } from '#/llm/protocol/kit/media';
import type { LlmFiles } from '#/llm/request';

import { pythinkerOpenAIProtocol } from './protocol';

function createPythinkerFiles(filesBaseUrl: (baseUrl: string | undefined) => string | undefined): LlmFiles {
  return {
    kinds: new Set(['image', 'video']),
    upload: async (file, { endpoint, signal }) => {
      if (!file.mimeType.startsWith(`${file.kind}/`)) {
        throw new Error(`Expected a ${file.kind} mime type, got ${file.mimeType}`);
      }
      const client = pythinkerOpenAIProtocol.client(
        { ...endpoint, baseUrl: filesBaseUrl(endpoint.baseUrl) },
        undefined,
      );
      const body = new File([new Uint8Array(file.data)], uploadFilename(file), {
        type: file.mimeType,
      });
      const uploaded = await client.files.create({ file: body, purpose: file.kind as never }, { signal });
      return { url: `ms://${uploaded.id}`, id: uploaded.id };
    },
  };
}

export const pythinkerFiles: LlmFiles = createPythinkerFiles((baseUrl) => baseUrl);

export const pythinkerAnthropicFiles: LlmFiles = createPythinkerFiles((baseUrl) => {
  if (baseUrl === undefined) return undefined;
  return /\/v1\/?$/.test(baseUrl) ? baseUrl : `${baseUrl.replace(/\/$/, '')}/v1`;
});
