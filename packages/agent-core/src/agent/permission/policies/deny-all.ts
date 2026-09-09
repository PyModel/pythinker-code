import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';

/**
 * Denies every tool call except the read-only ones a side question may use to
 * inspect current file contents.
 */
export class DenyAllPermissionPolicy implements PermissionPolicy {
  readonly name = 'deny-all';

  constructor(
    private readonly message: string,
    private readonly allowed: ReadonlySet<string> = new Set(),
  ) {}

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    if (this.allowed.has(context.toolCall.name)) return undefined;
    return {
      kind: 'deny',
      message: this.message,
      reason: { source: 'side_question' },
    };
  }
}
