import {
  UNKNOWN_CAPABILITY,
  isUnknownCapability,
  type ModelCostRates,
} from '#/capability';
import { catalogModelToCapability, type CatalogModelEntry } from '#/catalog';
import { calculateCost, emptyUsage } from '#/usage';
import { describe, expect, it } from 'vitest';

function catalogModel(cost?: CatalogModelEntry['cost']): CatalogModelEntry {
  return {
    id: 'priced-model',
    limit: { context: 128_000 },
    cost,
  };
}

function normalizedCost(model: CatalogModelEntry): ModelCostRates | undefined {
  return catalogModelToCapability(model)?.capability.cost;
}

describe('catalog model costs', () => {
  it('normalizes all models.dev cost rates', () => {
    expect(
      normalizedCost(
        catalogModel({ input: 1.25, output: 5, cache_read: 0.125, cache_write: 1.5 }),
      ),
    ).toEqual({ input: 1.25, output: 5, cacheRead: 0.125, cacheWrite: 1.5 });
  });

  it('omits rates when cost data is missing or unusable', () => {
    expect(normalizedCost(catalogModel())).toBeUndefined();
    expect(normalizedCost(catalogModel({}))).toBeUndefined();
    expect(
      normalizedCost(
        catalogModel({
          input: Number.NaN,
          output: Number.POSITIVE_INFINITY,
          cache_read: -0.25,
        }),
      ),
    ).toBeUndefined();
  });

  it('keeps only finite rates from a partial cost object', () => {
    expect(
      normalizedCost(
        catalogModel({ input: 2, cache_read: 0.2, cache_write: Number.NEGATIVE_INFINITY }),
      ),
    ).toEqual({ input: 2, cacheRead: 0.2 });
  });

  it('keeps UNKNOWN_CAPABILITY unknown without cost rates', () => {
    expect(UNKNOWN_CAPABILITY.cost).toBeUndefined();
    expect(isUnknownCapability(UNKNOWN_CAPABILITY)).toBe(true);
  });
});

describe('calculateCost', () => {
  it.each([
    ['input', { inputOther: 1_000_000 }, { input: 1.25 }, 1.25],
    ['output', { output: 1_000_000 }, { output: 5 }, 5],
    ['cache read', { inputCacheRead: 1_000_000 }, { cacheRead: 0.125 }, 0.125],
    ['cache write', { inputCacheCreation: 1_000_000 }, { cacheWrite: 1.5 }, 1.5],
  ] as const)(
    'charges %s tokens at its per-million rate',
    (_tokenClass, measured, rates, expected) => {
      expect(calculateCost({ ...emptyUsage(), ...measured }, rates)).toBe(expected);
    },
  );

  it('returns no amount when a used token class has no valid rate', () => {
    const outputOnly = { ...emptyUsage(), output: 1_000_000 };

    expect(calculateCost(outputOnly, { input: 1 })).toBeUndefined();
    expect(calculateCost(outputOnly, { output: -2 })).toBeUndefined();
  });

  it('returns no amount without rates and zero for measured zero usage', () => {
    const millionInput = { ...emptyUsage(), inputOther: 1_000_000 };
    expect(calculateCost(millionInput)).toBeUndefined();
    expect(calculateCost(millionInput, {})).toBeUndefined();
    expect(calculateCost(emptyUsage(), { input: 1 })).toBe(0);
  });
});
