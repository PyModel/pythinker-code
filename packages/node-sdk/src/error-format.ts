import {
  isPythinkerError,
  type PythinkerErrorPayload,
} from '@pythoughts/agent-core';

export function formatErrorMessage(error: unknown): string {
  if (isPythinkerError(error)) {
    return formatErrorPayload({
      code: error.code,
      message: error.message,
      details: error.details,
    });
  }
  return error instanceof Error ? error.message : String(error);
}

export function formatErrorPayload(
  error: Pick<PythinkerErrorPayload, 'code' | 'message' | 'details'>,
): string {
  const filteredMessage = formatProviderFilteredMessage(error.details);
  if (filteredMessage !== undefined) return `[${error.code}] ${filteredMessage}`;
  return `[${error.code}] ${error.message}`;
}

function formatProviderFilteredMessage(
  details: Record<string, unknown> | undefined,
): string | undefined {
  const finishReason = stringDetail(details, 'finishReason');
  const rawFinishReason = stringDetail(details, 'rawFinishReason');
  if (finishReason !== 'filtered' && rawFinishReason !== 'content_filter') return undefined;

  const normalizedFinishReason = finishReason ?? 'filtered';
  const raw = rawFinishReason === undefined ? '' : `, rawFinishReason=${rawFinishReason}`;
  return `Provider filtered the response before visible output (finishReason=${normalizedFinishReason}${raw}).`;
}

function stringDetail(
  details: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = details?.[key];
  return typeof value === 'string' ? value : undefined;
}
