import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BUILTIN_SLASH_COMMANDS } from '#/tui/commands/registry';

import { LEGACY_FEATURE_FIXTURES } from './legacy-feature-fixtures';
import {
  LEGACY_TEST_PATHS,
  PARITY_CASES,
  type EvidenceChannel,
} from './feature-matrix';

const APP_ROOT = new URL('../../../', import.meta.url);
const REPOSITORY_ROOT = new URL('../../', APP_ROOT);
const EVENT_HANDLER_URL = new URL('src/tui/controllers/session-event-handler.ts', APP_ROOT);
const TYPES_URL = new URL('src/tui/types.ts', APP_ROOT);
const DIALOGS_URL = new URL('src/tui/components/dialogs/', APP_ROOT);

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].toSorted();
}

function coverageValues(key: 'commands' | 'sessionEvents' | 'transcriptEntries' | 'dialogRoutes') {
  return uniqueSorted(PARITY_CASES.flatMap((row) => row[key] ?? []));
}

function handledSessionEventKinds(): string[] {
  const source = readFileSync(EVENT_HANDLER_URL, 'utf8');
  const switchStart = source.indexOf('switch (event.type)');
  const switchEnd = source.indexOf('disposeMcpServerStatusRows', switchStart);
  expect(switchStart).toBeGreaterThanOrEqual(0);
  expect(switchEnd).toBeGreaterThan(switchStart);
  return uniqueSorted(
    [...source.slice(switchStart, switchEnd).matchAll(/case '([^']+)'/g)].map(
      (match) => match[1] ?? '',
    ),
  );
}

function transcriptEntryKinds(): string[] {
  const source = readFileSync(TYPES_URL, 'utf8');
  const typeStart = source.indexOf('export type TranscriptEntryKind =');
  const typeEnd = source.indexOf(';', typeStart);
  expect(typeStart).toBeGreaterThanOrEqual(0);
  expect(typeEnd).toBeGreaterThan(typeStart);
  return uniqueSorted(
    [...source.slice(typeStart, typeEnd).matchAll(/'([^']+)'/g)].map(
      (match) => match[1] ?? '',
    ),
  );
}

function dialogViewRoutes(): string[] {
  return uniqueSorted(
    readdirSync(DIALOGS_URL)
      .filter((name) => name.endsWith('.ts'))
      .flatMap((name) => {
        const source = readFileSync(new URL(name, DIALOGS_URL), 'utf8');
        return [...source.matchAll(/export class\s+([A-Za-z0-9_]+)/g)].map(
          (match) => match[1] ?? '',
        );
      }),
  );
}

describe('legacy pi-tui feature parity inventory', () => {
  it('covers every registered built-in slash command', () => {
    expect(uniqueSorted(coverageValues('commands'))).toEqual(
      uniqueSorted(BUILTIN_SLASH_COMMANDS.map(({ name }) => name)),
    );
  });

  it('covers every session event dispatched by SessionEventHandler', () => {
    expect(uniqueSorted(coverageValues('sessionEvents'))).toEqual(
      uniqueSorted(handledSessionEventKinds()),
    );
  });

  it('covers every TranscriptEntryKind', () => {
    expect(uniqueSorted(coverageValues('transcriptEntries'))).toEqual(
      uniqueSorted(transcriptEntryKinds()),
    );
  });

  it('covers every exported dialog and view implementation', () => {
    expect(uniqueSorted(coverageValues('dialogRoutes'))).toEqual(uniqueSorted(dialogViewRoutes()));
  });

  it('keeps every case active, deterministic, linked, and fully classified', () => {
    const allowedLegacyTests = new Set<string>(Object.values(LEGACY_TEST_PATHS));
    const evidenceChannels = new Set<EvidenceChannel>([
      'unit',
      'headless-renderer',
      'pty',
      'npm',
      'native',
    ]);

    expect(PARITY_CASES.length).toBeGreaterThan(0);
    expect(uniqueSorted(PARITY_CASES.map(({ id }) => id))).toHaveLength(PARITY_CASES.length);
    expect(uniqueSorted(PARITY_CASES.map(({ scenarioId }) => scenarioId))).toHaveLength(
      PARITY_CASES.length,
    );

    for (const parityCase of PARITY_CASES) {
      expect(parityCase.status, parityCase.id).toBe('active');
      expect(parityCase.scenarioId.trim(), parityCase.id).not.toBe('');
      expect(parityCase.terminalSizes.length, parityCase.id).toBeGreaterThan(0);
      expect(parityCase.platforms.length, parityCase.id).toBeGreaterThan(0);
      expect(parityCase.requiredEvidence.length, parityCase.id).toBeGreaterThan(0);
      expect(allowedLegacyTests.has(parityCase.legacyTest), parityCase.id).toBe(true);
      expect(existsSync(new URL(parityCase.legacyTest, REPOSITORY_ROOT)), parityCase.id).toBe(true);
      for (const channel of parityCase.requiredEvidence) {
        expect(evidenceChannels.has(channel), `${parityCase.id}:${channel}`).toBe(true);
        expect(parityCase.evidenceStatus[channel], `${parityCase.id}:${channel}`).not.toBe(
          'not-applicable',
        );
      }
      // Only manual-only cases carry a justification; the placeholder keeps the
      // assertion unconditional so the lint rule against conditional expects holds.
      const justification =
        parityCase.verification.kind === 'manual-only'
          ? parityCase.verification.justification.trim()
          : 'automated';
      expect(justification, parityCase.id).not.toBe('');
    }
  });

  it('records semantic fixtures for each baseline terminal size', () => {
    expect(Object.keys(LEGACY_FEATURE_FIXTURES).toSorted()).toEqual([
      '120x40',
      '200x60',
      '80x24',
    ]);
    for (const fixture of Object.values(LEGACY_FEATURE_FIXTURES)) {
      expect(fixture.content.length, fixture.terminalSize).toBeGreaterThan(0);
      expect(fixture.ordering.length, fixture.terminalSize).toBeGreaterThan(0);
      expect(fixture.activeView, fixture.terminalSize).toBe('conversation');
      expect(fixture.focus, fixture.terminalSize).toBe('editor');
      expect(fixture.keyActions.length, fixture.terminalSize).toBeGreaterThan(0);
    }
  });
});
