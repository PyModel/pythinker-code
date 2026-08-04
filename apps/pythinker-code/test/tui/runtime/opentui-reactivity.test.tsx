import type { TextRenderable } from '@opentui/core';
import { For, Index, createSignal, type Setter } from 'solid-js';
import { createSignal as createClientSignal } from 'solid-js/dist/solid.js';
import { describe, expect, it } from 'vitest';

const ffiEnabled =
  process.execArgv.some((arg) => arg.includes('experimental-ffi')) ||
  (process.env['NODE_OPTIONS'] ?? '').includes('experimental-ffi');

describe('Solid runtime identity', () => {
  it('resolves the bare import to the OpenTUI client runtime', () => {
    expect(createSignal).toBe(createClientSignal);
  });
});

describe.skipIf(!ffiEnabled)('OpenTUI Solid reactivity', () => {
  it('updates a signal-driven text child created outside the render root', async () => {
    const { testRender } = await import('@opentui/solid');
    const [value, setValue] = createSignal('BEFORE');

    const setup = await testRender(() => <text>{value()}</text>, { width: 40, height: 4 });
    try {
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain('BEFORE');

      setValue('AFTER');
      await setup.renderOnce();
      const updatedFrame = setup.captureCharFrame();
      expect(updatedFrame).toContain('AFTER');
      expect(updatedFrame).not.toContain('BEFORE');
    } finally {
      setup.renderer.destroy();
    }
  }, 30_000);

  it('updates a signal-driven text child created inside the render root', async () => {
    const { testRender } = await import('@opentui/solid');
    let setValue!: Setter<string>;

    function OwnerScopedText() {
      const [value, updateValue] = createSignal('BEFORE');
      setValue = updateValue;
      return <text>{value()}</text>;
    }

    const setup = await testRender(OwnerScopedText, { width: 40, height: 4 });
    try {
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain('BEFORE');

      setValue('AFTER');
      await setup.renderOnce();
      const updatedFrame = setup.captureCharFrame();
      expect(updatedFrame).toContain('AFTER');
      expect(updatedFrame).not.toContain('BEFORE');
    } finally {
      setup.renderer.destroy();
    }
  }, 30_000);

  it('updates via the content prop with the ordinary Solid import', async () => {
    const { testRender } = await import('@opentui/solid');
    let setValue!: Setter<string>;

    function ReactiveContent() {
      const [value, updateValue] = createSignal('BEFORE');
      setValue = updateValue;
      return <text content={value()} />;
    }

    const setup = await testRender(ReactiveContent, { width: 40, height: 4 });
    try {
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain('BEFORE');

      setValue('AFTER');
      await setup.renderOnce();
      const updatedFrame = setup.captureCharFrame();
      expect(updatedFrame).toContain('AFTER');
      expect(updatedFrame).not.toContain('BEFORE');
    } finally {
      setup.renderer.destroy();
    }
  }, 30_000);

  it('keeps a TextNode first child while reactive text updates', async () => {
    const { testRender } = await import('@opentui/solid');
    let setValue!: Setter<string>;
    let textRenderable!: TextRenderable;

    function ReactiveChild() {
      const [value, updateValue] = createSignal('BEFORE');
      setValue = updateValue;
      return (
        <text
          ref={(node) => {
            textRenderable = node;
          }}
        >
          {value()}
        </text>
      );
    }

    const setup = await testRender(ReactiveChild, { width: 40, height: 4 });
    try {
      await setup.renderOnce();
      expect(textRenderable.getTextChildren()[0]?.constructor.name).toBe('TextNode');

      setValue('AFTER');
      await setup.renderOnce();
      const updatedFrame = setup.captureCharFrame();
      expect(updatedFrame).toContain('AFTER');
      expect(updatedFrame).not.toContain('BEFORE');
    } finally {
      setup.renderer.destroy();
    }
  }, 30_000);

  it('updates a signal-driven text child after explicit invalidation', async () => {
    const { testRender } = await import('@opentui/solid');
    let setValue!: Setter<string>;

    function ReactiveChild() {
      const [value, updateValue] = createSignal('BEFORE');
      setValue = updateValue;
      return <text>{value()}</text>;
    }

    const setup = await testRender(ReactiveChild, { width: 40, height: 4 });
    try {
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain('BEFORE');

      setValue('AFTER');
      setup.renderer.requestRender();
      await setup.renderOnce();
      const updatedFrame = setup.captureCharFrame();
      expect(updatedFrame).toContain('AFTER');
      expect(updatedFrame).not.toContain('BEFORE');
    } finally {
      setup.renderer.destroy();
    }
  }, 30_000);

  it('updates a signal-driven list rendered with For', async () => {
    const { testRender } = await import('@opentui/solid');
    let setItems!: Setter<string[]>;

    function ReactiveForList() {
      const [items, updateItems] = createSignal(['ALPHA', 'BETA']);
      setItems = updateItems;
      return (
        <box flexDirection="column">
          <For each={items()}>{(item) => <text content={item} />}</For>
        </box>
      );
    }

    const setup = await testRender(ReactiveForList, { width: 40, height: 6 });
    try {
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain('ALPHA');

      setItems(['GAMMA', 'DELTA']);
      await setup.renderOnce();
      const updatedFrame = setup.captureCharFrame();
      expect(updatedFrame).toContain('GAMMA');
      expect(updatedFrame).toContain('DELTA');
      expect(updatedFrame).not.toContain('ALPHA');
      expect(updatedFrame).not.toContain('BETA');
    } finally {
      setup.renderer.destroy();
    }
  }, 30_000);

  it('updates a signal-driven list rendered with Index', async () => {
    const { testRender } = await import('@opentui/solid');
    let setItems!: Setter<string[]>;

    function ReactiveIndexList() {
      const [items, updateItems] = createSignal(['ALPHA', 'BETA']);
      setItems = updateItems;
      return (
        <box flexDirection="column">
          <Index each={items()}>{(item) => <text content={item()} />}</Index>
        </box>
      );
    }

    const setup = await testRender(ReactiveIndexList, { width: 40, height: 6 });
    try {
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain('ALPHA');

      setItems(['GAMMA', 'DELTA']);
      await setup.renderOnce();
      const updatedFrame = setup.captureCharFrame();
      expect(updatedFrame).toContain('GAMMA');
      expect(updatedFrame).toContain('DELTA');
      expect(updatedFrame).not.toContain('ALPHA');
      expect(updatedFrame).not.toContain('BETA');
    } finally {
      setup.renderer.destroy();
    }
  }, 30_000);
});
