# Policy schema

`architecture-policy.yaml` contains `version: 1`, `modules`, global thresholds and optional exceptions. The current parser is `scripts/architecture/policy.mjs`.

Each module declares an `id`, one or more `roots`, optional `managed: true`, `requires`, `publicEntrypoints`, `layers`, `layerOrder` and `owner`. Existing legacy modules can remain unmanaged. Dependencies must name registered module IDs.

Global keys are `maxFileLines`, `maxContractLines`, `maxPublicMethods`, `forbidCycles`, `forbidDeepImports` and `managedOnly`. Layer names and ordering come from each module's configuration; do not assume a global layer list.

The policy owns module topology. A managed module's `module.ts` declares local dependencies; keep it consistent with the policy. Verify supported options in the parser before documenting or using them.
