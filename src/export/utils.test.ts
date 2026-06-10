/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForVisualStability } from './utils';

describe('waitForVisualStability', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // JSDOM has requestAnimationFrame, but to be fully deterministic with fake timers:
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      return setTimeout(() => cb(performance.now()), 16) as unknown as number;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should wait for base time, document.fonts.ready, and two frames', async () => {
    let resolved = false;
    
    // Setup a mock for document.fonts
    let fontsReadyResolve: (value?: unknown) => void;
    const fontsReadyPromise = new Promise((r) => { fontsReadyResolve = r; });
    Object.defineProperty(document, 'fonts', {
      value: { ready: fontsReadyPromise },
      configurable: true
    });

    waitForVisualStability(300).then(() => {
      resolved = true;
    });

    // It should not resolve immediately
    expect(resolved).toBe(false);

    // Advance past the base wait time
    await vi.advanceTimersByTimeAsync(300);
    expect(resolved).toBe(false); // Still waiting on fonts.ready

    // Resolve fonts
    fontsReadyResolve!();
    // Let the promise tick
    await Promise.resolve();
    
    // Now it should be waiting for the first requestAnimationFrame
    expect(resolved).toBe(false);

    // Advance first frame
    await vi.advanceTimersByTimeAsync(16);
    expect(resolved).toBe(false); // Still waiting for second frame

    // Advance second frame
    await vi.advanceTimersByTimeAsync(16);
    
    // It should now resolve
    expect(resolved).toBe(true);
  });
});
