/**
 * Agent engine routing gates for the CLI surfaces.
 *
 * `pythinker -p` and the interactive TUI use the native agent-core-v2 path by
 * default. A truthy `PYTHINKER_CODE_LEGACY_FLAG` selects the
 * legacy agent-core-backed path instead. `PYTHINKER_CODE_EXPERIMENTAL_FLAG` remains
 * the master switch for experimental features within either engine; it does
 * not select the engine.
 *
 * Note: `pythinker web` always boots agent-gateway (the agent-core-v2 engine
 * server) — it does not consult this switch.
 */

export const PYTHINKER_LEGACY_ENV = 'PYTHINKER_CODE_LEGACY_FLAG';

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

function isTruthyEnv(
  key: string,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return TRUTHY_VALUES.has((env[key] ?? '').trim().toLowerCase());
}

export function isLegacyEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return isTruthyEnv(PYTHINKER_LEGACY_ENV, env);
}

export function isPythinkerV2Enabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return !isLegacyEnabled(env);
}
