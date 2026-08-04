/**
 * Dereference all `$ref` references in a JSON Schema by inlining definitions
 * from local JSON pointers such as `$defs` and draft-7 `definitions`. Resolved
 * top-level definition buckets are removed from the result.
 *
 * Circular references are detected and left as `$ref` to avoid infinite
 * recursion; in that case the referenced definition bucket is preserved so the
 * remaining local `$ref` pointers stay resolvable to a JSON Schema validator.
 */
export function derefJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const visited = new Set<string>();
  const result = resolveNode(schema, schema, visited) as Record<string, unknown>;

  // Only delete definition buckets if no refs into them remain in the result.
  // Cyclic refs are intentionally preserved by resolveNode() and still need
  // their definition buckets; dropping them would leave dangling pointers.
  if (!hasUnresolvedDefinitionRef(result, '$defs')) {
    delete result['$defs'];
  }
  if (!hasUnresolvedDefinitionRef(result, 'definitions')) {
    delete result['definitions'];
  }
  return result;
}

type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
type SchemaSlotKind = 'single' | 'array' | 'map' | 'schema-or-array';
type StructuralJsonSchemaType = Extract<JsonSchemaType, 'string' | 'object' | 'array'>;

interface ChildSchemaSlot {
  key: string;
  kind: SchemaSlotKind;
  parentType?: StructuralJsonSchemaType;
}

const TYPE_COMPLETION_SKIP_KEYS = new Set([
  '$ref',
  'allOf',
  'anyOf',
  'else',
  'if',
  'not',
  'oneOf',
  'then',
]);

// Child-schema positions that this Pythinker normalizer knows how to walk. This is
// also the source of truth for child-schema keywords that imply the parent
// schema's type. It is not a list of keywords that Pythoughts accepts on the wire.
const CHILD_SCHEMA_SLOTS = [
  { key: '$defs', kind: 'map' },
  { key: 'definitions', kind: 'map' },
  { key: 'dependencies', kind: 'map', parentType: 'object' },
  { key: 'dependentSchemas', kind: 'map', parentType: 'object' },
  { key: 'patternProperties', kind: 'map', parentType: 'object' },
  { key: 'properties', kind: 'map', parentType: 'object' },
  { key: 'additionalItems', kind: 'single', parentType: 'array' },
  { key: 'additionalProperties', kind: 'single', parentType: 'object' },
  { key: 'contains', kind: 'single', parentType: 'array' },
  { key: 'contentSchema', kind: 'single', parentType: 'string' },
  { key: 'else', kind: 'single' },
  { key: 'if', kind: 'single' },
  { key: 'not', kind: 'single' },
  { key: 'propertyNames', kind: 'single', parentType: 'object' },
  { key: 'then', kind: 'single' },
  { key: 'unevaluatedItems', kind: 'single', parentType: 'array' },
  { key: 'unevaluatedProperties', kind: 'single', parentType: 'object' },
  { key: 'allOf', kind: 'array' },
  { key: 'anyOf', kind: 'array' },
  { key: 'oneOf', kind: 'array' },
  { key: 'prefixItems', kind: 'array', parentType: 'array' },
  { key: 'items', kind: 'schema-or-array', parentType: 'array' },
] as const satisfies readonly ChildSchemaSlot[];

const OBJECT_STRUCTURE_KEYS = new Set([
  ...childSchemaKeysForParentType('object'),
  'dependentRequired',
  'maxProperties',
  'minProperties',
  'required',
]);

const ARRAY_STRUCTURE_KEYS = new Set([
  ...childSchemaKeysForParentType('array'),
  'maxContains',
  'maxItems',
  'minContains',
  'minItems',
  'uniqueItems',
]);

const STRING_STRUCTURE_KEYS = new Set([
  ...childSchemaKeysForParentType('string'),
  'contentEncoding',
  'contentMediaType',
  'format',
  'maxLength',
  'minLength',
  'pattern',
]);

const NUMERIC_STRUCTURE_KEYS = new Set([
  'exclusiveMaximum',
  'exclusiveMinimum',
  'maximum',
  'minimum',
  'multipleOf',
]);

/**
 * Return a deep-cloned JSON Schema with missing `type` fields filled in for
 * Pythinker tool compatibility.
 *
 * Pythoughts's tool validator rejects some valid JSON Schema shapes when nested
 * property schemas omit `type` (for example enum-only MCP properties). This is
 * a provider-compatibility normalizer, not a complete JSON Schema compiler:
 * it resolves local refs, preserves combinator nodes, infers obvious
 * scalar/object/array types, and falls back to `string` only for nested
 * typeless property schemas. The root schema object is treated as a container
 * and is not itself type-normalized, with one exception: an `anyOf` at the root
 * is folded away, because a tool's parameters must be a plain object.
 */
export function normalizePythinkerToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return ensurePythinkerPropertyTypes(derefJsonSchema(schema));
}

function ensurePythinkerPropertyTypes(schema: Record<string, unknown>): Record<string, unknown> {
  const normalized = cloneJsonValue(schema);
  if (!isRecord(normalized)) {
    throw new Error('JSON Schema root must normalize to an object.');
  }
  // Fold the root's `anyOf` away before recursing; once it is gone the generic
  // per-node distribution below sees nothing to do at the root.
  foldRootAnyOf(normalized);
  recurseSchema(normalized);
  return normalized;
}

/**
 * Remove an `anyOf` sitting at the root of a tool's parameter schema.
 *
 * A tool's parameters must be an object, so the root cannot use the branch form
 * that {@link distributeAnyOfParentKeywords} produces for every other node: the
 * wire requires `type: "object"` there, and rejects `type` next to `anyOf`. The
 * two constraints are jointly unsatisfiable, so the root's `anyOf` is dropped.
 *
 * Dropping only ever widens what the schema accepts — a root `anyOf` is almost
 * always a "one of these fields is required" hint, which the tool re-checks when
 * it runs. Branch properties are folded into the root first, so a schema that
 * kept its arguments inside the branches does not lose them.
 */
function foldRootAnyOf(root: Record<string, unknown>): void {
  const branches = root['anyOf'];
  if (!Array.isArray(branches) || !branches.every(isRecord)) {
    return;
  }
  delete root['anyOf'];

  const rootProperties = root['properties'];
  const alternativesByName = new Map<string, unknown[]>();
  if (isRecord(rootProperties)) {
    for (const [name, property] of Object.entries(rootProperties)) {
      alternativesByName.set(name, [cloneJsonValue(property)]);
    }
  }
  for (const branch of branches) {
    const branchProperties = branch['properties'];
    if (!isRecord(branchProperties)) continue;
    for (const [name, property] of Object.entries(branchProperties)) {
      addRootPropertyAlternative(alternativesByName, name, property);
    }
  }

  if (alternativesByName.size > 0) {
    const merged: Record<string, unknown> = {};
    for (const [name, alternatives] of alternativesByName) {
      merged[name] = alternatives.length === 1 ? alternatives[0] : { anyOf: alternatives };
    }
    root['properties'] = merged;
  }
  root['type'] = 'object';
}

/**
 * Record one branch's schema for a merged root property.
 *
 * Root `anyOf` branches are alternatives, so two branches declaring the same
 * property with different schemas (e.g. `value` as a string in one branch, an
 * integer in another) must both stay representable — keeping only the first
 * one seen would silently narrow what the tool actually accepts. Identical
 * schemas collapse to one; differing schemas fold into an `anyOf` on the
 * merged property.
 */
function addRootPropertyAlternative(
  alternativesByName: Map<string, unknown[]>,
  name: string,
  property: unknown,
): void {
  const cloned = cloneJsonValue(property);
  const alternatives = alternativesByName.get(name);
  if (!alternatives) {
    alternativesByName.set(name, [cloned]);
    return;
  }
  if (!alternatives.some((existing) => deepEqualJson(existing, cloned))) {
    alternatives.push(cloned);
  }
}

function hasUnresolvedDefinitionRef(node: unknown, bucketKey: string): boolean {
  if (Array.isArray(node)) {
    return node.some((child) => hasUnresolvedDefinitionRef(child, bucketKey));
  }
  if (typeof node === 'object' && node !== null) {
    const obj = node as Record<string, unknown>;
    const ref = obj['$ref'];
    if (typeof ref === 'string' && ref.startsWith(`#/${bucketKey}/`)) {
      return true;
    }
    for (const [key, value] of Object.entries(obj)) {
      // Skip the definition bucket itself when walking the result — we only
      // care about `$ref` pointers living elsewhere in the schema.
      if (key === bucketKey) continue;
      if (hasUnresolvedDefinitionRef(value, bucketKey)) return true;
    }
    return false;
  }
  return false;
}

function resolveNode(node: unknown, root: Record<string, unknown>, visited: Set<string>): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => resolveNode(item, root, visited));
  }

  if (typeof node === 'object' && node !== null) {
    const obj = node as Record<string, unknown>;

    // Handle $ref
    if (typeof obj['$ref'] === 'string') {
      const ref = obj['$ref'];
      if (isLocalJsonPointerRef(ref)) {
        if (visited.has(ref)) {
          // Circular reference — return the $ref as-is to avoid infinite recursion
          return obj;
        }
        const resolvedRef = resolveLocalJsonPointer(root, ref);
        if (resolvedRef.found) {
          visited.add(ref);
          const resolved = resolveNode(resolvedRef.value, root, visited);
          visited.delete(ref);
          // Preserve sibling keywords (JSON Schema 2020-12 semantics):
          // a node may contain `$ref` alongside other fields like
          // `description`, `default`, or local constraints. Python's deref
          // implementation merges these with the resolved definition;
          // sibling keys on the local node take precedence.
          if (typeof resolved === 'object' && resolved !== null && !Array.isArray(resolved)) {
            const merged: Record<string, unknown> = { ...(resolved as Record<string, unknown>) };
            for (const [key, value] of Object.entries(obj)) {
              if (key === '$ref') continue;
              merged[key] = resolveNode(value, root, visited);
            }
            return merged;
          }
          return resolved;
        }
      }
      // Unknown $ref — return as-is
      return obj;
    }

    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = resolveNode(value, root, visited);
    }
    return resolved;
  }

  return node;
}

function isLocalJsonPointerRef(ref: string): boolean {
  return ref === '#' || ref.startsWith('#/');
}

function resolveLocalJsonPointer(
  root: Record<string, unknown>,
  ref: string,
): { found: true; value: unknown } | { found: false } {
  if (ref === '#') {
    return { found: true, value: root };
  }
  let current: unknown = root;
  for (const rawPart of ref.slice(2).split('/')) {
    const part = unescapeJsonPointerPart(rawPart);
    if (isRecord(current)) {
      if (!hasOwn(current, part)) {
        return { found: false };
      }
      current = current[part];
    } else if (Array.isArray(current)) {
      const index = parseJsonPointerArrayIndex(part);
      if (index === null || index >= current.length) {
        return { found: false };
      }
      current = current[index];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}

function unescapeJsonPointerPart(part: string): string {
  return part.replaceAll('~1', '/').replaceAll('~0', '~');
}

function parseJsonPointerArrayIndex(part: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(part)) {
    return null;
  }
  return Number(part);
}

function recurseSchema(node: unknown): void {
  if (!isRecord(node)) {
    return;
  }

  distributeAnyOfParentKeywords(node);
  visitChildSchemas(node, normalizeProperty);
}

/**
 * Keywords that may stay on a schema node that also carries `anyOf`.
 *
 * Everything else is a validation keyword the wire validator refuses to see on
 * both sides of an `anyOf`. Sibling combinators are left alone because the
 * validator does not read them at all, so relocating them would only churn the
 * schema. `$defs` / `definitions` stay put because cyclic `$ref` pointers
 * resolve against the root, and `$ref` stays because duplicating a cyclic
 * reference into every branch changes its meaning.
 */
const ANYOF_PARENT_KEEP_KEYS = new Set([
  '$comment',
  '$defs',
  '$ref',
  '$schema',
  'allOf',
  'anyOf',
  'default',
  'definitions',
  'description',
  'else',
  'if',
  'not',
  'oneOf',
  'then',
  'title',
]);

/**
 * Push a node's own constraints down into its `anyOf` branches.
 *
 * Pythoughts's tool validator rejects `anyOf` used as a refinement of its parent:
 * `type` must be declared inside the branches rather than beside them, and no
 * other validation keyword (`properties`, `items`, `additionalProperties`, …)
 * may appear on both the parent and a branch. Standard JSON Schema allows both,
 * so schemas that are perfectly valid elsewhere are rejected on this wire.
 *
 * Distributing is lossless: `P ∧ (B₁ ∨ B₂)` and `(P ∧ B₁) ∨ (P ∧ B₂)` accept
 * exactly the same instances — *if* a branch that already declares the same
 * keyword is merged conjunctively with the parent's value rather than simply
 * overriding it. `required` is the one keyword this function merges that way
 * (parent and branch field lists are unioned, since both are actually
 * required). Every other overlapping keyword still keeps the branch's own
 * value: a full conjunctive merge for arbitrary keywords (`properties`,
 * `items`, …) is out of scope for this compatibility normalizer.
 */
function distributeAnyOfParentKeywords(node: Record<string, unknown>): void {
  const branches = node['anyOf'];
  if (!Array.isArray(branches) || branches.length === 0 || !branches.every(isRecord)) {
    return;
  }

  const inherited = Object.keys(node).filter((key) => !ANYOF_PARENT_KEEP_KEYS.has(key));
  if (inherited.length === 0) {
    return;
  }

  for (const branch of branches) {
    for (const key of inherited) {
      if (!hasOwn(branch, key)) {
        branch[key] = cloneJsonValue(node[key]);
      } else if (key === 'required') {
        branch[key] = mergeRequired(node[key], branch[key]);
      }
    }
  }
  for (const key of inherited) {
    delete node[key];
  }
}

/**
 * Union two `required` field lists.
 *
 * A parent's `required` and a branch's own `required` are both mandatory —
 * dropping the parent's list when the branch already has one would silently
 * accept objects missing a field the parent demanded.
 */
function mergeRequired(parentValue: unknown, branchValue: unknown): unknown {
  if (!Array.isArray(parentValue) || !Array.isArray(branchValue)) {
    return branchValue;
  }
  const merged = [...branchValue];
  for (const name of parentValue) {
    if (!merged.includes(name)) {
      merged.push(name);
    }
  }
  return merged;
}

function visitChildSchemas(node: Record<string, unknown>, visit: (schema: unknown) => void): void {
  for (const { key, kind } of CHILD_SCHEMA_SLOTS) {
    const value = node[key];
    if (kind === 'single') {
      if (isRecord(value)) {
        visit(value);
      }
    } else if (kind === 'array') {
      if (Array.isArray(value)) {
        for (const item of value) {
          visit(item);
        }
      }
    } else if (kind === 'map') {
      if (isRecord(value)) {
        for (const item of Object.values(value)) {
          visit(item);
        }
      }
    } else if (kind === 'schema-or-array') {
      if (isRecord(value)) {
        visit(value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          visit(item);
        }
      }
    }
  }
}

function childSchemaKeysForParentType(parentType: StructuralJsonSchemaType): string[] {
  return CHILD_SCHEMA_SLOTS.flatMap((slot) => {
    if (!('parentType' in slot) || slot.parentType !== parentType) {
      return [];
    }
    return [slot.key];
  });
}

function normalizeProperty(node: unknown): void {
  if (!isRecord(node)) {
    return;
  }

  if (!hasOwn(node, 'type') && !hasAnyKey(node, TYPE_COMPLETION_SKIP_KEYS)) {
    const enumValues = node['enum'];
    if (Array.isArray(enumValues) && enumValues.length > 0) {
      node['type'] = inferTypeFromValues(enumValues);
    } else if (hasOwn(node, 'const')) {
      node['type'] = inferTypeFromValues([node['const']]);
    } else {
      node['type'] = inferTypeFromStructure(node);
    }
  } else if (!hasAnyKey(node, TYPE_COMPLETION_SKIP_KEYS) && typeof node['type'] === 'string') {
    // Some MCP servers emit schemas where a $ref merge or a generator bug
    // leaves an explicit type that contradicts the enum/const values (e.g.
    // type: 'object' alongside string enum values). Pythoughts rejects these
    // as invalid, so repair the type when it disagrees with the values.
    //
    // Known trigger: Xcode MCP (xcrun mcpbridge) starting with
    // Version 26.5 (17F42) generates this bug for String-backed Swift enums.
    const enumValues = node['enum'];
    if (Array.isArray(enumValues) && enumValues.length > 0) {
      try {
        const inferred = inferTypeFromValues(enumValues);
        if (node['type'] !== inferred) {
          node['type'] = inferred;
          removeIrrelevantStructureKeys(node, inferred);
        }
      } catch {
        // Mixed or uninferable enum types — leave the explicit type as-is
        // and let the provider validator surface the error.
      }
    } else if (hasOwn(node, 'const')) {
      try {
        const inferred = inferTypeFromValues([node['const']]);
        if (node['type'] !== inferred) {
          node['type'] = inferred;
          removeIrrelevantStructureKeys(node, inferred);
        }
      } catch {
        // Same as above.
      }
    }
  }

  recurseSchema(node);
}

function removeIrrelevantStructureKeys(
  node: Record<string, unknown>,
  newType: JsonSchemaType,
): void {
  if (newType !== 'object') {
    for (const key of OBJECT_STRUCTURE_KEYS) {
      delete node[key];
    }
  }
  if (newType !== 'array') {
    for (const key of ARRAY_STRUCTURE_KEYS) {
      delete node[key];
    }
  }
}

function inferTypeFromStructure(schema: Record<string, unknown>): JsonSchemaType {
  if (hasAnyKey(schema, OBJECT_STRUCTURE_KEYS)) {
    return 'object';
  }
  if (hasAnyKey(schema, ARRAY_STRUCTURE_KEYS)) {
    return 'array';
  }
  if (hasAnyKey(schema, STRING_STRUCTURE_KEYS)) {
    return 'string';
  }
  if (hasAnyKey(schema, NUMERIC_STRUCTURE_KEYS)) {
    return 'number';
  }
  return 'string';
}

function inferTypeFromValues(values: unknown[]): JsonSchemaType {
  const inferred = new Set<JsonSchemaType>();
  for (const value of values) {
    const valueType = inferValueType(value);
    if (valueType === undefined) {
      throw new Error('Cannot infer JSON Schema type from non-JSON enum or const value.');
    }
    inferred.add(valueType);
  }
  const types = normalizeInferredTypes(inferred);
  if (types.length === 1) {
    const onlyType = types[0];
    if (onlyType === undefined) {
      throw new Error('Cannot infer JSON Schema type from an empty enum.');
    }
    return onlyType;
  }
  throw new Error('Mixed JSON Schema enum or const types are not supported by Pythinker tool schemas.');
}

function inferValueType(value: unknown): JsonSchemaType | undefined {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return Number.isInteger(value) ? 'integer' : 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    case 'bigint':
    case 'function':
    case 'symbol':
    case 'undefined':
      return undefined;
  }
  return undefined;
}

function normalizeInferredTypes(types: Set<JsonSchemaType>): JsonSchemaType[] {
  const normalized = new Set(types);
  if (normalized.has('number')) {
    normalized.delete('integer');
  }
  const order: JsonSchemaType[] = [
    'string',
    'number',
    'integer',
    'boolean',
    'object',
    'array',
    'null',
  ];
  return order.filter((type) => normalized.has(type));
}

function hasAnyKey(obj: Record<string, unknown>, keys: Set<string>): boolean {
  for (const key of keys) {
    if (hasOwn(obj, key)) {
      return true;
    }
  }
  return false;
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item));
  }
  if (isRecord(value)) {
    const cloned: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      cloned[key] = cloneJsonValue(child);
    }
    return cloned;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqualJson(item, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return aKeys.length === bKeys.length && aKeys.every((key) => hasOwn(b, key) && deepEqualJson(a[key], b[key]));
  }
  return false;
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
