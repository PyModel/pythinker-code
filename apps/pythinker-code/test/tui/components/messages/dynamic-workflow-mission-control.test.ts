import { visibleWidth } from '@earendil-works/pi-tui';
import chalk from 'chalk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DynamicWorkflowMissionControlComponent,
  type DynamicWorkflowMissionControlOptions,
  dynamicWorkflowResultSummaryFromOutput,
} from '#/tui/components/messages/dynamic-workflow-mission-control';
import { BRAILLE_SPINNER_INTERVAL_MS } from '#/tui/constant/rendering';
import { currentTheme, darkColors } from '#/tui/theme';

const DESCRIPTION = 'Review the interface';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

function renderText(component: DynamicWorkflowMissionControlComponent, width = 100): string {
  return strip(component.render(width).join('\n'));
}

function memberLine(output: string, index: number): string {
  const id = String(index).padStart(3, '0');
  const line = output.split('\n').find(
    (candidate) => candidate.replace(/^│\s*/u, '').startsWith(id),
  );
  if (line === undefined) throw new Error(`Missing Dynamic Workflow member ${id}`);
  return line;
}

function aggregateLine(output: string): string {
  const line = output.split('\n').find((candidate) =>
    /\b(?:Orchestrating|Completed|Failed|Cancelled)\b/u.test(strip(candidate))
  );
  if (line === undefined) throw new Error('Missing Dynamic Workflow aggregate');
  return line;
}

function createComponent(
  options: Partial<DynamicWorkflowMissionControlOptions> = {},
): DynamicWorkflowMissionControlComponent {
  return new DynamicWorkflowMissionControlComponent({
    description: options.description ?? DESCRIPTION,
    availableRows: options.availableRows,
  });
}

function register(
  component: DynamicWorkflowMissionControlComponent,
  agentId: string,
): void {
  component.registerSubagent({ agentId });
}

function prepareObservedWorkflow(): DynamicWorkflowMissionControlComponent {
  const component = createComponent();
  component.updateArgs({
    description: DESCRIPTION,
    items: ['Layout hierarchy', 'Interaction audit', 'Visual regression audit'],
  });
  component.markInputComplete();
  component.setActivitySpinnerText(() => '⠋');

  register(component, 'agent-1');
  component.markStarted('agent-1');
  register(component, 'agent-2');
  component.markStarted('agent-2');
  component.markCompleted('agent-2', 'Interaction audit');
  register(component, 'agent-3');
  component.markStarted('agent-3');
  component.markCompleted('agent-3', 'Visual regression audit');
  return component;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DynamicWorkflowMissionControlComponent', () => {
  it('parses only the Dynamic Workflow XML envelope', () => {
    const dynamicWorkflowResult = [
      '<dynamic_workflow_result>',
      '<summary>completed: 1, failed: 1, aborted: 1</summary>',
      '<subagent outcome="completed">Layout hierarchy</subagent>',
      '<subagent outcome="failed">Interaction audit</subagent>',
      '<subagent outcome="aborted">Visual regression audit</subagent>',
      '</dynamic_workflow_result>',
    ].join('\n');

    expect(dynamicWorkflowResultSummaryFromOutput(dynamicWorkflowResult)).toEqual({
      completed: 1,
      failed: 1,
      aborted: 1,
      parsed: true,
    });
    expect(dynamicWorkflowResultSummaryFromOutput(`dynamic_workflow: ${dynamicWorkflowResult}`)).toMatchObject({
      completed: 1,
      failed: 1,
      aborted: 1,
      parsed: true,
    });

    for (const unsupported of [
      dynamicWorkflowResult.replaceAll('dynamic_workflow', 'agent_swarm'),
      'agent_swarm: failed\n[agent 1]\nstatus: failed\nsubagent error: legacy failure',
      'dynamic_workflow: failed\n[agent 1]\nstatus: failed',
      '[agent 1]\nstatus: completed\n\n[summary]\nlegacy completion',
    ]) {
      expect(dynamicWorkflowResultSummaryFromOutput(unsupported).parsed).toBe(false);
    }
  });

  it('decodes escaped XML fields and preserves literal closing-tag text', () => {
    const result = [
      '<dynamic_workflow_result>',
      '<summary>completed: 1</summary>',
      '<subagent item="a&amp;b &quot;quoted&quot; &#x1F600;" outcome="completed">before &lt;/subagent&gt; &amp; after</subagent>',
      '</dynamic_workflow_result>',
    ].join('\n');
    const component = createComponent();
    component.updateArgs({});
    component.markInputComplete();

    expect(dynamicWorkflowResultSummaryFromOutput(result)).toEqual({
      completed: 1,
      failed: 0,
      aborted: 0,
      parsed: true,
    });
    expect(component.applyResult(result)).toBe(true);

    const output = renderText(component, 160);
    expect(memberLine(output, 1)).toContain('a&b "quoted" 😀');
    expect(output).toContain('before </subagent> & after');
    expect(output).not.toContain('&amp;');
    expect(output).not.toContain('&lt;/subagent&gt;');
  });

  it('rejects invalid or duplicate explicit result indexes instead of remapping them', () => {
    const result = [
      '<dynamic_workflow_result>',
      '<subagent index="129" outcome="failed">Out-of-range result</subagent>',
      '<subagent index="1" outcome="completed">Accepted result</subagent>',
      '<subagent index="1" outcome="failed">Duplicate result</subagent>',
      '</dynamic_workflow_result>',
    ].join('\n');
    const component = createComponent();
    component.updateArgs({});
    component.markInputComplete();

    expect(dynamicWorkflowResultSummaryFromOutput(result)).toEqual({
      completed: 1,
      failed: 0,
      aborted: 0,
      parsed: true,
    });
    expect(component.applyResult(result)).toBe(true);

    const output = renderText(component, 120);
    expect(memberLine(output, 1)).toContain('✓ DONE');
    expect(output).toContain('Accepted result');
    expect(output).not.toContain('Out-of-range result');
    expect(output).not.toContain('Duplicate result');
  });

  it('renders a bounded frame with a coral Dynamic Workflow title', () => {
    const previousLevel = chalk.level;
    const previousPalette = currentTheme.palette;
    chalk.level = 3;
    currentTheme.setPalette(darkColors);

    try {
      const lines = prepareObservedWorkflow().render(80);
      const plainLines = lines.map(strip);

      expect(lines[0]).toContain(
        chalk.hex(darkColors.workflowTitle).bold('Dynamic Workflow'),
      );
      expect(plainLines[0]).toMatch(/^╭─ Dynamic Workflow · Review the interface ─+╮$/u);
      expect(plainLines[1]).toBe(`│${' '.repeat(78)}│`);
      expect(plainLines[2]).toContain('Orchestrating');
      expect(plainLines[3]).toBe(`│${' '.repeat(78)}│`);
      expect(plainLines.at(-1)).toBe(`╰${'─'.repeat(78)}╯`);
      for (const line of plainLines.slice(1, -1)) {
        expect(line).toMatch(/^│ .* │$/u);
      }
      for (const line of lines) {
        expect(visibleWidth(line)).toBe(80);
      }
    } finally {
      chalk.level = previousLevel;
      currentTheme.setPalette(previousPalette);
    }
  });

  it('normalizes multiline titles and tasks before framing them', () => {
    const component = createComponent({ description: '' });
    component.updateArgs({
      description: 'Review\nthe interface',
      items: ['Inspect\nlayout'],
    });
    component.markInputComplete();

    const lines = component.render(80);
    const output = strip(lines.join('\n'));
    expect(output).toContain('╭─ Dynamic Workflow · Review the interface');
    expect(memberLine(output, 1)).toContain('Inspect layout');
    for (const line of lines) {
      expect(visibleWidth(line)).toBe(80);
    }
  });

  it('uses the unframed fallback below the minimum frame width', () => {
    const component = prepareObservedWorkflow();
    const narrow = component.render(20).map(strip);
    const framed = component.render(21).map(strip);

    expect(narrow[0]).toMatch(/^Dynamic Workflow/u);
    for (const line of narrow) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(20);
    }
    expect(framed[0]).toBe('╭─ Dynamic Workflow ╮');
    expect(framed.at(-1)).toBe(`╰${'─'.repeat(19)}╯`);
    for (const line of framed) {
      expect(visibleWidth(line)).toBe(21);
    }
  });

  it('renders the observed aggregate and stable vertical member rows', () => {
    const component = prepareObservedWorkflow();

    const output = renderText(component, 100);
    expect(output).toContain('Dynamic Workflow');
    expect(output).toContain('Orchestrating');
    expect(aggregateLine(output)).toContain('2/3 complete');
    expect(aggregateLine(output)).not.toMatch(/\b\d+%/u);
    expect(aggregateLine(output)).not.toContain('━');
    expect(memberLine(output, 1)).toMatch(/▏⣀⣀▕\s+20%\s+● RUN\s+Layout hierarchy/u);
    expect(memberLine(output, 2)).toMatch(/▏⣿⣿▕\s+100%\s+✓ DONE\s+Interaction audit/u);
    expect(output).not.toMatch(/[⣿⣷⣯⣟⡿⢿⣻⣽]{4,}/u);
  });

  it('shows row cubes but no aggregate percentage or bar before the input count is known', () => {
    const component = createComponent({ description: '' });
    component.setActivitySpinnerText(() => '⠋');
    component.updateArgs({}, {
      streamingArguments: '{"description":"Review the interface","items":["Layout hierarchy","Inter',
    });

    const output = renderText(component, 100);
    expect(output).toContain('Dynamic Workflow');
    expect(output).toContain('Waiting for delegated agents');
    expect(aggregateLine(output)).toMatch(/\b\d+s elapsed\b/);
    expect(aggregateLine(output)).not.toMatch(/\b\d+%/);
    expect(memberLine(output, 1)).toContain('▏  ▕   0%');
    expect(output).not.toMatch(/[⣿⣷⣯⣟⡿⢿⣻⣽]{4,}/u);
    expect(aggregateLine(output)).not.toContain('━');
  });

  it('uses only the host loader timer while a workflow is active', () => {
    vi.useFakeTimers();
    const timerCount = vi.getTimerCount();
    const component = createComponent();
    component.updateArgs({ items: ['Layout hierarchy'] });
    component.markInputComplete();
    register(component, 'agent-1');
    component.markStarted('agent-1');

    expect(vi.getTimerCount()).toBe(timerCount);
  });

  it('shimmers Orchestrating without changing its text or creating a timer', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const previousLevel = chalk.level;
    const previousPalette = currentTheme.palette;
    chalk.level = 3;
    currentTheme.setPalette(darkColors);

    try {
      const component = createComponent();
      component.setActivitySpinnerText(() => '⠋');
      const timerCount = vi.getTimerCount();
      const before = aggregateLine(component.render(100).join('\n'));

      vi.setSystemTime(BRAILLE_SPINNER_INTERVAL_MS);
      const after = aggregateLine(component.render(100).join('\n'));

      expect(strip(after)).toBe(strip(before));
      expect(after).not.toBe(before);
      expect(strip(after)).toContain('Orchestrating');
      expect(vi.getTimerCount()).toBe(timerCount);
    } finally {
      chalk.level = previousLevel;
      currentTheme.setPalette(previousPalette);
    }
  });

  it('cancels the request without inventing terminal child states', () => {
    const component = createComponent();
    component.updateArgs({ items: ['Running work', 'Queued work'] });
    component.markInputComplete();
    component.setActivitySpinnerText(() => '⠋');
    component.registerSubagent({ agentId: 'agent-running', dynamicWorkflowIndex: 1 });
    component.markStarted('agent-running');
    component.registerSubagent({ agentId: 'agent-queued', dynamicWorkflowIndex: 2 });

    component.markActiveCancelled();

    const output = renderText(component, 120);
    expect(output).toContain('– Cancelled');
    expect(memberLine(output, 1)).toMatch(/20%\s+● RUN\s+Running work/);
    expect(memberLine(output, 2)).toMatch(/0%\s+◌ WAIT\s+Queued work/);
    expect(output).not.toContain('– STOP');
    expect(output).not.toContain('⠋ Orchestrating');
  });

  it('keeps the first terminal lifecycle state when later events arrive out of order', () => {
    const component = createComponent();
    component.updateArgs({ items: ['Layout hierarchy'] });
    component.markInputComplete();
    register(component, 'agent-1');
    component.markCompleted('agent-1', 'Finished first');
    component.markFailed('agent-1', 'Late failure');

    const output = renderText(component, 100);
    expect(memberLine(output, 1)).toMatch(/100%\s+✓ DONE\s+Layout hierarchy/u);
    expect(output).toContain('Finished first');
    expect(output).not.toContain('Late failure');
  });

  it('lets a structured result fill only nonterminal children', () => {
    const component = createComponent();
    component.updateArgs({ items: ['Observed first', 'Result-only second'] });
    component.markInputComplete();
    component.registerSubagent({ agentId: 'agent-1', dynamicWorkflowIndex: 1 });
    component.markCompleted('agent-1', 'Observed completion');

    component.applyResult([
      '<dynamic_workflow_result>',
      '<subagent index="1" outcome="failed">Late result failure</subagent>',
      '<subagent index="2" outcome="failed">Result failure</subagent>',
      '</dynamic_workflow_result>',
    ].join('\n'));

    const output = renderText(component, 120);
    expect(memberLine(output, 1)).toMatch(/100%\s+✓ DONE\s+Observed first/u);
    expect(output).toContain('Observed completion');
    expect(output).not.toContain('Late result failure');
    expect(memberLine(output, 2)).toMatch(/100%\s+× FAIL\s+Result-only second/u);
    expect(output).toContain('Result failure');
  });

  it('ignores result rows beyond the accepted input total', () => {
    const component = createComponent();
    component.updateArgs({ items: ['Known work'] });
    component.markInputComplete();

    component.applyResult([
      '<dynamic_workflow_result>',
      '<subagent index="1" outcome="completed">Done</subagent>',
      '<subagent index="2" outcome="failed">Phantom failure</subagent>',
      '</dynamic_workflow_result>',
    ].join('\n'));

    const output = renderText(component, 120);
    expect(aggregateLine(output)).toContain('1/1 complete');
    expect(memberLine(output, 1)).toContain('✓ DONE');
    expect(output).not.toContain('002');
    expect(output).not.toContain('Phantom failure');
    expect(output).not.toContain('200%');
  });

  it('prefers a suspension detail over stale model progress in the member row', () => {
    const component = createComponent({ availableRows: () => 5 });
    component.updateArgs({ items: ['Throttle-sensitive work'] });
    component.markInputComplete();
    component.registerSubagent({ agentId: 'agent-1' });
    component.markStarted('agent-1');
    component.appendModelDelta({ agentId: 'agent-1', delta: 'Stale model progress' });
    component.markSuspended({ agentId: 'agent-1', reason: 'Rate limited' });

    const output = renderText(component, 120);
    expect(memberLine(output, 1)).toMatch(/50%\s+! HOLD\s+Throttle-sensitive work/);
    expect(output).toContain('Rate limited');
    expect(output).not.toContain('Stale model progress');
  });

  it('prefers a failure detail over stale model progress in the member row', () => {
    const component = createComponent({ availableRows: () => 5 });
    component.updateArgs({ items: ['Failure-sensitive work'] });
    component.markInputComplete();
    component.registerSubagent({ agentId: 'agent-1' });
    component.markStarted('agent-1');
    component.appendModelDelta({ agentId: 'agent-1', delta: 'Stale model progress' });
    component.markFailed('agent-1', 'Provider exhausted');

    const output = renderText(component, 120);
    expect(memberLine(output, 1)).toMatch(/100%\s+× FAIL\s+Failure-sensitive work/);
    expect(output).toContain('Provider exhausted');
    expect(output).not.toContain('Stale model progress');
  });

  it.each([
    ['blank', {}, 'Discovered task'],
    ['resumed', { resume_agent_ids: { 'agent-previous': true } }, 'Resumed task'],
  ])('hydrates a %s row from a structured result item', (_kind, args, item) => {
    const component = createComponent();
    component.updateArgs(args);
    component.markInputComplete();
    component.applyResult([
      '<dynamic_workflow_result>',
      `<subagent index="1" item="${item}" outcome="completed">Done</subagent>`,
      '</dynamic_workflow_result>',
    ].join('\n'));

    const output = renderText(component, 120);
    expect(output).toContain(item);
    expect(output).not.toContain('(resumed)');
  });

  it('orders explicit Dynamic Workflow indexes before spawn-order fallbacks', () => {
    const component = createComponent();
    component.updateArgs({ items: ['First item', 'Second item', 'Third item'] });
    component.markInputComplete();
    component.registerSubagent({ agentId: 'agent-3', dynamicWorkflowIndex: 3 });
    component.registerSubagent({ agentId: 'agent-1', dynamicWorkflowIndex: 1 });
    component.registerSubagent({ agentId: 'agent-fallback' });
    component.markStarted('agent-3');
    component.markStarted('agent-1');
    component.markStarted('agent-fallback');

    const output = renderText(component, 100);
    expect(output.indexOf(memberLine(output, 1))).toBeLessThan(output.indexOf(memberLine(output, 2)));
    expect(output.indexOf(memberLine(output, 2))).toBeLessThan(output.indexOf(memberLine(output, 3)));
  });

  it('renders every observed member and request phase without inventing lifecycle events', () => {
    const pending = createComponent();
    pending.updateArgs({}, { streamingArguments: '{"items":["Pending work"' });
    expect(memberLine(renderText(pending, 100), 1)).toMatch(/0%\s+◌ PEND\s+Pending work/);

    const component = createComponent();
    component.updateArgs({
      items: ['Queued work', 'Running work', 'Suspended work', 'Complete work', 'Failed work', 'Stopped work'],
    });
    component.markInputComplete();
    for (let index = 1; index <= 6; index += 1) {
      component.registerSubagent({ agentId: `agent-${String(index)}`, dynamicWorkflowIndex: index });
    }
    component.markStarted('agent-2');
    component.markSuspended({ agentId: 'agent-3', reason: 'Rate limited' });
    component.markCompleted('agent-4', 'Done');
    component.markFailed('agent-5', 'Failed');
    component.markCancelled('agent-6');

    const output = renderText(component, 140);
    for (const token of ['◌ WAIT', '● RUN', '! HOLD', '✓ DONE', '× FAIL', '– STOP']) {
      expect(output).toContain(token);
    }
    expect(output).toContain('Orchestrating');

    const failed = createComponent();
    failed.updateArgs({ items: ['One'] });
    failed.markInputComplete();
    failed.markRequestFailed('Provider failure');
    expect(renderText(failed, 100)).toContain('× Failed');

    const cancelled = createComponent();
    cancelled.updateArgs({ items: ['One'] });
    cancelled.markInputComplete();
    cancelled.markActiveCancelled();
    expect(renderText(cancelled, 100)).toContain('– Cancelled');
  });

  it.each([64, 79, 80, 100])(
    'never renders an estimated aggregate bar or percentage at width %i',
    (width) => {
      const aggregate = aggregateLine(renderText(prepareObservedWorkflow(), width));
      expect(aggregate).toContain('2/3 complete');
      expect(aggregate).not.toMatch(/\b\d+%/u);
      expect(aggregate).not.toContain('━');
    },
  );

  it('advances member cubes through observed work stages', () => {
    const component = createComponent();
    component.updateArgs({ items: ['Live work'] });
    component.markInputComplete();
    component.registerSubagent({ agentId: 'agent-1' });

    const expectProgress = (percent: number, fill: string) => {
      const output = renderText(component, 100);
      expect(memberLine(output, 1)).toContain(
        `▏${fill.repeat(2)}▕ ${String(percent).padStart(3, ' ')}%`,
      );
      return output;
    };

    expectProgress(0, ' ');
    component.markStarted('agent-1');
    expectProgress(20, '⣀');
    component.appendModelDelta({ agentId: 'agent-1', delta: 'Inspecting' });
    expectProgress(50, '⣤');
    component.appendModelDelta({ agentId: 'agent-1', delta: ' more' });
    expectProgress(50, '⣤');
    component.recordToolCall({ agentId: 'agent-1', name: 'Read' });
    expectProgress(75, '⣶');
    component.appendModelDelta({ agentId: 'agent-1', delta: 'Summarizing' });
    const activeOutput = expectProgress(90, '⣷');
    expect(aggregateLine(activeOutput)).toContain('0/1 complete');
    expect(aggregateLine(activeOutput)).not.toMatch(/\b\d+%/u);
    expect(aggregateLine(activeOutput)).not.toContain('━');

    component.markCompleted('agent-1', 'Done');
    const completedOutput = expectProgress(100, '⣿');
    expect(aggregateLine(completedOutput)).toContain('1/1 complete');
  });

  it('reports aggregate completion counts without estimating overall progress', () => {
    const component = createComponent();
    component.updateArgs({
      items: Array.from({ length: 11 }, (_, index) => `Review ${String(index + 1)}`),
    });
    component.markInputComplete();

    for (let index = 1; index <= 11; index += 1) {
      const agentId = `agent-${String(index)}`;
      component.registerSubagent({ agentId, dynamicWorkflowIndex: index });
      component.markStarted(agentId);
      component.recordToolCall({ agentId, name: 'Read' });
      component.appendModelDelta({ agentId, delta: 'Checking results' });
    }
    component.markCompleted('agent-3', 'Done');

    const aggregate = aggregateLine(renderText(component, 120));
    expect(aggregate).toContain('1/11 complete');
    expect(aggregate).not.toMatch(/\b\d+%/u);
    expect(aggregate).not.toContain('━');
  });

  it('clips stable rows before activity and exposes a useful hidden-agent count', () => {
    const component = createComponent({ availableRows: () => 6 });
    component.updateArgs({ items: ['One', 'Two', 'Three', 'Four', 'Five'] });
    component.markInputComplete();

    const lines = renderText(component, 100).split('\n');
    expect(lines).toHaveLength(6);
    expect(memberLine(lines.join('\n'), 1)).toMatch(/0%\s+◌ WAIT\s+One/u);
    expect(lines.join('\n')).toContain('+ 4 more agents');
    expect(lines.join('\n')).not.toContain('Recent activity');
  });

  it('keeps three workflow-relative activity entries with suspension and failure details', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const component = createComponent();
    component.updateArgs({ items: ['Review activity'] });
    component.markInputComplete();
    vi.setSystemTime(1_000);
    component.registerSubagent({ agentId: 'agent-1' });
    vi.setSystemTime(2_000);
    component.markStarted('agent-1');
    vi.setSystemTime(3_000);
    component.markSuspended({ agentId: 'agent-1', reason: 'Rate limited' });
    vi.setSystemTime(4_000);
    component.markStarted('agent-1');
    vi.setSystemTime(5_000);
    component.markFailed('agent-1', 'Provider exhausted');

    const output = renderText(component, 120);
    expect(output).toContain('Recent activity');
    expect(output).toContain('001 +3s Suspended: Rate limited');
    expect(output).toContain('001 +4s Started');
    expect(output).toContain('001 +5s Failed: Provider exhausted');
    expect(output).not.toContain('001 +1s Agent spawned');
  });

  it.each([20, 40, 63, 64, 79, 80, 100])(
    'keeps identity before current work and time at width %i without overflow',
    (width) => {
      const component = prepareObservedWorkflow();
      const rendered = component.render(width);
      const output = strip(rendered.join('\n'));

      const showsProgress = width >= 64;
      expect(rendered.every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(memberLine(output, 1)).toContain('● RUN');
      expect(memberLine(output, 1).includes('▏⣀⣀▕  20%')).toBe(showsProgress);
      expect(output.includes('PROGRESS')).toBe(showsProgress);
    },
  );
});
