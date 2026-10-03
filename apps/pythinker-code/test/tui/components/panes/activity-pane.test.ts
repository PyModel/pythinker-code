import { Text, visibleWidth } from '@pymodel/pi-tui';
import { describe, expect, it } from 'vitest';

import { ActivityPaneComponent } from '#/tui/components/panes/activity-pane';

function createMockSpinner(initialText = 'working') {
  const spinner = new Text(initialText, 0, 0);
  let tip = '';
  let availableWidth = 0;
  const update = () => {
    const fullText = initialText + tip;
    spinner.setText(availableWidth > 0 && visibleWidth(fullText) > availableWidth ? initialText : fullText);
  };
  return {
    spinner: Object.assign(spinner, {
      setTip(value: string) {
        tip = value;
        update();
      },
      setAvailableWidth(width: number) {
        availableWidth = width;
        update();
      },
      renderLine() {
        return spinner.render(availableWidth > 0 ? availableWidth : 200)[0] ?? '';
      },
    }) as unknown as import('#/tui/components/chrome/activity-spinner').ActivitySpinner,
    getTip: () => tip,
  };
}

describe('ActivityPaneComponent', () => {
  it.each(['waiting', 'tool', 'composing', 'thinking'] as const)(
    'keeps one spacer row for %s; the spinner is drawn in the editor rule',
    (mode) => {
      const { spinner, getTip } = createMockSpinner('working');
      const component = new ActivityPaneComponent({ mode, spinner, tip: 'ctrl+s: steer mid-turn' });

      expect(component.render(80).map((line) => line.trimEnd())).toEqual(['']);
      expect(getTip()).toBe(' · Tip: ctrl+s: steer mid-turn');
    },
  );

  it('renders the detail line under the spacer', () => {
    const { spinner } = createMockSpinner('working');
    const component = new ActivityPaneComponent({
      mode: 'waiting',
      spinner,
      detail: '429 · rate limited',
    });

    const lines = component
      .render(80)
      .map((line) => line.replaceAll(/\u001B\[[0-9;]*m/g, '').trimEnd());
    expect(lines).toEqual(['', '    429 · rate limited']);
  });

  it('renders nothing for hidden, or for thinking without a spinner', () => {
    expect(new ActivityPaneComponent({ mode: 'hidden' }).render(80)).toEqual([]);
    expect(new ActivityPaneComponent({ mode: 'thinking' }).render(80)).toEqual([]);
  });
});

