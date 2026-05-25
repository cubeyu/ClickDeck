/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { exportPdfSnapshot } from "./pdf";
import type { ClickDeckLogger } from "../diagnostics/logger";

describe("exportPdfSnapshot", () => {
  let logger: ClickDeckLogger;

  beforeEach(() => {
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    
    vi.useFakeTimers();
    window.print = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.head.innerHTML = "";
  });

  it("injects a4 style and prints", () => {
    exportPdfSnapshot("a4", logger);

    const styleEl = document.getElementById("clickdeck-pdf-style") as HTMLStyleElement;
    expect(styleEl).not.toBeNull();
    expect(styleEl.textContent).toContain("size: A4");
    expect(styleEl.textContent).toContain("margin: 16mm");

    vi.advanceTimersByTime(150);
    expect(window.print).toHaveBeenCalled();
  });

  it("injects slides style and prints", () => {
    exportPdfSnapshot("slides", logger);

    const styleEl = document.getElementById("clickdeck-pdf-style") as HTMLStyleElement;
    expect(styleEl).not.toBeNull();
    expect(styleEl.textContent).toContain("size: 16in 9in");
    expect(styleEl.textContent).toContain("page-break-after: always");

    vi.advanceTimersByTime(150);
    expect(window.print).toHaveBeenCalled();
  });

  it("injects empty style for long-page and prints", () => {
    exportPdfSnapshot("long-page", logger);

    const styleEl = document.getElementById("clickdeck-pdf-style") as HTMLStyleElement;
    expect(styleEl).not.toBeNull();
    expect(styleEl.textContent).toBe("");

    vi.advanceTimersByTime(150);
    expect(window.print).toHaveBeenCalled();
  });
});
