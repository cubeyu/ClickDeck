import { describe, expect, it, vi } from "vitest";
import { getPanelLabels } from "./i18n";

describe("getPanelLabels", () => {
  it("uses Chinese labels for zh UI languages", () => {
    vi.stubGlobal("chrome", {
      i18n: {
        getUILanguage: () => "zh-CN"
      }
    });

    expect(getPanelLabels().selectHint).toBe("点击页面可编辑；收起编辑器后可正常浏览、翻页。");

    vi.unstubAllGlobals();
  });

  it("defaults to English labels for non-Chinese UI languages", () => {
    vi.stubGlobal("chrome", {
      i18n: {
        getUILanguage: () => "en-US"
      }
    });

    expect(getPanelLabels().selectHint).toBe("Click to edit. Collapse the editor to browse and use page navigation.");

    vi.unstubAllGlobals();
  });
});
