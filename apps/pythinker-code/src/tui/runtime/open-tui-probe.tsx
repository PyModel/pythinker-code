import { createCliRenderer } from '@opentui/core';
import { render } from '@opentui/solid';
import { createSignal } from 'solid-js';

const decoder = new TextDecoder();

export async function runOpenTuiProbe(): Promise<void> {
  const [value, setValue] = createSignal('BEFORE');
  const renderer = await createCliRenderer({
    remote: !process.stdout.isTTY,
    exitOnCtrlC: false,
    exitSignals: [],
    useMouse: false,
    useKittyKeyboard: null,
    clearOnShutdown: true,
    width: 40,
    height: 4,
  });

  try {
    await render(
      () => (
        <box flexDirection="column">
          <text>Pythinker Code</text>
          <text>OpenTUI renderer</text>
          <text>Solid JSX</text>
          <text>{value()}</text>
        </box>
      ),
      renderer,
    );
    await renderer.idle();
    const initialFrame = decoder.decode(renderer.currentRenderBuffer.getRealCharBytes(true));
    if (!initialFrame.includes('BEFORE')) {
      throw new Error('initial frame did not include BEFORE');
    }

    setValue('AFTER');
    await renderer.idle();
    const updatedFrame = decoder.decode(renderer.currentRenderBuffer.getRealCharBytes(true));
    if (!updatedFrame.includes('AFTER') || updatedFrame.includes('BEFORE')) {
      throw new Error('updated frame did not replace BEFORE with AFTER');
    }

    process.stdout.write('OpenTUI reactive smoke passed: BEFORE -> AFTER\n');
  } finally {
    renderer.destroy();
  }
}
