/**
 * Declared capabilities for a specific model.
 *
 * `getModelCapability(wire, model)` returns one of these so callers can gate
 * requests against modalities the model does not accept without dispatching
 * the request and watching it fail upstream.
 *
 * `max_context_tokens: 0` means "unknown"; callers that do not gate on
 * context length can ignore the field.
 */
/** Model token rates in USD per 1,000,000 tokens. */
export interface ModelCostRates {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

export interface ModelCapability {
  readonly image_in: boolean;
  readonly video_in: boolean;
  readonly audio_in: boolean;
  readonly thinking: boolean;
  readonly tool_use: boolean;
  /** Whether the model advertises a provider-native premium Fast tier. */
  readonly fast_mode?: boolean;
  readonly max_context_tokens: number;
  /** Token rates in USD per 1,000,000 tokens, when known. */
  readonly cost?: ModelCostRates;
}

const UNKNOWN_CAPABILITY_MARKER = Symbol.for('pythoughts.kosong.UNKNOWN_CAPABILITY');

/**
 * Shared read-only default returned when a provider has not catalogued a
 * given model. Frozen so accidental mutation at one call site cannot leak
 * into another.
 */
export const UNKNOWN_CAPABILITY: ModelCapability = Object.freeze(
  Object.defineProperty(
    {
      image_in: false,
      video_in: false,
      audio_in: false,
      thinking: false,
      tool_use: false,
      fast_mode: false,
      max_context_tokens: 0,
    },
    UNKNOWN_CAPABILITY_MARKER,
    { value: true },
  ),
);

/**
 * True when `capability` is unknown: the {@link UNKNOWN_CAPABILITY} singleton
 * (detected via its marker symbol) or any value whose fields all match the
 * unknown defaults, such as a copy that lost the marker.
 */
export function isUnknownCapability(capability: ModelCapability): boolean {
  if (capability === UNKNOWN_CAPABILITY) return true;
  const marked =
    (capability as unknown as Record<PropertyKey, unknown>)[UNKNOWN_CAPABILITY_MARKER] === true;
  if (marked) return true;
  return (
    !capability.image_in &&
    !capability.video_in &&
    !capability.audio_in &&
    !capability.thinking &&
    !capability.tool_use &&
    capability.fast_mode !== true &&
    capability.max_context_tokens === 0
  );
}
