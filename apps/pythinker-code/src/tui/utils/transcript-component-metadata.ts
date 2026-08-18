import type { Component } from '@pymodel/pi-tui';

import type { TranscriptEntry } from '../types';

export type TranscriptChildRole = 'durable' | 'live-durable' | 'ephemeral';

export interface TranscriptChildMetadata {
  readonly role: TranscriptChildRole;
  readonly edgeBlankPolicy: 'trim-plain' | 'preserve';
}

const componentEntries = new WeakMap<Component, TranscriptEntry>();
const componentMetadata = new WeakMap<Component, TranscriptChildMetadata>();

export function markTranscriptComponent(component: Component, entry: TranscriptEntry): void {
  componentEntries.set(component, entry);
  markTranscriptChild(component, {
    role: 'durable',
    edgeBlankPolicy: 'trim-plain',
  });
}

export function getTranscriptComponentEntry(
  component: Component,
): TranscriptEntry | undefined {
  return componentEntries.get(component);
}

export function markTranscriptChild(
  component: Component,
  metadata: TranscriptChildMetadata,
): void {
  componentMetadata.set(component, metadata);
}

export function getTranscriptChildMetadata(
  component: Component,
): TranscriptChildMetadata | undefined {
  return componentMetadata.get(component);
}
