import { describe, expect, it } from 'vitest';

import {
  formatMigrationFailureReason,
  MigrationPhaseModel,
} from '../../../src/tui/presentation/migration-phase-model';

describe('MigrationPhaseModel', () => {
  it('starts with the required default state and honors an initial phase', () => {
    expect(new MigrationPhaseModel().toViewModel()).toEqual({
      phase: 'ask1',
      selectedIndex: 0,
      progressDone: 0,
      progressTotal: 0,
      stepStatus: {
        config: 'pending',
        mcp: 'pending',
        'user-history': 'pending',
        sessions: 'pending',
      },
      migrationFailed: false,
      migrationFailureReason: undefined,
    });
    expect(new MigrationPhaseModel('ask2').toViewModel().phase).toBe('ask2');
  });

  it('moves up within ask phases and clamps at zero', () => {
    const model = new MigrationPhaseModel();
    model.moveDown(3);
    model.moveDown(3);
    model.moveUp();
    expect(model.toViewModel().selectedIndex).toBe(1);
    model.moveUp();
    model.moveUp();
    expect(model.toViewModel().selectedIndex).toBe(0);
  });

  it('moves down within ask phases using the exact option-count bound', () => {
    const model = new MigrationPhaseModel('ask2');
    model.moveDown(2);
    model.moveDown(2);
    expect(model.toViewModel().selectedIndex).toBe(1);
  });

  it.each(['progress', 'result'] as const)(
    'makes navigation a full-state no-op during the %s phase',
    (phase) => {
      const model = new MigrationPhaseModel(phase);
      model.reportSessionProgress(2, 5);
      model.reportStep('mcp done');
      if (phase === 'result') {
        model.showFailure('failed');
      }
      const before = model.toViewModel();

      model.moveUp();
      model.moveDown(4);

      expect(model.toViewModel()).toEqual(before);
    },
  );

  it('advances to ask2 unconditionally and resets only selection', () => {
    const model = new MigrationPhaseModel('result');
    model.reportSessionProgress(3, 8);
    model.reportStep('sessions done');
    model.showFailure('kept');

    model.advanceToAsk2();

    expect(model.toViewModel()).toEqual({
      phase: 'ask2',
      selectedIndex: 0,
      progressDone: 3,
      progressTotal: 8,
      stepStatus: {
        config: 'pending',
        mcp: 'pending',
        'user-history': 'pending',
        sessions: 'done',
      },
      migrationFailed: true,
      migrationFailureReason: 'kept',
    });
  });

  it('enters progress unconditionally without resetting progress or steps', () => {
    const model = new MigrationPhaseModel('result');
    model.reportSessionProgress(4, 9);
    model.reportStep('user-history done');

    model.enterProgress();

    expect(model.toViewModel()).toMatchObject({
      phase: 'progress',
      progressDone: 4,
      progressTotal: 9,
      stepStatus: {
        config: 'pending',
        mcp: 'pending',
        'user-history': 'done',
        sessions: 'pending',
      },
    });
  });

  it('marks only the exactly matched migration step done', () => {
    const model = new MigrationPhaseModel();

    model.reportStep('config done');

    expect(model.toViewModel().stepStatus).toEqual({
      config: 'done',
      mcp: 'pending',
      'user-history': 'pending',
      sessions: 'pending',
    });
  });

  it.each(['unknown-step done', 'not-a-step'])(
    'leaves step status unchanged for the unrecognized message %s',
    (message) => {
      const model = new MigrationPhaseModel();
      const before = model.toViewModel().stepStatus;

      model.reportStep(message);

      expect(model.toViewModel().stepStatus).toEqual(before);
    },
  );

  it('passes session progress through without validation or clamping', () => {
    const model = new MigrationPhaseModel();

    model.reportSessionProgress(-2, -7);

    expect(model.toViewModel()).toMatchObject({
      progressDone: -2,
      progressTotal: -7,
    });
  });

  it('shows a result without clearing an existing failure', () => {
    const model = new MigrationPhaseModel();
    model.showFailure('migration failed');

    model.showResult();

    expect(model.toViewModel()).toMatchObject({
      phase: 'result',
      migrationFailed: true,
      migrationFailureReason: 'migration failed',
    });
  });

  it('shows failure and passes an undefined reason through verbatim', () => {
    const model = new MigrationPhaseModel('progress');

    model.showFailure(undefined);

    expect(model.toViewModel()).toMatchObject({
      phase: 'result',
      migrationFailed: true,
      migrationFailureReason: undefined,
    });
  });

  it('returns detached, exact snapshots of current state', () => {
    const model = new MigrationPhaseModel('progress');
    model.reportStep('mcp done');
    model.reportSessionProgress(6, 10);
    const first = model.toViewModel();
    const second = model.toViewModel();

    expect(first).toEqual({
      phase: 'progress',
      selectedIndex: 0,
      progressDone: 6,
      progressTotal: 10,
      stepStatus: {
        config: 'pending',
        mcp: 'done',
        'user-history': 'pending',
        sessions: 'pending',
      },
      migrationFailed: false,
      migrationFailureReason: undefined,
    });
    expect(first).not.toBe(second);
    expect(first.stepStatus).not.toBe(second.stepStatus);
  });
});

describe('formatMigrationFailureReason', () => {
  it('formats errors with non-empty and empty messages', () => {
    expect(formatMigrationFailureReason(new Error('migration failed'))).toBe('migration failed');
    expect(formatMigrationFailureReason(new Error(''))).toBe('Error');
  });

  it('formats strings and objects with usable messages', () => {
    expect(formatMigrationFailureReason('rejected')).toBe('rejected');
    expect(formatMigrationFailureReason({ message: 'object failed' })).toBe('object failed');
  });

  it('falls back for objects without a usable message', () => {
    expect(formatMigrationFailureReason({ code: 1 })).toBe('Object rejection');
    expect(formatMigrationFailureReason({ message: '' })).toBe('Object rejection');
  });

  it('formats numeric, boolean, and bigint primitive values', () => {
    expect(formatMigrationFailureReason(42)).toBe('42');
    expect(formatMigrationFailureReason(false)).toBe('false');
    expect(formatMigrationFailureReason(12n)).toBe('12');
  });

  it('formats symbols with and without descriptions', () => {
    expect(formatMigrationFailureReason(Symbol('migration'))).toBe('Symbol(migration)');
    expect(formatMigrationFailureReason(Symbol())).toBe('Symbol rejection');
  });

  it('formats named and anonymous functions', () => {
    function namedMigration(): void {}

    expect(formatMigrationFailureReason(namedMigration)).toBe('Function namedMigration');
    expect(formatMigrationFailureReason(function () {})).toBe('Function rejection');
  });

  it('returns undefined for undefined and resolved whitespace', () => {
    expect(formatMigrationFailureReason(undefined)).toBeUndefined();
    expect(formatMigrationFailureReason(new Error('   '))).toBeUndefined();
    expect(formatMigrationFailureReason({ message: '   ' })).toBeUndefined();
    expect(formatMigrationFailureReason('')).toBeUndefined();
  });
});
