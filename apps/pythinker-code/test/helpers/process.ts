import { vi } from 'vitest';

export class ExitCalled extends Error {
  constructor(public readonly code: number) {
    super(`exit(${code})`);
  }
}

export function mockProcessExit(): { mockRestore(): void } {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
    throw new ExitCalled(Number(code ?? 0));
  }) as never);
}

export function captureProcessWrite(stream: 'stdout' | 'stderr'): {
  readonly chunks: string[];
  readonly text: () => string;
  readonly restore: () => void;
} {
  const chunks: string[] = [];
  const target = process[stream];
  const spy = vi.spyOn(target, 'write').mockImplementation(((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    const complete =
      typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    complete?.();
    return true;
  }) as never);

  return {
    chunks,
    text: () => chunks.join(''),
    restore: () =>{  spy.mockRestore(); },
  };
}
