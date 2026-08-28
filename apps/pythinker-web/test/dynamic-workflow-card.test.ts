import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { describe, expect, it, vi } from 'vitest';

import DynamicWorkflowTool from '../src/components/chat/tool-calls/DynamicWorkflowTool.vue';
import type { AppSubagentRouting } from '../src/api/types';
import type { DynamicWorkflowMember } from '../src/composables/dynamicWorkflowGroups';
import { messages } from '../src/i18n/locales';

const i18n = createI18n({ legacy: false, locale: 'en', messages });

function routing(overrides: Partial<AppSubagentRouting> = {}): AppSubagentRouting {
  return {
    operation: 'spawn',
    profileSource: 'default',
    modelSource: 'caller',
    policyMode: 'inherit',
    policySource: 'default',
    featureSource: 'default',
    routingEnvRevision: 'route-env:v1:aaa',
    routeDecision: 'route-decision:v1:bbb',
    ...overrides,
  };
}

function member(index: number, overrides: Partial<DynamicWorkflowMember> = {}): DynamicWorkflowMember {
  return {
    id: `agent_${index}`,
    name: `Task ${index}`,
    phase: 'working',
    dynamicWorkflowIndex: index,
    model: 'acme/sol',
    thinkingEffort: 'max',
    subagentType: 'coder',
    routing: routing(),
    currentRoutingEnvRevision: 'route-env:v1:aaa',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const modelDisplay = (id: string | undefined): string | undefined =>
  id === 'acme/sol' ? 'Sol' : id === 'acme/luna' ? 'Luna' : id;
const subagentEffort = (effort: string | undefined): string | undefined =>
  effort === undefined ? undefined : effort[0]!.toUpperCase() + effort.slice(1);

function mountCard(
  members: DynamicWorkflowMember[],
  opts: { status?: 'running' | 'ok' | 'error'; main?: { model?: string; effort?: string }; openAgentSettings?: () => void } = {},
) {
  return mount(DynamicWorkflowTool, {
    props: {
      tool: {
        id: 'workflow_1',
        name: 'AgentDynamicWorkflow',
        arg: JSON.stringify({ description: 'Review files', items: members.map(() => ({})) }),
        status: opts.status ?? 'running',
      },
    },
    global: {
      plugins: [i18n],
      provide: {
        resolveDynamicWorkflowMembers: () => members,
        modelDisplay,
        subagentEffort,
        mainModelBinding: () => opts.main ?? { model: 'acme/sol', effort: 'max' },
        openAgentSettings: opts.openAgentSettings,
      },
      stubs: { Tooltip: true },
    },
  });
}

describe('DynamicWorkflowTool card', () => {
  it('shows the count once, in the header only', () => {
    const wrapper = mountCard([member(1, { phase: 'completed', completedAt: '2026-01-01T00:00:10.000Z' }), member(2)]);
    expect(wrapper.get('.head .chip').text()).toBe('1 / 2');
    expect(wrapper.text().match(/1 \/ 2/g)).toHaveLength(1);
  });

  it('renders one cell per task up to 12 and a grouped bar beyond', () => {
    const nine = mountCard(Array.from({ length: 9 }, (_, i) => member(i + 1)));
    expect(nine.findAll('[data-testid="segments-cells"] .cell')).toHaveLength(9);
    expect(nine.find('[data-testid="segments-grouped"]').exists()).toBe(false);

    const thirteen = mountCard(Array.from({ length: 13 }, (_, i) => member(i + 1, { phase: i % 2 === 0 ? 'working' : 'completed', completedAt: '2026-01-01T00:00:10.000Z' })));
    expect(thirteen.find('[data-testid="segments-cells"]').exists()).toBe(false);
    expect(thirteen.findAll('[data-testid="segments-grouped"] > span')).toHaveLength(2);
  });

  it('orders groups by severity: Failed first only when a failure exists', () => {
    const healthy = mountCard([member(1, { phase: 'completed', completedAt: '2026-01-01T00:00:10.000Z' }), member(2), member(3, { phase: 'queued' })]);
    expect(healthy.findAll('.group').map((g) => g.attributes('data-phase'))).toEqual(['working', 'queued', 'completed']);
    expect(healthy.get('.group-completed .group-head').attributes('aria-expanded')).toBe('false');

    const failing = mountCard([member(1, { phase: 'completed', completedAt: '2026-01-01T00:00:10.000Z' }), member(2), member(3, { phase: 'failed', completedAt: '2026-01-01T00:00:10.000Z' })]);
    expect(failing.findAll('.group').map((g) => g.attributes('data-phase'))).toEqual(['failed', 'working', 'completed']);
    expect(failing.get('.group-failed .group-head').attributes('aria-expanded')).toBe('true');
  });

  it('shows MAIN and an inherit state, then a mixed breakdown with per-row provenance words', async () => {
    const wrapper = mountCard([member(1), member(2)]);
    const line = wrapper.get('[data-testid="routing-line"]');
    expect(line.get('.routing-main').text()).toContain('MAIN');
    expect(line.get('.routing-main').text()).toContain('Sol · Max');
    expect(line.get('.routing-sub').attributes('data-state')).toBe('inherit');
    expect(line.get('.routing-sub').text()).toContain('Inherit → Sol · Max');
    expect(wrapper.findAll('.mprov').map((n) => n.text())).toEqual(['Inherited', 'Inherited']);

    await wrapper.setProps({ tool: { ...wrapper.props('tool'), arg: JSON.stringify({ description: 'Review files', items: [{}, {}, {}] }) } });
    const mixed = mountCard([
      member(1),
      member(2, { model: 'acme/luna', thinkingEffort: 'high', routing: routing({ modelSource: 'policy-pool', policyMode: 'pool', policySource: 'config' }) }),
      member(3, { routing: routing({ modelSource: 'resume-existing', operation: 'resume' }) }),
    ]);
    const sub = mixed.get('.routing-sub');
    expect(sub.attributes('data-state')).toBe('mixed');
    expect(sub.text()).toContain('Mixed · 2 models');
    expect(mixed.findAll('.routing-bd').map((n) => n.text())).toEqual(['2 Sol · Max', '1 Luna · High']);
    expect(mixed.findAll('.mprov').map((n) => n.text())).toEqual(['Inherited', 'Pool', 'Resume existing']);
  });

  it('renders the policy and feature provenance lines independently', () => {
    const wrapper = mountCard([member(1, { routing: routing({ policySource: 'config', featureSource: 'env', modelSource: 'policy-default', policyMode: 'default' }) })]);
    expect(wrapper.get('[data-testid="policy-line"]').text()).toBe('Model policy: Saved setting');
    expect(wrapper.get('[data-testid="feature-line"]').text()).toBe('Feature: Enabled by environment');

    const defaults = mountCard([member(1, { routing: routing({ policySource: 'default', featureSource: 'config' }) })]);
    expect(defaults.get('[data-testid="policy-line"]').text()).toBe('Model policy: Default');
    expect(defaults.get('[data-testid="feature-line"]').text()).toBe('Feature: Saved setting');

    const none = mountCard([member(1, { routing: undefined })]);
    expect(none.find('[data-testid="provenance-lines"]').exists()).toBe(false);
  });

  it('offers the Override chip only for a forced policy and opens Settings → Agent', async () => {
    const openAgentSettings = vi.fn();
    const forced = mountCard([member(1, { model: 'acme/luna', routing: routing({ modelSource: 'policy-force', policyMode: 'force', policySource: 'config' }) })], { openAgentSettings });
    expect(forced.get('.routing-sub').attributes('data-state')).toBe('override');
    expect(forced.findAll('.mprov').map((n) => n.text())).toEqual(['Forced']);
    await forced.get('.override-chip').trigger('click');
    expect(openAgentSettings).toHaveBeenCalledTimes(1);

    const plain = mountCard([member(1)], { openAgentSettings });
    expect(plain.find('.override-chip').exists()).toBe(false);
  });

  it('shows the revision notice only from an environment revision mismatch', () => {
    const stale = mountCard([
      member(1, { routing: routing({ routingEnvRevision: 'route-env:v1:old' }), currentRoutingEnvRevision: 'route-env:v1:new' }),
      member(2, { routing: routing({ routingEnvRevision: 'route-env:v1:new' }), currentRoutingEnvRevision: 'route-env:v1:new' }),
    ]);
    expect(stale.get('[data-testid="revision-notice"]').text()).toBe('Applies to new subagents; 1 existing keep their model');
    expect(stale.findAll('[data-testid="earlier-routing"]')).toHaveLength(1);
    expect(stale.get('[data-testid="earlier-routing"]').text()).toBe('Created under earlier routing · Current main: Sol · Max');

    const differentModelsSameRevision = mountCard([
      member(1, { model: 'acme/luna', routing: routing({ routeDecision: 'route-decision:v1:one' }) }),
      member(2, { routing: routing({ routeDecision: 'route-decision:v1:two' }) }),
    ]);
    expect(differentModelsSameRevision.find('[data-testid="revision-notice"]').exists()).toBe(false);

    const settled = mountCard(
      [member(1, { phase: 'completed', completedAt: '2026-01-01T00:00:10.000Z', routing: routing({ routingEnvRevision: 'route-env:v1:old' }), currentRoutingEnvRevision: 'route-env:v1:new' })],
      { status: 'ok' },
    );
    expect(settled.find('[data-testid="revision-notice"]').exists()).toBe(false);
  });

  it('shows profile · model · effort meta and elapsed time per row', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:01:05.000Z'));
    try {
      const wrapper = mountCard([
        member(1),
        member(2, { phase: 'completed', completedAt: '2026-01-01T00:00:42.000Z' }),
      ]);
      expect(wrapper.findAll('.mmeta').map((n) => n.text())).toEqual(['coder · Sol · Max', 'coder · Sol · Max']);
      expect(wrapper.findAll('.melapsed').map((n) => n.text())).toEqual(['1:05', '0:42']);
    } finally {
      vi.useRealTimers();
    }
  });
});
