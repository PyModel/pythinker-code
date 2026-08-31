// apps/pythinker-web/src/lib/parseDynamicWorkflowResult.ts
// Parse the `<agent_dynamic_workflow_result>` payload returned by the AgentDynamicWorkflow tool
// (see packages/agent-core/.../agent-dynamic_workflow.ts renderDynamicWorkflowResults). The result
// arrives as a plain string inside the toolResult output; the dynamic_workflow card turns
// it into a structured aggregate view. Defensive: never throws.

import type { AppSubagentRouting } from '../api/types';

export interface DynamicWorkflowResultSubagent {
  outcome: string;
  item?: string;
  agentId?: string;
  mode?: string;
  state?: string;
  /** Durable binding attributes written by the engine (absent on older results). */
  profile?: string;
  model?: string;
  thinking?: string;
  routing?: AppSubagentRouting;
  startedAt?: string;
  completedAt?: string;
  body: string;
}

export interface DynamicWorkflowResult {
  /** Raw summary line, e.g. `completed: 8, failed: 2`. */
  summary: string;
  completed: number;
  failed: number;
  aborted: number;
  total: number;
  subagents: DynamicWorkflowResultSubagent[];
  resumeHint?: string;
}

const SUMMARY_RE = /<summary>([\s\S]*?)<\/summary>/;
const RESUME_HINT_RE = /<resume_hint>([\s\S]*?)<\/resume_hint>/;
// Marks either a subagent opening tag (captures attributes) or a `</subagent>`
// closing tag. Body parsing tracks a depth for legacy unescaped payloads so
// literal `<subagent ..>` / `</subagent>` text inside a row's body does not
// register as a top-level row. Current producers XML-encode ambiguous bodies.
const TOKEN_RE = /<subagent\b([^>]*)>|<\/subagent>/g;
const SUBAGENT_CLOSE = '</subagent>';
const COUNT_RE = /(completed|failed|aborted):\s*(\d+)/g;
const ATTR_RE = /([a-z_]+)="([^"]*)"/g;

function unescapeAttr(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(raw)) !== null) {
    attrs[m[1]!] = unescapeAttr(m[2]!);
  }
  return attrs;
}

function parseCounts(summary: string): Pick<DynamicWorkflowResult, 'completed' | 'failed' | 'aborted'> {
  const counts = { completed: 0, failed: 0, aborted: 0 };
  COUNT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COUNT_RE.exec(summary)) !== null) {
    const key = m[1] as 'completed' | 'failed' | 'aborted';
    counts[key] = Number(m[2]);
  }
  return counts;
}

type RowFrame = { attrs: string; bodyStart: number };

function parseRouting(parsed: Record<string, string>): AppSubagentRouting | undefined {
  const operation = parsed['mode'] === 'resume' ? 'resume' : undefined;
  const profileSource = parsed['profile_source'];
  const modelSource = parsed['model_source'];
  const policyMode = parsed['policy_mode'];
  const policySource = parsed['policy_source'];
  const featureSource = parsed['feature_source'];
  const routingEnvRevision = parsed['routing_env_revision'];
  const routeDecision = parsed['route_decision'];
  if (
    profileSource === undefined ||
    modelSource === undefined ||
    policyMode === undefined ||
    policySource === undefined ||
    featureSource === undefined ||
    routingEnvRevision === undefined ||
    routeDecision === undefined
  ) {
    return undefined;
  }
  return {
    operation: operation ?? (modelSource === 'fork-inherit' ? 'fork' : 'spawn'),
    profileSource: profileSource as AppSubagentRouting['profileSource'],
    modelSource: modelSource as AppSubagentRouting['modelSource'],
    policyMode: policyMode as AppSubagentRouting['policyMode'],
    policySource: policySource as AppSubagentRouting['policySource'],
    featureSource: featureSource as AppSubagentRouting['featureSource'],
    routingEnvRevision,
    routeDecision,
  };
}

function parseSubagent(attrs: string, body: string): DynamicWorkflowResultSubagent {
  const parsed = parseAttrs(attrs);
  const sub: DynamicWorkflowResultSubagent = {
    outcome: parsed['outcome'] ?? 'completed',
    item: parsed['item'],
    agentId: parsed['agent_id'],
    mode: parsed['mode'],
    state: parsed['state'],
    body: (parsed['body_encoding'] === 'xml' ? unescapeAttr(body) : body).trim(),
  };
  if (parsed['profile'] !== undefined) sub.profile = parsed['profile'];
  if (parsed['model'] !== undefined) sub.model = parsed['model'];
  if (parsed['thinking'] !== undefined) sub.thinking = parsed['thinking'];
  const routing = parseRouting(parsed);
  if (routing !== undefined) sub.routing = routing;
  if (parsed['started_at'] !== undefined) sub.startedAt = parsed['started_at'];
  if (parsed['completed_at'] !== undefined) sub.completedAt = parsed['completed_at'];
  return sub;
}

function parseSubagents(text: string): DynamicWorkflowResultSubagent[] {
  const subs: DynamicWorkflowResultSubagent[] = [];
  // Each stack frame is either a real top-level row (carries attrs + the body
  // start offset) or `null` for a nested literal `<subagent ..>` matched inside
  // another row's body so nested tags don't register as their own result row.
  const stack: (RowFrame | null)[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m[0] === SUBAGENT_CLOSE) {
      if (stack.length === 0) continue;
      const frame = stack.pop()!;
      // Pop balances this close with its matching opening. A frame is real only
      // when it sits on a then-empty stack, i.e. a top-level row.
      if (frame && stack.length === 0) {
        subs.push(parseSubagent(frame.attrs, text.slice(frame.bodyStart, m.index)));
      }
    } else if (stack.length === 0) {
      stack.push({ attrs: m[1] ?? '', bodyStart: TOKEN_RE.lastIndex });
    } else {
      stack.push(null);
    }
  }
  return subs;
}

export function parseDynamicWorkflowResult(output: string[] | string | undefined | null): DynamicWorkflowResult | null {
  if (output === undefined || output === null) return null;
  const text = Array.isArray(output) ? output.join('\n') : output;
  if (!text.includes('<agent_dynamic_workflow_result>')) return null;

  const summary = SUMMARY_RE.exec(text)?.[1]?.trim() ?? '';
  const { completed, failed, aborted } = parseCounts(summary);
  const resumeHint = RESUME_HINT_RE.exec(text)?.[1]?.trim();
  const subagents = parseSubagents(text);

  const totalFromSummary = completed + failed + aborted;
  return {
    summary,
    completed,
    failed,
    aborted,
    total: totalFromSummary > 0 ? totalFromSummary : subagents.length,
    subagents,
    resumeHint,
  };
}
