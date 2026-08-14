import type { ToolCall } from '@pymodel/kosong';
import { describe, expect, it } from 'vitest';

import type { PermissionPolicyContext } from '../../../src/agent/permission';
import { DefaultToolApprovePermissionPolicy } from '../../../src/agent/permission/policies/default-tool-approve';
import { ToolAccesses } from '../../../src/loop';

const signal = new AbortController().signal;

function policyContext(toolName: string, args: unknown): PermissionPolicyContext {
  return {
    turnId: '0',
    stepNumber: 1,
    signal,
    llm: {},
    args,
    toolCall: {
      type: 'function',
      id: `call_${toolName}`,
      name: toolName,
      arguments: JSON.stringify(args),
    } satisfies ToolCall,
    toolCalls: [
      {
        type: 'function',
        id: `call_${toolName}`,
        name: toolName,
        arguments: JSON.stringify(args),
      },
    ],
    execution: {
      accesses: ToolAccesses.none(),
      approvalRule: toolName,
      execute: async () => ({ output: '' }),
    },
  } as unknown as PermissionPolicyContext;
}

describe('DefaultToolApprovePermissionPolicy', () => {
  const policy = new DefaultToolApprovePermissionPolicy();

  it('auto-approves CronList', () => {
    expect(policy.evaluate(policyContext('CronList', {}))).toEqual({ kind: 'approve' });
  });

  it('auto-approves StructuredOutput', () => {
    expect(policy.evaluate(policyContext('StructuredOutput', { result: 'done' }))).toEqual({
      kind: 'approve',
    });
  });

  it('auto-approves Config reads but not writes', () => {
    expect(policy.evaluate(policyContext('Config', { setting: 'model' }))).toEqual({
      kind: 'approve',
    });
    expect(
      policy.evaluate(
        policyContext('Config', { setting: 'model', value: 'example-model' }),
      ),
    ).toBeUndefined();
  });

  it('does not approve CronCreate', () => {
    expect(
      policy.evaluate(policyContext('CronCreate', { cron: '*/5 * * * *', prompt: 'ping' })),
    ).toBeUndefined();
  });

  it('does not approve CronDelete', () => {
    expect(policy.evaluate(policyContext('CronDelete', { id: 'job_1' }))).toBeUndefined();
  });

  it('does not approve DynamicWorkflow', () => {
    expect(
      policy.evaluate(
        policyContext('DynamicWorkflow', {
          description: 'Check files',
          prompt_template: 'Check {{item}}',
          items: ['a.ts', 'b.ts'],
        }),
      ),
    ).toBeUndefined();
  });

  it('does not auto-approve URL fetching', () => {
    expect(
      policy.evaluate(policyContext('FetchURL', { url: 'https://example.com' })),
    ).toBeUndefined();
  });
});
