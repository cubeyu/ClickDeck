import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger";

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes contextual info logs", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const logger = createLogger("diagnostics");

    logger.info("ready", { ok: true });

    expect(info).toHaveBeenCalledWith("[ClickDeck:diagnostics] ready", { ok: true });
  });
});
