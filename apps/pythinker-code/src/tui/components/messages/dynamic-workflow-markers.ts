import { truncateToWidth, type Component } from '@earendil-works/pi-tui';

import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';

export type DynamicWorkflowModeMarkerState = 'active' | 'inactive' | 'ended';

export class DynamicWorkflowModeMarkerComponent implements Component {
  constructor(private readonly state: DynamicWorkflowModeMarkerState) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    const token = this.state === 'inactive' ? 'textDim' : 'success';
    const marker = currentTheme.boldFg(token, STATUS_BULLET);
    const label = currentTheme.boldFg(token, dynamicWorkflowMarkerLabel(this.state));
    return ['', truncateToWidth(marker + label, safeWidth, '…')];
  }
}

function dynamicWorkflowMarkerLabel(state: DynamicWorkflowModeMarkerState): string {
  switch (state) {
    case 'active':
      return 'Dynamic Workflow activated';
    case 'inactive':
      return 'Dynamic Workflow deactivated';
    case 'ended':
      return 'Dynamic Workflow ended';
  }
}
