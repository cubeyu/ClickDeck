// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildUnifiedPrompt } from "./unified-prompt";
import type { EditorPatch } from "../state/editor-state";
import type { IntentPromptInput } from "./intent-prompt";

describe("buildUnifiedPrompt", () => {
  const dummyPage = { url: "http://test", title: "Test" };

  it("returns empty result if no patches and no intents", () => {
    const resultEn = buildUnifiedPrompt([], [], { language: "en", page: dummyPage });
    expect(resultEn.ok).toBe(false);
    if (!resultEn.ok) {
      expect(resultEn.message).toContain("No edits to summarize");
    }

    const resultZh = buildUnifiedPrompt([], [], { language: "zh", page: dummyPage });
    expect(resultZh.ok).toBe(false);
    if (!resultZh.ok) {
      expect(resultZh.message).toContain("当前没有可总结的修改");
    }
  });

  it("generates a TodoList with both intent ops and normal changes", () => {
    const patch: EditorPatch = {
      id: "p1",
      createdAt: Date.now(),
      targetElement: document.createElement("div"),
      targetDescriptor: "div",
      targetLocator: { cssPath: "div.test", descriptor: "test div" },
      kind: "style",
      property: "font-size",
      before: "12px",
      after: "14px"
    };

    const intent: IntentPromptInput = {
      operation: { action: "remove", regionId: "r1" },
      sourceContext: {
        region: { 
          id: "r1", 
          rect: { left: 0, top: 0, width: 10, height: 10 }, 
          viewportBox: { left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10 },
          pageMode: "html", 
          userIntent: "remove this block", 
          anchor: { kind: "visual", confidence: "low" } 
        },
        empty: false,
        candidates: [],
        nearby: [],
        confidence: "low"
      }
    };

    const result = buildUnifiedPrompt([patch], [intent], { language: "en", page: dummyPage });
    expect(result.ok).toBe(true);
    
    if (result.ok) {
      const prompt = result.prompt;
      
      // Should have TodoList
      expect(prompt).toContain("Execution TodoList:");
      
      // Should contain the intent op
      expect(prompt).toContain("- [ ] TASK-1 | REMOVE |");
      
      // Should contain the patch op
      expect(prompt).toContain("- [ ] TASK-2 | STYLE | Target: test div | Details: Change-1");
      
      // Should contain the final checklist
      expect(prompt).toContain("Final alignment checklist:");
      
      // Should NOT contain repetitive expected results inside the detail block
      // Instead it's in the global rules
      expect(prompt).toContain("Remove operation rules:");
      expect(prompt).toContain("Remove the selected region from the source HTML/CSS");
    }
  });
});
