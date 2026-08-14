import { visibleWidth } from '@earendil-works/pi-tui';
import chalk from 'chalk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DynamicWorkflowMissionControlComponent,
  type DynamicWorkflowMissionControlOptions,
  dynamicWorkflowResultSummaryFromOutput,
} from '#/tui/components/messages/dynamic-workflow-mission-control';
import {
  BRAILLE_SPINNER_FRAMES,
  DYNAMIC_WORKFLOW_RENDERING,
  BRAILLE_SPINNER_INTERVAL_MS,
} from '#/tui/constant/rendering';
import { currentTheme, darkColors } from '#/tui/theme';

const DESCRIPTION = 'Review the interface';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

function renderText(component: DynamicWorkflowMissionControlComponent, width = 100): string {
  return strip(component.render(width).join('\n'));
}

/** Lifecycle progress glyph and label for a running row. */
const RUNNING_GLYPH = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u;
const RUNNING_CELL = new RegExp(`${RUNNING_GLYPH.source}\\s+RUN`, 'u');

/** Head of a task cell that lost the preamble every row shared. */
const TASK_ELISION_MARK = '…';

function memberLine(output: string, index: number): string {
  const id = String(index).padStart(3, '0');
  const line = output.split('\n').find(
    (candidate) => candidate.replace(/^│\s*/u, '').startsWith(id),
  );
  if (line === undefined) throw new Error(`Missing Dynamic Workflow member ${id}`);
  return line;
}

function memberRowCount(output: string): number {
  return output.split('\n').filter(
    (candidate) => /^\d{3}\s/u.test(candidate.replace(/^│\s*/u, '')),
  ).length;
}


function aggregateLine(output: string): string {
  const line = output.split('\n').find((candidate) =>
    /\b(?:Orchestrating|Finalizing|Completed|Failed|Cancelled)\b/u.test(strip(candidate))
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

  it('maps schema errors to failed rows without shifting later results', () => {
    const result = [
      '<dynamic_workflow_result>',
      '<subagent outcome="schema_error">Invalid structured output</subagent>',
      '<subagent outcome="completed">Valid result</subagent>',
      '</dynamic_workflow_result>',
    ].join('\n');
    const component = createComponent();
    component.updateArgs({ items: ['Schema work', 'Normal work'] });
    component.markInputComplete();

    expect(dynamicWorkflowResultSummaryFromOutput(result)).toEqual({
      completed: 1,
      failed: 1,
      aborted: 0,
      parsed: true,
    });
    expect(component.applyResult(result)).toBe(true);
    expect(memberLine(renderText(component, 120), 1)).toMatch(/×\s+FAIL\s+Schema work/u);
    expect(memberLine(renderText(component, 120), 2)).toMatch(/✓\s+DONE\s+Normal work/u);
  });

  it('ignores blank items so no phantom row waits forever', () => {
    const component = createComponent();
    // The engine drops the blank before launching anything, so counting it here
    // would leave a third row queued for good and pin the header at 2/3.
    component.updateArgs({ items: ['Layout hierarchy', 'Interaction audit', '   '] });
    component.markInputComplete();
    register(component, 'agent-1');
    component.markStarted('agent-1');
    component.markCompleted('agent-1', 'Done one');
    register(component, 'agent-2');
    component.markStarted('agent-2');
    component.markCompleted('agent-2', 'Done two');

    const output = renderText(component, 120);
    expect(memberLine(output, 1)).toContain('✓      DONE');
    expect(memberLine(output, 2)).toContain('✓      DONE');
    // memberRowCount also counts activity lines, so assert the row's absence.
    expect(() => memberLine(output, 3)).toThrow(/Missing Dynamic Workflow member 003/u);
    expect(aggregateLine(output)).toContain('2/2 complete');
  });

  it('still parses a result that carries the dropped-items note', () => {
    // agent-core appends this note when it ignores blank items. It used to be
    // prepended, which made the envelope regex miss and rendered a successful
    // run as "Unsupported Dynamic Workflow result".
    const result = [
      '<dynamic_workflow_result>',
      '<summary>completed: 1</summary>',
      '<subagent outcome="completed">Layout hierarchy</subagent>',
      '</dynamic_workflow_result>',
      'Note: 1 empty item was ignored; the workflow ran without them.',
    ].join('\n');

    expect(dynamicWorkflowResultSummaryFromOutput(result)).toEqual({
      completed: 1,
      failed: 0,
      aborted: 0,
      parsed: true,
    });

    const component = createComponent();
    component.updateArgs({ items: ['Layout hierarchy'] });
    component.markInputComplete();
    expect(component.applyResult(result)).toBe(true);

    const output = renderText(component, 120);
    expect(memberLine(output, 1)).toContain('✓      DONE');
    expect(output).not.toContain('Unsupported');
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
    expect(memberLine(output, 1)).toContain('✓      DONE');
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
    expect(memberLine(output, 1)).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+RUN\s+Layout hierarchy/u);
    expect(memberLine(output, 2)).toMatch(/✓\s+DONE\s+Interaction audit/u);
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
    expect(memberLine(output, 1)).toMatch(/○\s+PEND/u);
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
    component.render(100);

    expect(vi.getTimerCount()).toBe(timerCount);
  });

  it('animates the braille header and shimmers Orchestrating without creating a timer', () => {
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

      expect(strip(after).replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u, '')).toBe(
        strip(before).replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u, ''),
      );
      expect(after).not.toBe(before);
      expect(strip(after)).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Orchestrating/);
      expect(strip(after)).toContain('Orchestrating');
      expect(vi.getTimerCount()).toBe(timerCount);
    } finally {
      chalk.level = previousLevel;
      currentTheme.setPalette(previousPalette);
    }
  });

  it('colours running progress and gives Orchestrating three shimmer tiers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const previousLevel = chalk.level;
    const previousPalette = currentTheme.palette;
    chalk.level = 3;
    currentTheme.setPalette(darkColors);

    try {
      const component = createComponent();
      component.updateArgs({ items: ['Layout hierarchy'] });
      component.markInputComplete();
      component.setActivitySpinnerText(() => '⠋');
      register(component, 'agent-1');
      component.markStarted('agent-1');

      const colouredMemberLine = (): string => {
        const line = component.render(100).find(
          (candidate) => strip(candidate).replace(/^│\s*/u, '').startsWith('001'),
        );
        if (line === undefined) throw new Error('Missing Dynamic Workflow member 001');
        return line;
      };

      const first = colouredMemberLine();
      vi.setSystemTime(300);
      const second = colouredMemberLine();

      expect(first).toContain(chalk.hex(darkColors.primary)('⠋'));
      expect(second).toContain(chalk.hex(darkColors.primary)('⠙'));
      expect(first).toContain(chalk.hex(darkColors.primary)('RUN'));
      vi.setSystemTime(BRAILLE_SPINNER_INTERVAL_MS * 1.5);

      const aggregate = aggregateLine(component.render(100).join('\n'));
      expect(strip(aggregate)).toContain('Orchestrating');
      expect(aggregate).toContain(chalk.hex(darkColors.primaryShimmer).bold('O'));
      expect(aggregate).toContain(chalk.hex(darkColors.primary)('r'));
      expect(aggregate).toContain(chalk.hex(darkColors.textDim)('chestrating'));
    } finally {
      vi.useRealTimers();
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
    expect(memberLine(output, 1)).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+RUN\s+Running work/u);
    expect(memberLine(output, 2)).toMatch(/○\s+WAIT\s+Queued work/u);
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
    expect(memberLine(output, 1)).toMatch(/✓\s+DONE\s+Layout hierarchy/u);
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
    expect(memberLine(output, 1)).toMatch(/✓\s+DONE\s+Observed first/u);
    expect(output).toContain('Observed completion');
    expect(output).not.toContain('Late result failure');
    expect(memberLine(output, 2)).toMatch(/×\s+FAIL\s+Result-only second/u);
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
    expect(memberLine(output, 1)).toContain('✓      DONE');
    expect(output).not.toContain('002');
    expect(output).not.toContain('Phantom failure');
    expect(output).not.toMatch(/\d+%/u);
  });

  it('keeps late activity suspended until a lifecycle start resumes it', () => {
    const component = createComponent();
    component.updateArgs({ items: ['Rate-limited work'] });
    component.markInputComplete();
    component.registerSubagent({ agentId: 'agent-1' });
    component.markStarted('agent-1');
    component.markSuspended({ agentId: 'agent-1', reason: 'Rate limited' });

    component.appendModelDelta({ agentId: 'agent-1', delta: 'Late output' });
    component.recordToolCall({ agentId: 'agent-1', name: 'Read' });
    expect(memberLine(renderText(component, 100), 1)).toMatch(/◑\s+HOLD/u);
    expect(renderText(component, 100)).toContain('Rate limited');

    component.markStarted('agent-1');
    expect(memberLine(renderText(component, 100), 1)).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+RUN/u);
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
    expect(memberLine(output, 1)).toMatch(/◑\s+HOLD\s+Throttle-sensitive work/);
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
    expect(memberLine(output, 1)).toMatch(/×\s+FAIL\s+Failure-sensitive work/);
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
    expect(memberLine(renderText(pending, 100), 1)).toMatch(/○\s+PEND\s+Pending work/);

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
    for (const token of ['○      WAIT', '◑      HOLD', '✓      DONE', '×      FAIL', '–      STOP']) {
      expect(output).toContain(token);
    }
    // Running is the one animated phase, so its symbol varies by frame.
    expect(output).toMatch(RUNNING_CELL);
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

  it('renders lifecycle progress without a percentage, work count, or idle age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const component = createComponent();
    component.updateArgs({ items: ['Live work', 'Queued work'] });
    component.markInputComplete();
    component.registerSubagent({ agentId: 'agent-1', dynamicWorkflowIndex: 1 });
    component.markStarted('agent-1');

    const running = renderText(component, 100);
    expect(running).toContain('PROGRESS');
    expect(running).not.toContain('WORK IDLE');
    expect(memberLine(running, 1)).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+RUN\s+Live work/u);
    expect(memberLine(running, 2)).toMatch(/○\s+WAIT\s+Queued work/u);
    expect(running).not.toMatch(/\b\d+%|⚒|━/u);
  });

  it('rotates the running indicators from the shared workflow clock and freezes completion', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const previousLevel = chalk.level;
    const previousPalette = currentTheme.palette;
    chalk.level = 3;
    currentTheme.setPalette(darkColors);

    try {
      const component = createComponent();
      component.updateArgs({ items: ['Live work'] });
      component.markInputComplete();
      component.setActivitySpinnerText(() => '⠋');
      component.registerSubagent({ agentId: 'agent-1' });
      component.markStarted('agent-1');

      for (const [index, glyph] of BRAILLE_SPINNER_FRAMES.slice(0, 4).entries()) {
        const time = index * DYNAMIC_WORKFLOW_RENDERING.progressFrameMs;
        vi.setSystemTime(time);
        const line = component.render(100).find((candidate) => strip(candidate).includes('001'));
        expect(line).toContain(chalk.hex(darkColors.primary)(glyph));
        expect(strip(aggregateLine(component.render(100).join('\n')))).toMatch(
          /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Orchestrating/,
        );
      }

      component.markCompleted('agent-1', 'Done');
      const completed = component.render(100).find((line) => strip(line).includes('001'));
      expect(completed).toContain(chalk.hex(darkColors.success)('✓'));
      vi.setSystemTime(10_000);
      expect(memberLine(renderText(component, 100), 1)).toMatch(/✓\s+DONE/u);
    } finally {
      chalk.level = previousLevel;
      currentTheme.setPalette(previousPalette);
    }
  });

  it('renders lifecycle states without colour support', () => {
    vi.useFakeTimers();
    vi.setSystemTime(160);
    const previousLevel = chalk.level;
    chalk.level = 0;

    try {
      const component = createComponent();
      component.updateArgs({ items: ['Queued work', 'Live work', 'Done work'] });
      component.markInputComplete();
      component.registerSubagent({ agentId: 'agent-live', dynamicWorkflowIndex: 2 });
      component.markStarted('agent-live');
      component.registerSubagent({ agentId: 'agent-done', dynamicWorkflowIndex: 3 });
      component.markCompleted('agent-done', 'Done');

      const output = renderText(component, 100);
      expect(memberLine(output, 1)).toMatch(/○\s+WAIT/u);
      expect(memberLine(output, 2)).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+RUN/u);
      expect(memberLine(output, 3)).toMatch(/✓\s+DONE/u);
    } finally {
      chalk.level = previousLevel;
    }
  });

  it('centres lifecycle glyphs in one fixed progress column', () => {
    const component = createComponent();
    component.updateArgs({ items: ['Queued work', 'Live work', 'Done work'] });
    component.markInputComplete();
    component.registerSubagent({ agentId: 'agent-live', dynamicWorkflowIndex: 2 });
    component.markStarted('agent-live');
    component.registerSubagent({ agentId: 'agent-done', dynamicWorkflowIndex: 3 });
    component.markCompleted('agent-done', 'Done');

    const output = renderText(component, 100);
    const glyphColumns = [
      memberLine(output, 1).indexOf('○'),
      memberLine(output, 2).search(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u),
      memberLine(output, 3).indexOf('✓'),
    ];
    expect(glyphColumns[0]).toBeGreaterThan(0);
    expect(new Set(glyphColumns).size).toBe(1);
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
    expect(memberLine(lines.join('\n'), 1)).toMatch(/○\s+WAIT\s+One/u);
    expect(lines.join('\n')).toContain('+ 4 more agents');
    expect(lines.join('\n')).not.toContain('Recent activity');
  });

  it('drops the preamble every task repeats so the row keeps what names it', () => {
    const preamble = 'You are auditing the pythinker-code monorepo at /Users/panda. Verify ';
    const component = createComponent();
    component.updateArgs({
      items: [
        `${preamble}the permission glob`,
        `${preamble}the concurrency cap`,
        `${preamble}the resume path`,
      ],
    });
    component.markInputComplete();

    const output = renderText(component, 100);
    expect(output).not.toContain('You are auditing');
    // Greedy on purpose: the shared `the ` goes with the rest of the preamble.
    expect(memberLine(output, 1)).toContain('…permission glob');
    expect(memberLine(output, 2)).toContain('…concurrency cap');
    expect(memberLine(output, 3)).toContain('…resume path');

    // The mark is one column wide, so it never pushes a row past the frame.
    for (const width of [20, 40, 63, 64, 79, 80, 100, 150]) {
      expect(component.render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });

  it.each([
    // Nothing shared: every row already names itself.
    { name: 'no shared head', items: ['Audit the plan', 'Ship the release'] },
    // Shared but short: the mark would cost about what the elision frees.
    { name: 'a short shared head', items: ['Audit the plan', 'Audit the release'] },
    // One row is the whole of what the other shares, and what is left over is
    // one short word — below the floor, so the rows stay whole.
    { name: 'a row that is the whole shared head', items: ['Audit the plan appendix', 'Audit the plan'] },
    // A prefix with no space in it can only be cut mid-word.
    { name: 'an unbroken shared head', items: ['aaaaaaaaaaaaaaaaaaaa-one', 'aaaaaaaaaaaaaaaaaaaa-two'] },
  ])('keeps whole tasks when there is $name', ({ items }) => {
    const component = createComponent();
    component.updateArgs({ items });
    component.markInputComplete();

    const output = renderText(component, 200);
    items.forEach((item, index) => {
      expect(memberLine(output, index + 1)).toContain(item);
      expect(memberLine(output, index + 1)).not.toContain(TASK_ELISION_MARK);
    });
  });

  it('leaves a row whose whole task is the shared head with the word the cut skipped', () => {
    const component = createComponent();
    component.updateArgs({
      items: [
        'Audit the pythinker-code monorepo',
        'Audit the pythinker-code monorepo plan',
      ],
    });
    component.markInputComplete();

    // The cut lands before `monorepo`, not after it, so the shorter row keeps a
    // word rather than collapsing to the mark on its own.
    const output = renderText(component, 100);
    expect(memberLine(output, 1)).toContain('…monorepo');
    expect(memberLine(output, 2)).toContain('…monorepo plan');
    expect(output).not.toContain('Audit the pythinker-code');
  });

  it('holds the elision steady while rows are clipped away', () => {
    const preamble = 'Audit the pythinker-code monorepo and report on ';
    const items = ['the plan', 'the cap', 'the resume path', 'the glob'].map(
      (tail) => `${preamble}${tail}`,
    );
    const full = createComponent();
    full.updateArgs({ items });
    full.markInputComplete();
    // Two of the four rows are clipped, but the prefix is measured across every
    // member, so the visible rows read exactly as they did before the clip.
    const clipped = createComponent({ availableRows: () => 6 });
    clipped.updateArgs({ items });
    clipped.markInputComplete();

    expect(memberLine(renderText(clipped, 100), 1))
      .toBe(memberLine(renderText(full, 100), 1));
    expect(memberLine(renderText(clipped, 100), 1)).toContain('…plan');
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

  it.each([
    [20, false, false],
    [40, false, true],
    [63, false, true],
    [64, true, false],
    [79, true, false],
    [80, true, false],
    [100, true, false],
  ] as const)(
    'keeps progress and task columns aligned at width %i',
    (width, expectedProgress, expectedStatus) => {
      const component = prepareObservedWorkflow();
      const rendered = component.render(width);
      const output = strip(rendered.join('\n'));

      expect(rendered.every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(memberLine(output, 1)).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+RUN/u);
      expect(output.includes('PROGRESS')).toBe(expectedProgress);
      expect(output.includes('STATUS')).toBe(expectedStatus);
      expect(output).not.toContain('WORK IDLE');
    },
  );

  it('keeps progress independent of tool calls and streamed text', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const component = createComponent();
    component.updateArgs({ items: ['Long streaming work'] });
    component.markInputComplete();
    register(component, 'agent-1');
    component.markStarted('agent-1');

    vi.setSystemTime(30_000);
    const before = memberLine(renderText(component, 100), 1).match(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u)?.[0];
    component.recordToolCall({ agentId: 'agent-1', name: 'Read' });
    for (let index = 0; index < 200; index += 1) {
      component.appendModelDelta({ agentId: 'agent-1', delta: `chunk ${String(index)} ` });
    }
    component.recordToolCall({ agentId: 'agent-1', name: 'Bash' });

    const output = renderText(component, 100);
    const after = memberLine(output, 1).match(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u)?.[0];
    expect(before).toBeDefined();
    expect(after).toBe(before);
    expect(output).not.toMatch(/\b\d+%|⚒/u);
  });

  it('starts a new line for model text after a tool label instead of fusing them', () => {
    const component = createComponent();
    component.updateArgs({ items: ['Work'] });
    component.markInputComplete();
    register(component, 'agent-1');
    component.markStarted('agent-1');
    component.recordToolCall({ agentId: 'agent-1', name: 'Read' });
    component.appendModelDelta({ agentId: 'agent-1', delta: "I've read the files" });

    const line = memberLine(renderText(component, 200), 1);
    expect(line).not.toContain("Using ReadI've");
    expect(line).toContain("I've read the files");
  });

  it('records every line a provider packs into one delta', () => {
    const component = createComponent();
    component.updateArgs({ items: ['Work'] });
    component.markInputComplete();
    register(component, 'agent-1');
    component.markStarted('agent-1');

    // A provider that batches sends whole lines at once. Only the last one used
    // to reach the activity list, so the same run showed less on that provider.
    component.appendModelDelta({
      agentId: 'agent-1',
      delta: 'First line\nSecond line\nThird line\n',
    });

    const output = renderText(component, 200);
    expect(output).toContain('First line');
    expect(output).toContain('Second line');
    expect(output).toContain('Third line');
  });

  it('does not report an unfinished line as an event of its own', () => {
    const component = createComponent();
    component.updateArgs({ items: ['Work'] });
    component.markInputComplete();
    register(component, 'agent-1');
    component.markStarted('agent-1');
    component.appendModelDelta({ agentId: 'agent-1', delta: 'Closed line\nstill wri' });

    // The row shows the tail as it arrives, but the activity list only carries
    // the line the delta actually closed.
    expect(memberLine(renderText(component, 200), 1)).toContain('still wri');
    const activity = renderText(component, 200).split('\n').filter(
      (line) => /^│\s*001 \+/u.test(line),
    );
    expect(activity.join('\n')).toContain('Closed line');
    expect(activity.join('\n')).not.toContain('still wri');
  });

  it.each([64, 70, 80, 100, 200])(
    'keeps the task readable beside a long agent summary at width %i',
    (width) => {
      const component = createComponent();
      component.updateArgs({ items: ['Cluster B: verify the plan appendix'] });
      component.markInputComplete();
      register(component, 'agent-1');
      component.markStarted('agent-1');
      component.markCompleted(
        'agent-1',
        'Verification complete. All six Phase-1 items checked against the current tree. '.repeat(4),
      );

      // The task names the row. A long summary may be clipped; the identity may
      // not — it used to collapse to a single character once a detail arrived.
      const rendered = component.render(width);
      expect(rendered.every((line) => visibleWidth(line) <= width)).toBe(true);
      const line = memberLine(strip(rendered.join('\n')), 1);
      expect(line).toContain('Cluster B: v');
      expect(line).toContain('Verific');
      expect(line).toMatch(/\b0s\s*│?\s*$/u);
    },
  );

  it('closes a streamed line at its newline instead of fusing the whole message', () => {
    const component = createComponent();
    component.updateArgs({ items: ['Stream a report'] });
    component.markInputComplete();
    register(component, 'agent-1');
    component.markStarted('agent-1');
    for (const delta of ['First line\n', 'Second line\n', 'Third line\n']) {
      component.appendModelDelta({ agentId: 'agent-1', delta });
    }

    const output = renderText(component, 200);
    expect(output).not.toContain('First lineSecond line');
    expect(memberLine(output, 1)).toContain('Third line');
    expect(memberLine(output, 1)).not.toContain('First line');
    // Each closed line is its own activity entry, not three copies of one prefix.
    expect(output).toContain('First line');
    expect(output).toContain('Second line');
  });

  it('renders object items by their prompt field and drops streamed phantom rows', () => {
    const component = createComponent();
    const streamingArguments =
      '{"items": [{"prompt": "Explore records", "description": "Records"},'
      + ' {"prompt": "Explore events", "description": "Events"}';
    component.updateArgs({}, { streamingArguments });
    // Object keys and nested values are not items: two members, not eight.
    expect(memberRowCount(renderText(component, 200))).toBe(2);

    component.updateArgs({
      items: [
        { prompt: 'Explore records', description: 'Records' },
        { prompt: 'Explore events', description: 'Events' },
      ],
    });
    component.markInputComplete();

    const output = renderText(component, 200);
    expect(memberRowCount(output)).toBe(2);
    expect(memberLine(output, 1)).toContain('Explore records');
    expect(memberLine(output, 1)).not.toContain('[object Object]');
    expect(memberLine(output, 2)).toContain('Explore events');
  });

  it('shimmers Finalizing once every member is terminal but the result has not arrived', () => {
    const component = createComponent();
    component.updateArgs({ items: ['One', 'Two'] });
    component.markInputComplete();
    component.registerSubagent({ agentId: 'agent-1', dynamicWorkflowIndex: 1 });
    component.registerSubagent({ agentId: 'agent-2', dynamicWorkflowIndex: 2 });
    component.markStarted('agent-1');
    component.markStarted('agent-2');
    component.markCompleted('agent-1', 'Done');

    const running = renderText(component, 100);
    expect(running).toContain('Orchestrating');
    expect(running).not.toContain('Finalizing');

    component.markCompleted('agent-2', 'Done');
    const finalizing = renderText(component, 100);
    expect(finalizing).toContain('Finalizing');
    expect(finalizing).not.toContain('Orchestrating');

    component.applyResult([
      '<dynamic_workflow_result>',
      '<subagent index="1" outcome="completed">Done</subagent>',
      '<subagent index="2" outcome="completed">Done</subagent>',
      '</dynamic_workflow_result>',
    ].join('\n'));
    const done = renderText(component, 100);
    expect(done).toContain('✓ Completed');
    expect(done).not.toContain('Finalizing');
  });

  it('keeps Orchestrating while an out-of-band member beyond knownTotal still runs', () => {
    const component = createComponent();
    component.updateArgs({ items: ['One', 'Two'] });
    component.markInputComplete();
    component.registerSubagent({ agentId: 'agent-1', dynamicWorkflowIndex: 1 });
    component.registerSubagent({ agentId: 'agent-2', dynamicWorkflowIndex: 2 });
    component.registerSubagent({ agentId: 'agent-3', dynamicWorkflowIndex: 3 });
    component.markStarted('agent-3');
    component.markCompleted('agent-1', 'Done');
    component.markCompleted('agent-2', 'Done');

    const output = renderText(component, 100);
    expect(output).toMatch(RUNNING_CELL);
    expect(output).toContain('Orchestrating');
    expect(output).not.toContain('Finalizing');

    component.markCompleted('agent-3', 'Done');
    expect(renderText(component, 100)).toContain('Finalizing');
  });

  it('aligns narrow member rows and the header on the same task column', () => {
    const component = prepareObservedWorkflow();
    const output = renderText(component, 50);
    const unframe = (line: string) => line.replace(/^│ /u, '');
    const running = unframe(memberLine(output, 1));
    const completed = unframe(memberLine(output, 2));
    const headerLine = output.split('\n').find((line) => line.includes('STATUS'));
    if (headerLine === undefined) throw new Error('Missing Dynamic Workflow table header');
    const header = unframe(headerLine);

    const taskColumn = running.indexOf('Layout hierarchy');
    expect(taskColumn).toBeGreaterThan(0);
    expect(completed.indexOf('Interaction audit')).toBe(taskColumn);
    expect(header.indexOf('TASK')).toBe(taskColumn);
  });
});
