import { afterEach, describe, expect, it, vi } from "vitest";
import { clearLogs, createLogger, getRecentLogs } from "./logger";

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes contextual info logs and pushes to buffer", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const logger = createLogger("diagnostics");

    logger.info("ready", { ok: true });

    expect(info).toHaveBeenCalledWith("[ClickDeck:diagnostics] ready", { ok: true });
    
    const logs = getRecentLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].level).toBe("info");
    expect(logs[0].context).toBe("diagnostics");
    expect(logs[0].message).toBe("ready");
    expect(logs[0].details).toEqual({ ok: true });
  });

  it("limits the buffer size to 100", () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const logger = createLogger("extension");

    for (let i = 0; i < 105; i++) {
      logger.debug(`Message ${i}`);
    }

    const logs = getRecentLogs();
    expect(logs.length).toBe(100);
    expect(logs[0].message).toBe("Message 5");
    expect(logs[99].message).toBe("Message 104");
  });

  it("clears the log buffer", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const logger = createLogger("style");

    logger.warn("Warning");
    expect(getRecentLogs().length).toBeGreaterThan(0);

    clearLogs();
    expect(getRecentLogs().length).toBe(0);
  });
});
