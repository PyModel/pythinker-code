/**
 * Experimental agent-core-v2 engine gate for the CLI surfaces.
 *
 * When the master switch `PYTHINKER_CODE_EXPERIMENTAL_FLAG` is truthy, `pythinker -p`
 * (print mode) routes to the native agent-core-v2 runner (see
 * `run-prompt.ts`), the interactive TUI builds its harness through the
 * SDK's v2-backed client (see `run-shell.ts`), and `pythinker doctor` validates
 * config.toml against the v2 section registry (see `sub/doctor.ts` /
 * `v2/validate-config.ts`), all instead of the default v1 engine. The
 * master switch also enables every experimental feature flag in the engine. Read directly from the env (matching
 * `cli/update/rollout.ts`) because the CLI must not depend on the core flag
 * registry. Unset / any non-truthy value keeps the v1 path.
 *
 * Note: `pythinker web` always boots kap-server (the agent-core-v2 engine
 * server) — it does not consult this switch.
 */

export const PYTHINKER_V2_ENV = 'PYTHINKER_CODE_EXPERIMENTAL_FLAG';
export const PYTHINKER_ACP_V2_ENV = 'PYTHINKER_CODE_EXPERIMENTAL_ACP_V2';

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

function isTruthyEnv(
  key: string,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return TRUTHY_VALUES.has((env[key] ?? '').trim().toLowerCase());
}

export function isPythinkerV2Enabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return isTruthyEnv(PYTHINKER_V2_ENV, env);
}

export function isAcpV2Enabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return isTruthyEnv(PYTHINKER_ACP_V2_ENV, env) || isPythinkerV2Enabled(env);
}
