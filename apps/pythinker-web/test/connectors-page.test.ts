import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';

import type { AppConnector } from '../src/api/types';
import ConnectorsPage from '../src/components/settings/pages/ConnectorsPage.vue';
import { messages } from '../src/i18n/locales';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages,
  missingWarn: false,
  fallbackWarn: false,
});

const connectors: AppConnector[] = [
  { id: 'managed', name: 'managed', transport: 'http', status: 'connected', toolCount: 1, editable: false },
  {
    id: 'local',
    name: 'local',
    transport: 'stdio',
    status: 'connected',
    toolCount: 2,
    editable: true,
    definition: { transport: 'stdio', command: 'node' },
  },
];

function mountPage(props: Record<string, unknown> = {}) {
  return mount(ConnectorsPage, {
    props: { connectors: [], connectorsLoading: false, ...props },
    global: { plugins: [i18n] },
  });
}

describe('ConnectorsPage', () => {
  it('submits the stdio form payload', async () => {
    const wrapper = mountPage();

    await wrapper.get('button.act').trigger('click');
    const inputs = wrapper.findAll('input');
    await inputs[0]!.setValue('local_server');
    await inputs[1]!.setValue('node');
    const textareas = wrapper.findAll('textarea');
    await textareas[0]!.setValue('--stdio');
    await textareas[1]!.setValue('{"TOKEN":"value"}');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('createConnector')?.[0]?.[0]).toEqual({
      name: 'local_server',
      transport: 'stdio',
      command: 'node',
      args: ['--stdio'],
      env: { TOKEN: 'value' },
      url: undefined,
      headers: undefined,
    });
  });

  it('submits the HTTP headers payload', async () => {
    const wrapper = mountPage();

    await wrapper.get('button.act').trigger('click');
    await wrapper.get('select').setValue('http');
    const inputs = wrapper.findAll('input');
    await inputs[0]!.setValue('remote');
    await inputs[1]!.setValue('https://example.test/mcp');
    await wrapper.get('textarea').setValue('{"Authorization":"Bearer value"}');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('createConnector')?.[0]?.[0]).toEqual({
      name: 'remote',
      transport: 'http',
      command: undefined,
      args: undefined,
      env: undefined,
      url: 'https://example.test/mcp',
      headers: { Authorization: 'Bearer value' },
    });
  });

  it('shows edit and remove only for user-global entries', () => {
    const wrapper = mountPage({ connectors });

    expect(wrapper.findAll('.connector-edit')).toHaveLength(1);
    expect(wrapper.findAll('.connector-remove')).toHaveLength(1);
  });

  it('spans every long field across both form columns', async () => {
    const wrapper = mountPage();

    await wrapper.get('button.act').trigger('click');
    const labelOf = (field: ReturnType<typeof wrapper.get>): string => field.get('.rlabel').text();
    const wide = wrapper.findAll('.connector-field-wide').map(labelOf);
    const narrow = wrapper
      .findAll('.connector-field')
      .filter((field) => !field.classes().includes('connector-field-wide'))
      .map(labelOf);

    // Name and Transport pair up on the first row; the rest take a full row,
    // so no row is left half empty.
    expect(narrow).toEqual(['Name', 'Transport']);
    expect(wide).toEqual(['Command', 'Arguments', 'Environment (JSON)']);
  });

  it('shows the daemon validation message after a rejected write', () => {
    const wrapper = mountPage({ connectorsError: 'MCP server id must be trimmed' });

    expect(wrapper.get('[role="alert"]').text()).toContain('MCP server id must be trimmed');
  });
});
