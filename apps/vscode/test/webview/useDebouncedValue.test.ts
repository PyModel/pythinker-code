import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

describe('useDebouncedValue', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns the initial value immediately without debounce', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 100));
    expect(result.current).toBe('a');
  });

  it('keeps the old value during the debounce window and updates after it', async () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 100), { initialProps: { value: 'a' } });
    rerender({ value: 'ab' });
    expect(result.current).toBe('a');

    await waitFor(() => { expect(result.current).toBe('ab'); });
  });

  it('settles only the final value for rapid successive changes', async () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 100), { initialProps: { value: 'a' } });
    rerender({ value: 'ab' });
    rerender({ value: 'abc' });
    expect(result.current).toBe('a');

    await new Promise((r) => setTimeout(r, 50));
    expect(result.current).toBe('a');

    await waitFor(() => { expect(result.current).toBe('abc'); });
  });

  it('clears the pending timer on unmount', () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { rerender, unmount } = renderHook(({ value }) => useDebouncedValue(value, 100), { initialProps: { value: 'a' } });
    rerender({ value: 'ab' });
    const pending = vi.getTimerCount();
    expect(pending).toBeGreaterThan(0);

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(pending - 1);
  });
});
