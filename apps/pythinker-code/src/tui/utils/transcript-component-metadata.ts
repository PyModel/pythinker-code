import type { Component } from '@pymodel/pi-tui';

import { CronMessageComponent } from '../components/messages/cron-message';
import { PluginCommandComponent } from '../components/messages/plugin-command';
import { SkillActivationComponent } from '../components/messages/skill-activation';
import { ReplayTurnBoundaryComponent, UserMessageComponent } from '../components/messages/user-message';
import type { TranscriptEntry } from '../types';

const componentEntries = new WeakMap<Component, TranscriptEntry>();

export function markTranscriptComponent(component: Component, entry: TranscriptEntry): void {
  componentEntries.set(component, entry);
}

export function getTranscriptComponentEntry(
  component: Component,
): TranscriptEntry | undefined {
  return componentEntries.get(component);
}

/**
 * Turn boundary: the component that starts a new user turn in the transcript.
 * Live user messages / slash activations have an undefined turnId; replayed
 * ones get a `replay:N` turnId. Both start a new turn. Steer messages carry a
 * defined non-replay turnId and are not boundaries.
 */
export function isTurnBoundaryComponent(child: Component): boolean {
  if (
    !(child instanceof UserMessageComponent) &&
    !(child instanceof SkillActivationComponent) &&
    !(child instanceof PluginCommandComponent) &&
    !(child instanceof ReplayTurnBoundaryComponent)
  ) {
    return false;
  }
  const entry = getTranscriptComponentEntry(child);
  if (entry === undefined) return false;
  return entry.turnId === undefined || entry.turnId.startsWith('replay:');
}

/**
 * Fold-segment boundary: everything {@link isTurnBoundaryComponent} counts,
 * plus the cron card. A cron-fired turn mounts no user message, so without the
 * card as a boundary its output would share the previous user turn's fold
 * segment - and the completed-turn assistant cap would fold that turn's final
 * answer into the step summary.
 */
export function isFoldSegmentBoundaryComponent(child: Component): boolean {
  return isTurnBoundaryComponent(child) || child instanceof CronMessageComponent;
}
