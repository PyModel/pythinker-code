/**
 * Test stubs for `PythinkerHarness` interactions that used to live as
 * dedicated convenience methods on the SDK (`auth.hasUsableToken`,
 * `listAvailableModels`). The methods are gone; the adapter now calls
 * the underlying SDK API directly (`isAuthenticated`, `getConfig().models`)
 * and the helpers below produce the matching stub shapes so each test
 * file doesn't have to hand-roll them.
 */

import type { ModelAlias } from '@pymodel/pythinker-code-sdk';

/** Stub `harness.isAuthenticated()` for a harness with a usable credential. */
export const AUTHED = async (): Promise<boolean> => true;

/** Stub `harness.isAuthenticated()` for a harness with none. */
export const UNAUTHED = async (): Promise<boolean> => false;

/**
 * Build a `Record<string, ModelAlias>` suitable for stubbing
 * `harness.getConfig().models`. Each input entry maps to one alias;
 * `capabilities: ['thinking']` is added when `thinkingSupported` is
 * true so `deriveThinkingSupported` (in `src/model-catalog.ts`) reads
 * it back correctly — this opts out of the name-regex and
 * allow-list heuristics in favour of an explicit declaration that
 * mirrors what a real config file would carry.
 */
export function makeModelsMap(
  entries: ReadonlyArray<{
    id: string;
    name?: string;
    thinkingSupported?: boolean;
    alwaysThinking?: boolean;
    /** Declared `support_efforts` — presence turns the fixture into an effort-capable model. */
    efforts?: readonly string[];
    /** Declared `default_effort`; falls back to the middle `efforts` entry when omitted. */
    defaultEffort?: string;
  }>,
): Record<string, ModelAlias> {
  const out: Record<string, ModelAlias> = {};
  for (const entry of entries) {
    const capabilities = entry.alwaysThinking === true
      ? ['thinking', 'always_thinking']
      : entry.thinkingSupported === true
        ? ['thinking']
        : undefined;
    out[entry.id] = {
      // The fields below are the minimum shape the adapter reads off
      // each alias — `provider`/`max_context_size` are required by the
      // schema but unused by the model catalog, so they're skipped
      // here and the partial-record cast keeps the test stub honest.
      model: entry.id,
      ...(entry.name !== undefined ? { displayName: entry.name } : {}),
      ...(capabilities !== undefined ? { capabilities } : {}),
      ...(entry.efforts !== undefined ? { supportEfforts: [...entry.efforts] } : {}),
      ...(entry.defaultEffort !== undefined ? { defaultEffort: entry.defaultEffort } : {}),
    } as ModelAlias;
  }
  return out;
}
