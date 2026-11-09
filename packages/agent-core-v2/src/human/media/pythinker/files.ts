import { Blob, File } from 'node:buffer';

import type OpenAI from 'openai';
import OpenAIClient from 'openai';

import type { ImageURLPart, VideoURLPart } from '#/llm/message';
import type { ImageUploadInput, VideoUploadInput } from '#/media/upload';
import type { LlmModel } from '#/llm-requester/model';

import { PYTHINKER_DEFAULT_BASE_URL } from '#/llm/builtin/provider/pythinker/index';

export function pythinkerFilesBaseUrl(model: LlmModel): string {
  const base = model.baseUrl ?? PYTHINKER_DEFAULT_BASE_URL;
  if (model.provider !== 'anthropic') return base;
  return /\/v1\/?$/.test(base) ? base : `${base.replace(/\/$/, '')}/v1`;
}

export interface PythinkerUploadOptions {
  signal?: AbortSignal;
}

export interface PythinkerFilesOptions {
  apiKey?: string;
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
}

export class PythinkerFiles {
  private readonly _client: OpenAI | undefined;

  constructor(options: PythinkerFilesOptions) {
    this._client =
      options.apiKey === undefined || options.apiKey.length === 0
        ? undefined
        : new OpenAIClient({
            apiKey: options.apiKey,
            baseURL: options.baseUrl,
            defaultHeaders: options.defaultHeaders,
          });
  }

  async uploadVideo(
    input: VideoUploadInput,
    options?: PythinkerUploadOptions,
  ): Promise<VideoURLPart> {
    if (!input.mimeType.startsWith('video/')) {
      throw new Error(`Expected a video mime type, got ${input.mimeType}`);
    }
    const uploaded = await this._upload(input, 'video', options);
    return {
      type: 'video_url',
      videoUrl: { url: `ms://${uploaded.id}`, id: uploaded.id },
    };
  }

  async uploadImage(
    input: ImageUploadInput,
    options?: PythinkerUploadOptions,
  ): Promise<ImageURLPart> {
    if (!input.mimeType.startsWith('image/')) {
      throw new Error(`Expected an image mime type, got ${input.mimeType}`);
    }
    const uploaded = await this._upload(input, 'image', options);
    return {
      type: 'image_url',
      imageUrl: { url: `ms://${uploaded.id}`, id: uploaded.id },
    };
  }

  private async _upload(
    input: VideoUploadInput | ImageUploadInput,
    purpose: 'video' | 'image',
    options?: PythinkerUploadOptions,
  ): Promise<{ id: string }> {
    const filename = input.filename ?? guessFilename(input.mimeType);
    const bytes = new Uint8Array(input.data.byteLength);
    bytes.set(input.data instanceof Uint8Array ? input.data : new Uint8Array(input.data));
    const blob = new Blob([bytes], { type: input.mimeType });
    const file = new File([blob], filename, { type: input.mimeType });

    const client = this._createClient();
    return (await client.files.create(
      {
        file: file as never,
        purpose: purpose as never,
      },
      options?.signal ? { signal: options.signal } : undefined,
    )) as unknown as { id: string };
  }

  private _createClient(): OpenAI {
    if (this._client === undefined) {
      throw new Error('PythinkerFiles: apiKey is required');
    }
    return this._client;
  }
}

function guessFilename(mimeType: string): string {
  const ext = MIME_TO_EXT[mimeType.toLowerCase()] ?? 'bin';
  return `upload.${ext}`;
}

const MIME_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/mpeg': 'mpeg',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/x-msvideo': 'avi',
  'video/x-flv': 'flv',
  'video/3gpp': '3gp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};
