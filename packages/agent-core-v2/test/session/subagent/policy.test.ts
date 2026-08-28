import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ErrorCodes, isError2 } from '#/errors';
import {
  type CanonicalSubagentModelPolicy,
  INHERIT_SUBAGENT_MODEL_POLICY,
  type LegacySecondaryModelConfig,
  normalizeLegacySecondaryModel,
  normalizeLegacySecondaryModelOrInherit,
  parseCanonicalSubagentModelPolicy,
  prospectiveModelView,
  ROUTE_DECISION_FINGERPRINT_PREFIX,
  ROUTING_ENVIRONMENT_REVISION_PREFIX,
  routeDecisionFingerprint,
  routingEnvironmentRevision,
  SECONDARY_MODEL_DEFAULT_MODEL_REQUIRED_MESSAGE,
  SECONDARY_MODEL_FORCE_EXCLUDES_MODELS_MESSAGE,
  SECONDARY_MODEL_FORCE_REQUIRES_DEFAULT_MESSAGE,
  SUBAGENT_POLICY_RESOURCE_VERSION_PREFIX,
  subagentPolicyResourceVersion,
  toPersistedSecondaryModel,
  validateSubagentModelPolicy,
} from '#/session/subagent/policy';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(__dirname, '..', '..', '..', 'src');

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return isError2(error) ? error.code : 'not-error2';
  }
}

function messageOf(fn: () => unknown): string {
  try {
    fn();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('normalizeLegacySecondaryModel', () => {
  const D = 'acme/default';
  const M = 'acme/legacy';
  const POOL = { 'acme/default': 'fast', 'acme/other': '' };

  const table: Array<{
    legacy: LegacySecondaryModelConfig;
    expected: CanonicalSubagentModelPolicy | 'invalid';
  }> = [
    { legacy: {}, expected: INHERIT_SUBAGENT_MODEL_POLICY },
    { legacy: { model: M }, expected: { mode: 'default', defaultModel: M } },
    { legacy: { defaultModel: D }, expected: { mode: 'default', defaultModel: D } },
    { legacy: { defaultModel: D, model: M }, expected: { mode: 'default', defaultModel: D } },
    { legacy: { models: POOL }, expected: 'invalid' },
    { legacy: { models: POOL, model: M }, expected: 'invalid' },
    { legacy: { models: POOL, defaultModel: D }, expected: { mode: 'pool', defaultModel: D, models: POOL } },
    {
      legacy: { models: POOL, defaultModel: D, model: M },
      expected: { mode: 'pool', defaultModel: D, models: POOL },
    },
    { legacy: { force: true }, expected: 'invalid' },
    { legacy: { force: true, model: M }, expected: { mode: 'force', defaultModel: M } },
    { legacy: { force: true, defaultModel: D }, expected: { mode: 'force', defaultModel: D } },
    { legacy: { force: true, defaultModel: D, model: M }, expected: { mode: 'force', defaultModel: D } },
    { legacy: { force: true, models: POOL }, expected: 'invalid' },
    { legacy: { force: true, models: POOL, model: M }, expected: 'invalid' },
    { legacy: { force: true, models: POOL, defaultModel: D }, expected: 'invalid' },
    { legacy: { force: true, models: POOL, defaultModel: D, model: M }, expected: 'invalid' },
  ];

  it.each(table)('normalizes $legacy', ({ legacy, expected }) => {
    if (expected === 'invalid') {
      expect(codeOf(() => normalizeLegacySecondaryModel(legacy))).toBe(ErrorCodes.CONFIG_INVALID);
      expect(normalizeLegacySecondaryModelOrInherit(legacy)).toEqual(INHERIT_SUBAGENT_MODEL_POLICY);
      return;
    }
    const policy = normalizeLegacySecondaryModel(legacy);
    expect(policy).toMatchObject(expected);
    expect(policy).not.toHaveProperty('model');
    expect(policy).not.toHaveProperty('force');
  });

  it('keeps the legacy error messages for the invalid combinations', () => {
    expect(messageOf(() => normalizeLegacySecondaryModel({ force: true }))).toBe(
      SECONDARY_MODEL_FORCE_REQUIRES_DEFAULT_MESSAGE,
    );
    expect(messageOf(() => normalizeLegacySecondaryModel({ force: true, defaultModel: D, models: POOL }))).toBe(
      SECONDARY_MODEL_FORCE_EXCLUDES_MODELS_MESSAGE,
    );
    expect(messageOf(() => normalizeLegacySecondaryModel({ models: POOL }))).toBe(
      SECONDARY_MODEL_DEFAULT_MODEL_REQUIRED_MESSAGE,
    );
  });

  it('treats an absent section as inherit and never carries legacy fields', () => {
    expect(normalizeLegacySecondaryModel(undefined)).toEqual({ mode: 'inherit' });
    const withExtras = normalizeLegacySecondaryModel({
      defaultModel: D,
      defaultEffort: 'low',
      maxContextSize: 1000,
      displayName: 'x',
    });
    expect(withExtras).toEqual({ mode: 'default', defaultModel: D, defaultEffort: 'low' });
  });

  it('round-trips canonical policies through the persisted form', () => {
    const policies: CanonicalSubagentModelPolicy[] = [
      { mode: 'inherit' },
      { mode: 'default', defaultModel: D, defaultEffort: 'high' },
      { mode: 'pool', defaultModel: D, models: POOL },
      { mode: 'force', defaultModel: D },
    ];
    for (const policy of policies) {
      const persisted = toPersistedSecondaryModel(policy);
      expect(normalizeLegacySecondaryModel(persisted)).toEqual(
        JSON.parse(JSON.stringify(policy)),
      );
    }
    expect(toPersistedSecondaryModel({ mode: 'inherit' })).toBeUndefined();
    expect(toPersistedSecondaryModel({ mode: 'force', defaultModel: D })).toMatchObject({
      force: true,
    });
  });

  it('parses canonical input strictly', () => {
    expect(parseCanonicalSubagentModelPolicy({ mode: 'inherit' })).toEqual({ mode: 'inherit' });
    expect(codeOf(() => parseCanonicalSubagentModelPolicy({ mode: 'force' }))).toBe(
      ErrorCodes.CONFIG_INVALID,
    );
    expect(codeOf(() => parseCanonicalSubagentModelPolicy({ mode: 'default', defaultModel: D, force: true }))).toBe(
      ErrorCodes.CONFIG_INVALID,
    );
    expect(codeOf(() => parseCanonicalSubagentModelPolicy({ mode: 'later' }))).toBe(
      ErrorCodes.CONFIG_INVALID,
    );
  });
});

describe('validateSubagentModelPolicy', () => {
  const known = (ids: Record<string, { supportEfforts?: string[] }>) => ({
    resolveModel: (alias: string) =>
      Object.hasOwn(ids, alias) ? { id: alias, supportEfforts: ids[alias]?.supportEfforts } : undefined,
  });

  it('accepts inherit without a catalog', () => {
    expect(() =>
      validateSubagentModelPolicy({ mode: 'inherit' }, { resolveModel: () => undefined }),
    ).not.toThrow();
  });

  it('rejects unknown models, a default outside the pool, the reserved primary key, and unsupported efforts', () => {
    const ctx = known({ 'acme/a': { supportEfforts: ['low', 'high'] }, 'acme/b': {} });
    expect(codeOf(() => validateSubagentModelPolicy({ mode: 'default', defaultModel: 'acme/zzz' }, ctx))).toBe(
      ErrorCodes.CONFIG_INVALID,
    );
    expect(
      codeOf(() =>
        validateSubagentModelPolicy(
          { mode: 'pool', defaultModel: 'acme/b', models: { 'acme/a': '' } },
          ctx,
        ),
      ),
    ).toBe(ErrorCodes.CONFIG_INVALID);
    expect(
      codeOf(() =>
        validateSubagentModelPolicy(
          { mode: 'pool', defaultModel: 'acme/a', models: { 'acme/a': '', primary: '' } },
          ctx,
        ),
      ),
    ).toBe(ErrorCodes.CONFIG_INVALID);
    expect(
      codeOf(() =>
        validateSubagentModelPolicy({ mode: 'force', defaultModel: 'acme/a', defaultEffort: 'max' }, ctx),
      ),
    ).toBe(ErrorCodes.CONFIG_INVALID);
    expect(() =>
      validateSubagentModelPolicy({ mode: 'force', defaultModel: 'acme/a', defaultEffort: 'high' }, ctx),
    ).not.toThrow();
    expect(() =>
      validateSubagentModelPolicy({ mode: 'default', defaultModel: 'acme/b', defaultEffort: 'anything' }, ctx),
    ).not.toThrow();
  });

  it('resolves models from a prospective config view including aliases and provider presence', () => {
    const view = prospectiveModelView(
      { acme: { type: 'openai' } },
      {
        'acme/a': { provider: 'acme', model: 'a', aliases: ['fast'], supportEfforts: ['low'] },
        'gone/b': { provider: 'gone', model: 'b' },
      },
    );
    expect(view.resolveModel('acme/a')).toEqual({ id: 'acme/a', defaultEffort: undefined, supportEfforts: ['low'] });
    expect(view.resolveModel('fast')?.id).toBe('fast');
    expect(view.resolveModel('gone/b')).toBeUndefined();
    expect(view.resolveModel('missing')).toBeUndefined();
    expect(prospectiveModelView(undefined, undefined).resolveModel('x')).toBeUndefined();
  });
});

describe('subagentPolicyResourceVersion', () => {
  it('is strong, stable across key order and equivalent legacy spellings, and exists for the absent section', () => {
    const a = subagentPolicyResourceVersion({ defaultModel: 'acme/a', models: { x: '', y: '' } });
    const b = subagentPolicyResourceVersion({ models: { y: '', x: '' }, defaultModel: 'acme/a' });
    expect(a).toBe(b);
    expect(a.startsWith(SUBAGENT_POLICY_RESOURCE_VERSION_PREFIX)).toBe(true);
    expect(a.startsWith('W/')).toBe(false);
    expect(subagentPolicyResourceVersion({ model: 'acme/a' })).toBe(
      subagentPolicyResourceVersion({ defaultModel: 'acme/a' }),
    );
    expect(subagentPolicyResourceVersion({ defaultModel: 'acme/a', force: false })).toBe(
      subagentPolicyResourceVersion({ defaultModel: 'acme/a' }),
    );
    const absent = subagentPolicyResourceVersion(undefined);
    expect(absent.startsWith(SUBAGENT_POLICY_RESOURCE_VERSION_PREFIX)).toBe(true);
    expect(absent).not.toBe(a);
    expect(subagentPolicyResourceVersion({ defaultModel: 'acme/b' })).not.toBe(a);
    expect(subagentPolicyResourceVersion({ force: true })).not.toBe(absent);
  });
});

describe('routing revisions', () => {
  const base = {
    effectivePolicy: { mode: 'inherit' } as CanonicalSubagentModelPolicy,
    policySource: 'default' as const,
    feature: { enabled: false, source: 'default' as const },
    callerModel: 'acme/sol',
    callerThinking: 'high',
    thinkingEnabled: true,
    boundModelDefaultEffort: 'high',
  };

  it('changes only with ambient inputs and ignores key order', () => {
    const rev = routingEnvironmentRevision(base);
    expect(rev.startsWith(ROUTING_ENVIRONMENT_REVISION_PREFIX)).toBe(true);
    expect(routingEnvironmentRevision({ ...base })).toBe(rev);
    expect(routingEnvironmentRevision({ ...base, callerModel: 'acme/luna' })).not.toBe(rev);
    expect(
      routingEnvironmentRevision({ ...base, feature: { enabled: true, source: 'env' } }),
    ).not.toBe(rev);
    const pool = {
      ...base,
      effectivePolicy: {
        mode: 'pool',
        defaultModel: 'acme/a',
        models: { 'acme/a': '', 'acme/b': '' },
      } as CanonicalSubagentModelPolicy,
    };
    const poolReordered = {
      ...pool,
      effectivePolicy: {
        mode: 'pool',
        defaultModel: 'acme/a',
        models: { 'acme/b': '', 'acme/a': '' },
      } as CanonicalSubagentModelPolicy,
    };
    expect(routingEnvironmentRevision(pool)).toBe(routingEnvironmentRevision(poolReordered));
  });

  it('keeps request intent out of the environment revision and inside the decision fingerprint', () => {
    const rev = routingEnvironmentRevision(base);
    const spawnA = routeDecisionFingerprint({
      routingEnvironmentRevision: rev,
      operation: 'spawn',
      model: 'acme/a',
    });
    const spawnB = routeDecisionFingerprint({
      routingEnvironmentRevision: rev,
      operation: 'spawn',
      model: 'acme/b',
    });
    expect(spawnA.startsWith(ROUTE_DECISION_FINGERPRINT_PREFIX)).toBe(true);
    expect(spawnA).not.toBe(spawnB);
    expect(
      routeDecisionFingerprint({ routingEnvironmentRevision: rev, operation: 'spawn', model: 'acme/a' }),
    ).toBe(spawnA);
    expect(
      routeDecisionFingerprint({ routingEnvironmentRevision: rev, operation: 'fork', model: 'acme/a' }),
    ).not.toBe(spawnA);
  });
});

describe('legacy secondary-model import boundary', () => {
  const LEGACY_SYMBOLS =
    /\b(LegacySecondaryModelConfig|LegacySecondaryModelConfigSchema|normalizeLegacySecondaryModel|normalizeLegacySecondaryModelOrInherit|toPersistedSecondaryModel|SecondaryModelConfig|SecondaryModelConfigSchema)\b/;
  const ALLOWED = new Set([
    'index.ts',
    'session/subagent/policy.ts',
    'session/subagent/configSection.ts',
    'session/subagent/subagentModelPolicy.ts',
    'session/subagent/subagentModelPolicyService.ts',
  ]);
  const WRITE_RE =
    /(\.(replace|set)\(\s*SECONDARY_MODEL_SECTION\b|\[SECONDARY_MODEL_SECTION\]\s*[:=])/;
  const WRITERS = new Set([
    'session/subagent/subagentModelPolicyService.ts',
    'app/kosongConfig/discoveryService.ts',
  ]);

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) out.push(...walk(abs));
      else if (abs.endsWith('.ts')) out.push(abs);
    }
    return out;
  }

  it('only the legacy adapter, the policy service and the root index touch legacy secondary-model symbols', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file);
      if (ALLOWED.has(rel)) continue;
      const source = readFileSync(file, 'utf8');
      if (LEGACY_SYMBOLS.test(source)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('the secondary-model section is written only by the policy service or a prepared mutation', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file);
      const source = readFileSync(file, 'utf8');
      if (!WRITE_RE.test(source)) continue;
      if (WRITERS.has(rel)) {
        if (rel !== 'session/subagent/subagentModelPolicyService.ts') {
          expect(source, rel).toContain('prepareLegacyMutation(');
        }
        continue;
      }
      offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('boundary scans see a positive control', () => {
    const policySource = readFileSync(join(SRC_ROOT, 'session/subagent/policy.ts'), 'utf8');
    expect(LEGACY_SYMBOLS.test(policySource)).toBe(true);
    const serviceSource = readFileSync(
      join(SRC_ROOT, 'session/subagent/subagentModelPolicyService.ts'),
      'utf8',
    );
    expect(WRITE_RE.test(serviceSource)).toBe(true);
    const discoverySource = readFileSync(join(SRC_ROOT, 'app/kosongConfig/discoveryService.ts'), 'utf8');
    expect(WRITE_RE.test(discoverySource)).toBe(true);
  });
});
