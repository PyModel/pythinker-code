import { derefJsonSchema, normalizePythinkerToolSchema } from '#/providers/pythinker-schema';
import { describe, expect, it, vi } from 'vitest';

describe('derefJsonSchema', () => {
  it('returns schema unchanged when there are no $ref', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    };

    const result = derefJsonSchema(schema);

    expect(result).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    });
  });

  it('resolves a simple $ref from $defs', () => {
    const schema = {
      type: 'object',
      properties: {
        address: { $ref: '#/$defs/Address' },
      },
      $defs: {
        Address: {
          type: 'object',
          properties: {
            street: { type: 'string' },
            city: { type: 'string' },
          },
        },
      },
    };

    const result = derefJsonSchema(schema);

    expect(result).toEqual({
      type: 'object',
      properties: {
        address: {
          type: 'object',
          properties: {
            street: { type: 'string' },
            city: { type: 'string' },
          },
        },
      },
    });
    // $defs should be removed from the result.
    expect(result['$defs']).toBeUndefined();
  });

  it('preserves sibling keywords alongside $ref (e.g. description)', () => {
    const schema = {
      type: 'object',
      properties: {
        user: {
          $ref: '#/$defs/User',
          description: 'Custom description on the ref site',
        },
      },
      $defs: {
        User: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        },
      },
    };

    const result = derefJsonSchema(schema);

    const user = (result['properties'] as Record<string, Record<string, unknown>>)['user']!;
    // Resolved definition fields are present.
    expect(user['type']).toBe('object');
    expect(user['properties']).toEqual({ name: { type: 'string' } });
    // Local sibling "description" is preserved.
    expect(user['description']).toBe('Custom description on the ref site');
  });

  it('local sibling fields override same-named fields from $defs', () => {
    const schema = {
      type: 'object',
      properties: {
        field: {
          $ref: '#/$defs/Widget',
          // Local override must win over the def's description.
          description: 'local override wins',
        },
      },
      $defs: {
        Widget: {
          type: 'string',
          description: 'description from $defs',
          default: 'hello',
        },
      },
    };

    const result = derefJsonSchema(schema);

    const field = (result['properties'] as Record<string, Record<string, unknown>>)['field']!;
    expect(field['type']).toBe('string');
    // Local sibling wins.
    expect(field['description']).toBe('local override wins');
    // Non-overlapping def fields still flow through.
    expect(field['default']).toBe('hello');
  });

  it('preserves sibling $ref keywords that themselves contain $ref (recursively resolved)', () => {
    const schema = {
      type: 'object',
      properties: {
        entry: {
          $ref: '#/$defs/Wrapper',
          extra: { $ref: '#/$defs/Inner' },
        },
      },
      $defs: {
        Wrapper: {
          type: 'object',
          properties: { a: { type: 'number' } },
        },
        Inner: {
          type: 'object',
          properties: { b: { type: 'boolean' } },
        },
      },
    };

    const result = derefJsonSchema(schema);

    const entry = (result['properties'] as Record<string, Record<string, unknown>>)['entry']!;
    expect(entry['type']).toBe('object');
    expect(entry['properties']).toEqual({ a: { type: 'number' } });
    // Sibling `extra` must have been recursively resolved (not left as a $ref).
    expect(entry['extra']).toEqual({
      type: 'object',
      properties: { b: { type: 'boolean' } },
    });
  });

  it('preserves $defs when cyclic refs remain unresolved', () => {
    // A references B, B references A — classic cycle. resolveNode() leaves
    // a `#/$defs/...` pointer on at least one side; the validator will need
    // $defs to stay around to resolve those dangling pointers.
    const schema = {
      type: 'object',
      properties: {
        a: { $ref: '#/$defs/A' },
      },
      $defs: {
        A: {
          type: 'object',
          properties: {
            next: { $ref: '#/$defs/B' },
          },
        },
        B: {
          type: 'object',
          properties: {
            back: { $ref: '#/$defs/A' },
          },
        },
      },
    };

    const result = derefJsonSchema(schema);

    expect(result).toMatchObject({
      $defs: {
        A: expect.any(Object),
        B: expect.any(Object),
      },
    });

    // Walk the result and confirm at least one remaining $ref points at $defs —
    // i.e. the output is internally consistent, not dangling.
    const jsonText = JSON.stringify(result);
    expect(jsonText).toContain('"$ref":"#/$defs/');
  });

  it('still deletes $defs when there are no cyclic refs', () => {
    // Sanity: a non-cyclic schema with $defs should have its $defs removed
    // after dereferencing (existing behavior must not regress).
    const schema = {
      type: 'object',
      properties: {
        name: { $ref: '#/$defs/Name' },
      },
      $defs: {
        Name: { type: 'string' },
      },
    };

    const result = derefJsonSchema(schema);
    expect(result['$defs']).toBeUndefined();
    expect(result['properties']).toEqual({ name: { type: 'string' } });
  });

  it('resolves nested $ref from $defs', () => {
    const schema = {
      type: 'object',
      properties: {
        person: { $ref: '#/$defs/Person' },
      },
      $defs: {
        Person: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            address: { $ref: '#/$defs/Address' },
          },
        },
        Address: {
          type: 'object',
          properties: {
            street: { type: 'string' },
            city: { type: 'string' },
          },
        },
      },
    };

    const result = derefJsonSchema(schema);

    expect(result).toEqual({
      type: 'object',
      properties: {
        person: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            address: {
              type: 'object',
              properties: {
                street: { type: 'string' },
                city: { type: 'string' },
              },
            },
          },
        },
      },
    });
    expect(result['$defs']).toBeUndefined();
  });

  it('resolves a local $ref from draft-7 definitions', () => {
    const schema = {
      type: 'object',
      properties: {
        mode: { $ref: '#/definitions/Mode' },
      },
      definitions: {
        Mode: { enum: ['fast', 'safe'] },
      },
    };

    const result = derefJsonSchema(schema);

    expect(result).toEqual({
      type: 'object',
      properties: {
        mode: { enum: ['fast', 'safe'] },
      },
    });
    expect(result['definitions']).toBeUndefined();
  });
});

describe('normalizePythinkerToolSchema', () => {
  it.each([
    {
      name: 'string enum',
      property: { enum: ['none', 'start', 'end'] },
      expectedType: 'string',
    },
    {
      name: 'integer enum',
      property: { enum: [1, 2, 3] },
      expectedType: 'integer',
    },
    {
      name: 'mixed integer and float enum collapses to number',
      property: { enum: [1.5, 2] },
      expectedType: 'number',
    },
    {
      name: 'boolean enum',
      property: { enum: [true, false] },
      expectedType: 'boolean',
    },
    {
      name: 'single boolean enum',
      property: { enum: [true] },
      expectedType: 'boolean',
    },
    {
      name: 'null-only enum',
      property: { enum: [null] },
      expectedType: 'null',
    },
    {
      name: 'string const',
      property: { const: 'event' },
      expectedType: 'string',
    },
    {
      name: 'integer const',
      property: { const: 3 },
      expectedType: 'integer',
    },
    {
      name: 'number const',
      property: { const: 1.25 },
      expectedType: 'number',
    },
    {
      name: 'boolean const',
      property: { const: true },
      expectedType: 'boolean',
    },
  ])(
    'infers $name property type without mutating the original schema',
    ({ property, expectedType }) => {
      const schema = {
        type: 'object',
        properties: {
          target: property,
        },
      };
      const original = structuredClone(schema);

      const result = normalizePythinkerToolSchema(schema);

      expect(result).toEqual({
        type: 'object',
        properties: {
          target: { ...property, type: expectedType },
        },
      });
      expect(schema).toEqual(original);
      expect(result).not.toBe(schema);
    },
  );

  it('leaves explicitly typed enum properties untouched', () => {
    const schema = {
      type: 'object',
      properties: {
        explicit: { type: 'string', enum: ['already-typed'] },
      },
    };

    const result = normalizePythinkerToolSchema(schema);

    expect(result).toEqual({
      type: 'object',
      properties: {
        explicit: { type: 'string', enum: ['already-typed'] },
      },
    });
  });

  it('repairs mismatched explicit type when enum values contradict it', () => {
    // Regression: Xcode MCP (xcrun mcpbridge) Version 26.5 (17F42) and later
    // generates schemas where String-backed Swift enums incorrectly carry
    // type: 'object' alongside string enum values. We overwrite the contradictory
    // type and strip object/array structure keys that are no longer relevant.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const schema = {
      type: 'object',
      properties: {
        operation: {
          type: 'object',
          enum: ['move', 'copy'],
          properties: {
            rawValue: { type: 'string' },
          },
          required: ['rawValue'],
        },
      },
    };

    try {
      const result = normalizePythinkerToolSchema(schema);

      expect(result).toEqual({
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['move', 'copy'],
          },
        },
      });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('repairs mismatched explicit type when const value contradicts it', () => {
    const schema = {
      type: 'object',
      properties: {
        mode: { type: 'object', const: 'fast' },
      },
    };

    const result = normalizePythinkerToolSchema(schema);

    expect(result).toEqual({
      type: 'object',
      properties: {
        mode: { type: 'string', const: 'fast' },
      },
    });
  });

  it('leaves mixed enum types with explicit type untouched to surface provider error', () => {
    const schema = {
      type: 'object',
      properties: {
        bad: { type: 'object', enum: ['move', 1] },
      },
    };

    // inferTypeFromValues throws for mixed types; we should not overwrite the
    // explicit type so the downstream provider validator can report the issue.
    expect(() => normalizePythinkerToolSchema(schema)).not.toThrow();
    const result = normalizePythinkerToolSchema(schema);
    expect(result).toEqual({
      type: 'object',
      properties: {
        bad: { type: 'object', enum: ['move', 1] },
      },
    });
  });

  it('infers object and array property types from container enum/const values', () => {
    const schema = {
      type: 'object',
      properties: {
        object_enum: { enum: [{ a: 1 }, { a: 2 }] },
        array_enum: { enum: [[1, 2], [3]] },
        object_const: { const: { kind: 'default' } },
        array_const: { const: [] },
      },
    };

    const result = normalizePythinkerToolSchema(schema);

    expect(result).toEqual({
      type: 'object',
      properties: {
        object_enum: { enum: [{ a: 1 }, { a: 2 }], type: 'object' },
        array_enum: { enum: [[1, 2], [3]], type: 'array' },
        object_const: { const: { kind: 'default' }, type: 'object' },
        array_const: { const: [], type: 'array' },
      },
    });
  });

  it('fails fast for mixed enum types instead of emitting an unsupported Pythinker type array', () => {
    const schema = {
      type: 'object',
      properties: {
        mixedEnum: { enum: ['auto', 1] },
      },
    };
    const original = structuredClone(schema);

    expect(() => normalizePythinkerToolSchema(schema)).toThrow(
      /Mixed JSON Schema enum or const types are not supported/,
    );
    expect(schema).toEqual(original);
  });

  it('infers object and array structure recursively', () => {
    const schema = {
      properties: {
        filters: {
          properties: {
            language: { enum: ['typescript', 'python'] },
            tags: {
              items: { enum: ['bug', 'feature'] },
            },
          },
          required: ['language'],
        },
        edits: {
          items: {
            properties: {
              path: { const: 'src/index.ts' },
              lineNumbers: {
                items: { const: 42 },
              },
            },
          },
        },
      },
    };

    const result = normalizePythinkerToolSchema(schema);

    expect(result).toEqual({
      properties: {
        filters: {
          type: 'object',
          properties: {
            language: { enum: ['typescript', 'python'], type: 'string' },
            tags: {
              type: 'array',
              items: { enum: ['bug', 'feature'], type: 'string' },
            },
          },
          required: ['language'],
        },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { const: 'src/index.ts', type: 'string' },
              lineNumbers: {
                type: 'array',
                items: { const: 42, type: 'integer' },
              },
            },
          },
        },
      },
    });
  });

  it('uses structural hints before falling back to string on nested typeless schemas', () => {
    const schema = {
      properties: {
        path: { pattern: '^src/' },
        limit: { minimum: 1 },
        freeform: { description: 'Unconstrained external MCP field.' },
        empty: {},
      },
    };

    const result = normalizePythinkerToolSchema(schema);

    expect(result).toEqual({
      properties: {
        path: { pattern: '^src/', type: 'string' },
        limit: { minimum: 1, type: 'number' },
        freeform: { description: 'Unconstrained external MCP field.', type: 'string' },
        empty: { type: 'string' },
      },
    });
  });

  it('does not default the root schema itself to string', () => {
    expect(normalizePythinkerToolSchema({})).toEqual({});
  });

  it('drops a root anyOf that refines the root itself', () => {
    // The TaskStop shape: `anyOf` says "one of these two fields is required".
    // A tool's parameters must stay an object, so the branch form is unusable
    // here and the requirement falls back to the tool's own runtime check.
    const properties = {
      task_id: { type: 'string' },
      shell_id: { type: 'string' },
    };

    const result = normalizePythinkerToolSchema({
      type: 'object',
      description: 'Root doc.',
      properties,
      additionalProperties: false,
      anyOf: [{ required: ['task_id'] }, { required: ['shell_id'] }],
    });

    expect(result).toEqual({
      type: 'object',
      description: 'Root doc.',
      properties,
      additionalProperties: false,
    });
  });

  it('keeps the arguments of a root anyOf whose branches hold the properties', () => {
    const result = normalizePythinkerToolSchema({
      anyOf: [
        { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
        { type: 'object', properties: { shell_id: { type: 'string' } }, required: ['shell_id'] },
      ],
    });

    expect(result).toEqual({
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        shell_id: { type: 'string' },
      },
    });
  });

  it('distributes into nested anyOf nodes and keeps narrower branch keywords', () => {
    const result = normalizePythinkerToolSchema({
      type: 'object',
      properties: {
        target: {
          type: 'array',
          items: { type: 'string' },
          anyOf: [{ minItems: 1 }, { items: { type: 'integer' } }],
        },
      },
    });

    expect(result).toEqual({
      type: 'object',
      properties: {
        target: {
          anyOf: [
            { type: 'array', items: { type: 'string' }, minItems: 1 },
            { type: 'array', items: { type: 'integer' } },
          ],
        },
      },
    });
  });

  it('leaves anyOf nodes alone when the parent only carries metadata', () => {
    const schema = {
      type: 'object',
      properties: {
        qs: {
          description: 'A query, or a list of them.',
          anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
        },
      },
    };

    expect(normalizePythinkerToolSchema(schema)).toEqual(schema);
  });

  it('keeps cyclic $ref and definition buckets on the parent of an anyOf', () => {
    const result = normalizePythinkerToolSchema({
      type: 'object',
      properties: {
        node: {
          anyOf: [{ $ref: '#/$defs/Node' }, { type: 'null' }],
        },
      },
      $defs: {
        Node: {
          type: 'object',
          properties: { next: { $ref: '#/$defs/Node' } },
        },
      },
    });

    expect(result['$defs']).toBeDefined();
  });

  it('dereferences and normalizes local definition buckets', () => {
    const schema = {
      type: 'object',
      properties: {
        mode: { $ref: '#/$defs/Mode' },
        retryCount: { $ref: '#/definitions/RetryCount' },
      },
      $defs: {
        Mode: { enum: ['fast', 'safe'] },
      },
      definitions: {
        RetryCount: { const: 3 },
      },
    };

    const result = normalizePythinkerToolSchema(schema);

    expect(result).toEqual({
      type: 'object',
      properties: {
        mode: { enum: ['fast', 'safe'], type: 'string' },
        retryCount: { const: 3, type: 'integer' },
      },
    });
  });

  it('normalizes nested child schema positions', () => {
    const thenKeyword = ['th', 'en'].join('');
    const schema = {
      properties: {
        labels: {
          patternProperties: {
            '^x-': { enum: ['yes', 'no'] },
          },
          propertyNames: { pattern: '^x-' },
          additionalProperties: { const: false },
        },
        tuple: {
          prefixItems: [{ enum: ['left', 'right'] }, { const: 2 }],
          contains: { enum: ['needle'] },
        },
        conditional: {
          if: { properties: { kind: { const: 'file' } } },
          [thenKeyword]: { properties: { path: { pattern: '^src/' } } },
          else: { properties: { url: { format: 'uri' } } },
          not: { properties: { blocked: { const: true } } },
        },
      },
    };

    const result = normalizePythinkerToolSchema(schema);

    expect(result).toEqual({
      properties: {
        labels: {
          type: 'object',
          patternProperties: {
            '^x-': { enum: ['yes', 'no'], type: 'string' },
          },
          propertyNames: { pattern: '^x-', type: 'string' },
          additionalProperties: { const: false, type: 'boolean' },
        },
        tuple: {
          type: 'array',
          prefixItems: [
            { enum: ['left', 'right'], type: 'string' },
            { const: 2, type: 'integer' },
          ],
          contains: { enum: ['needle'], type: 'string' },
        },
        conditional: {
          if: {
            type: 'object',
            properties: { kind: { const: 'file', type: 'string' } },
          },
          [thenKeyword]: {
            type: 'object',
            properties: { path: { pattern: '^src/', type: 'string' } },
          },
          else: {
            type: 'object',
            properties: { url: { format: 'uri', type: 'string' } },
          },
          not: {
            type: 'object',
            properties: { blocked: { const: true, type: 'boolean' } },
          },
        },
      },
    });
  });

  it('infers parent types from every walked child-schema keyword', () => {
    const schema = {
      properties: {
        dependentSchemasOnly: {
          dependentSchemas: {
            kind: {
              properties: {
                value: { enum: ['file', 'url'] },
              },
            },
          },
        },
        dependenciesOnly: {
          dependencies: {
            kind: {
              properties: {
                enabled: { const: true },
              },
            },
          },
        },
        unevaluatedPropertiesOnly: {
          unevaluatedProperties: { enum: ['allowed'] },
        },
        additionalItemsOnly: {
          additionalItems: { const: 1 },
        },
        unevaluatedItemsOnly: {
          unevaluatedItems: { const: 2 },
        },
        contentSchemaOnly: {
          contentSchema: {
            properties: {
              decoded: { enum: ['payload'] },
            },
          },
        },
      },
    };

    const result = normalizePythinkerToolSchema(schema);

    expect(result).toEqual({
      properties: {
        dependentSchemasOnly: {
          type: 'object',
          dependentSchemas: {
            kind: {
              type: 'object',
              properties: {
                value: { enum: ['file', 'url'], type: 'string' },
              },
            },
          },
        },
        dependenciesOnly: {
          type: 'object',
          dependencies: {
            kind: {
              type: 'object',
              properties: {
                enabled: { const: true, type: 'boolean' },
              },
            },
          },
        },
        unevaluatedPropertiesOnly: {
          type: 'object',
          unevaluatedProperties: { enum: ['allowed'], type: 'string' },
        },
        additionalItemsOnly: {
          type: 'array',
          additionalItems: { const: 1, type: 'integer' },
        },
        unevaluatedItemsOnly: {
          type: 'array',
          unevaluatedItems: { const: 2, type: 'integer' },
        },
        contentSchemaOnly: {
          type: 'string',
          contentSchema: {
            type: 'object',
            properties: {
              decoded: { enum: ['payload'], type: 'string' },
            },
          },
        },
      },
    });
  });

  it('preserves combinators while normalizing their schema branches', () => {
    const schema = {
      properties: {
        combined: {
          anyOf: [{ enum: ['auto', 'manual'] }, { const: false }],
          oneOf: [
            {
              properties: {
                strategy: { enum: ['replace', 'insert'] },
              },
            },
          ],
          allOf: [
            {
              items: { const: 1 },
            },
          ],
        },
      },
    };

    const result = normalizePythinkerToolSchema(schema);

    expect(result['properties']).toEqual({
      combined: {
        anyOf: [
          { enum: ['auto', 'manual'], type: 'string' },
          { const: false, type: 'boolean' },
        ],
        oneOf: [
          {
            type: 'object',
            properties: {
              strategy: { enum: ['replace', 'insert'], type: 'string' },
            },
          },
        ],
        allOf: [
          {
            type: 'array',
            items: { const: 1, type: 'integer' },
          },
        ],
      },
    });
    expect(result).not.toHaveProperty('type');
  });
});
