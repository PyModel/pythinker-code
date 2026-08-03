/*
 * End-to-end proof for the deferred cutover wiring.
 *
 * Every runtime module so far is unit-tested through pure exports, which cannot
 * show that committed history survives later renders. This drives the real
 * OpenTUI renderer in split-footer mode and asserts the property the migration
 * rests on: text already in scrollback is never rewritten by a footer update.
 *
 * Requires `--experimental-ffi`; run via `pnpm test:opentui`.
 */

import { Writable } from 'node:stream';

import { createTestRenderer } from '@opentui/core/testing';
import { describe, expect, it } from 'vitest';

import { TranscriptPresenter } from '../../../src/tui/runtime/transcript-presenter';
import { StaticWriter } from '../../../src/tui/runtime/scrollback/static-writer';

const ffiEnabled =
  process.execArgv.some((arg) => arg.includes('experimental-ffi')) ||
  (process.env['NODE_OPTIONS'] ?? '').includes('experimental-ffi');

describe.skipIf(!ffiEnabled)('transcript commits reach scrollback', () => {
  it('writes each committed entry once and never rewrites it', async () => {
    // The renderer intercepts writes on the stream it owns, not on
    // process.stdout, so the writer's sink has to target that same stream.
    const stdout = Object.assign(
      new Writable({
        write(_chunk, _encoding, callback): void {
          callback();
        },
      }),
      { columns: 40, rows: 10, isTTY: true },
    ) as unknown as NodeJS.WriteStream;

    const { renderer, flush, externalOutput } = await createTestRenderer({
      stdout,
      width: 40,
      height: 10,
      screenMode: 'split-footer',
      footerHeight: 2,
      externalOutputMode: 'capture-stdout',
      exitOnCtrlC: false,
      exitSignals: [],
      useMouse: false,
      useKittyKeyboard: null,
    });

    try {
      const presenter = new TranscriptPresenter<string>();
      const writer = new StaticWriter<string>({
        sink: (text) => { stdout.write(text); },
        render: (body) => body,
      });

      writer.writeAll(presenter.append('u1', 'first user message'));
      writer.writeAll(presenter.begin('a1', 'assistant start'));
      writer.writeAll(presenter.update('a1', 'hello', (delta) => delta));
      writer.writeAll(presenter.complete('a1', 'assistant done'));
      await flush();

      const committed = externalOutput.takeText();
      expect(committed).toContain('first user message');
      expect(committed).toContain('assistant done');

      // A stale update and a duplicate completion are already suppressed by the
      // presenter, so these assert the presenter's guard, not the writer's.
      const before = committed;
      writer.writeAll(presenter.update('a1', 'hel', (delta) => delta));
      writer.writeAll(presenter.complete('a1', 'assistant done again'));
      await flush();
      expect(externalOutput.takeText()).toBe('');

      // Re-delivering a commit the writer has already seen must also emit
      // nothing. This is the writer's own guard, which the presenter cannot
      // cover: replay hands back commits that were written in a past session.
      const replayed = presenter.append('u2', 'second user message');
      expect(writer.writeAll(replayed)).toBe(1);
      await flush();
      expect(externalOutput.takeText()).toContain('second user message');

      expect(writer.writeAll(replayed)).toBe(0);
      await flush();
      expect(externalOutput.takeText()).toBe('');

      // A later render must not reissue or alter committed scrollback.
      renderer.requestRender();
      await flush();
      expect(externalOutput.takeText()).toBe('');
      expect(before).toContain('first user message');
    } finally {
      renderer.destroy();
    }
  }, 30_000);
});
