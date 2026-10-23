// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createOverlay } from './overlay';

it('keeps plugin navigation input local without cancelling native controls', () => {
  const overlay = createOverlay('clickdeck-root');
  const input = document.createElement('input');
  overlay.root.append(input);
  const host = vi.fn();
  for (const type of ['keydown', 'wheel', 'touchstart', 'touchend']) {
    window.addEventListener(type, host);
    const event = new Event(type, { bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(host).not.toHaveBeenCalled();
    document.body.dispatchEvent(new Event(type, { bubbles: true }));
    expect(host).toHaveBeenCalledTimes(1);
    window.removeEventListener(type, host);
    host.mockClear();
  }
  overlay.destroy();
});
