import { describe, expect, it } from 'vitest';
import { moveOptionFocus } from '../src/components/ui/FilterSelect.vue';
import { filterMultiSelectOptions, toggleMultiSelectValue } from '../src/components/ui/MultiSelectMenu.vue';
import {
  filterAdminSessions,
  pageAdminSessions,
  togglePageSelection,
  type AdminSession,
} from '../src/components/SessionAdminView.vue';

const sessions: AdminSession[] = [
  { id: 'a', title: 'Alpha', workspaceId: 'one', workspaceName: 'One', lastPrompt: 'Fix login', updatedAt: '2026-08-19T12:00:00Z', archived: false },
  { id: 'b', title: 'Beta', workspaceId: 'two', workspaceName: 'Two', lastPrompt: 'Write docs', updatedAt: '2026-08-10T12:00:00Z', archived: true },
  { id: 'c', title: 'Gamma', workspaceId: 'one', workspaceName: 'One', lastPrompt: 'Add tests', updatedAt: '2026-08-16T12:00:00Z', archived: false },
];

describe('session admin logic', () => {
  it('filters by workspace, status, time, and query', () => {
    expect(filterAdminSessions(sessions, {
      workspaceIds: ['one'], status: 'open', updatedDays: 3, query: 'test', now: new Date('2026-08-20T12:00:00Z'),
    }).map((session) => session.id)).toEqual(['c']);
  });

  it('paginates and clamps the requested page', () => {
    expect(pageAdminSessions(sessions, 2, 2)).toEqual({ items: [sessions[2]], page: 2, pages: 2 });
    expect(pageAdminSessions(sessions, 9, 2).page).toBe(2);
  });

  it('selects and clears a full page without changing other selections', () => {
    expect([...togglePageSelection(new Set(['z']), sessions.slice(0, 2))]).toEqual(['z', 'a', 'b']);
    expect([...togglePageSelection(new Set(['z', 'a', 'b']), sessions.slice(0, 2))]).toEqual(['z']);
  });
});

describe('list primitive logic', () => {
  it('wraps filter option keyboard focus', () => {
    expect(moveOptionFocus(2, 1, 3)).toBe(0);
    expect(moveOptionFocus(0, -1, 3)).toBe(2);
  });

  it('searches, selects, and removes multi-select values', () => {
    const options = [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }];
    expect(filterMultiSelectOptions(options, ' tw ')).toEqual([options[1]]);
    expect(toggleMultiSelectValue(['one'], 'two')).toEqual(['one', 'two']);
    expect(toggleMultiSelectValue(['one', 'two'], 'one')).toEqual(['two']);
  });
});
