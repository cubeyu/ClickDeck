// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildIntentPrompt, IntentPromptInput } from "./intent-prompt";

function mockRegionContext(
  action: "intent" | "move",
  userIntent: string,
  empty: boolean,
  candidates: any[] = [],
  nearby: any[] = []
): IntentPromptInput {
  return {
    operation: {
      id: "op1",
      action,
      source: {} as any,
      createdAt: Date.now()
    },
    sourceContext: {
      region: {
        id: "r1",
        action,
        userIntent,
        pageMode: "slide",
        viewportBox: { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 },
        documentBox: { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 },
        anchor: { kind: "slide", confidence: "high" },
        createdAt: Date.now()
      },
      candidates,
      nearby,
      empty,
      confidence: "high"
    }
  };
}

describe("Intent Prompt Builder", () => {
  it("returns empty message for no inputs", () => {
    const result = buildIntentPrompt([], { language: "en", page: { url: "", title: "" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("empty");
    }
  });

  it("builds natural-language intent prompt for empty visual area with nearby references", () => {
    const input = mockRegionContext("intent", "Add a title here", true, [], [
      { direction: "above", summary: "[Image]" }
    ]);

    const result = buildIntentPrompt([input], { language: "en", page: { url: "test.com", title: "Test" } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const prompt = result.prompt;
      // Global and Page sections
      expect(prompt).toContain("ClickDeck AI edit prompt");
      expect(prompt).toContain("Global rules:");
      expect(prompt).toContain("URL: test.com");
      
      // Operation sections
      expect(prompt).toContain("Intent notes:");
      expect(prompt).toContain("1. User intent");
      expect(prompt).toContain('User note: "Add a title here"');
      
      // Empty area wording
      expect(prompt).toContain("The selected region is an empty visual area. Treat it as the intended placement area, not as an existing element to edit.");
      expect(prompt).toContain("- above: [Image]");
      
      // Standard ending
      expect(prompt).toContain("To do:");
      expect(prompt).toContain("Implement the user note inside the selected region.");
      expect(prompt).toContain("Infer whether the note means add, delete, replace, restyle, or a small local layout adjustment");
      expect(prompt).toContain("Do not:");
      expect(prompt).toContain("Do not modify unrelated content");
      
      // Must not contain scattered Allowed changes block
      expect(prompt).not.toContain("Allowed changes:");
      expect(prompt).not.toContain("If uncertain:");
    }
  });

  it("keeps delete-like wording as user intent without requiring an action category", () => {
    const input = mockRegionContext("intent", "Remove this paragraph", false, [
      { unit: { kind: "textLine" } }
    ]);

    const result = buildIntentPrompt([input], { language: "en", page: { url: "", title: "" } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const prompt = result.prompt;
      expect(prompt).toContain('User note: "Remove this paragraph"');
      expect(prompt).toContain("Do not redesign the whole slide/page");
    }
  });

  it("builds restyle-like prompt without omitting style reference", () => {
    const input = mockRegionContext("intent", "Make this red", false, [
      { unit: { kind: "textLine" } }
    ]);

    const result = buildIntentPrompt([input], { language: "en", page: { url: "", title: "" } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain('User note: "Make this red"');
      expect(result.prompt).toContain("Style reference:");
    }
  });

  it("handles multiple operations correctly", () => {
    const op1 = mockRegionContext("intent", "Remove first", false);
    const op2 = mockRegionContext("intent", "Add second", true);

    const result = buildIntentPrompt([op1, op2], { language: "en", page: { url: "", title: "" } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain("1. User intent");
      expect(result.prompt).toContain("2. User intent");
      expect(result.prompt).toContain('User note: "Remove first"');
      expect(result.prompt).toContain('User note: "Add second"');
    }
  });

  it("handles move operation with both source and target", () => {
    const input = mockRegionContext("move", "Move this to there", false);
    // Add targetContext
    input.targetContext = {
      region: {
        id: "r2",
        action: "move",
        userIntent: "Move this to there",
        pageMode: "slide",
        viewportBox: { left: 200, top: 200, width: 100, height: 100, right: 300, bottom: 300 },
        documentBox: { left: 200, top: 200, width: 100, height: 100, right: 300, bottom: 300 },
        anchor: { kind: "slide", confidence: "high" },
        createdAt: Date.now()
      },
      candidates: [],
      nearby: [{ direction: "above", summary: "[Title]" } as any],
      empty: true,
      confidence: "medium"
    };

    const result = buildIntentPrompt([input], { language: "en", page: { url: "", title: "" } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const prompt = result.prompt;
      expect(prompt).toContain('Move instruction');
      expect(prompt).toContain('Instruction: Move Source region A to Target region B.');
      expect(prompt).not.toContain('User note: "Move this to there"');
      expect(prompt).toContain('Source region A:');
      expect(prompt).toContain('Region contents A (Source):');
      expect(prompt).toContain('Target region B:');
      expect(prompt).toContain('Target region B placement reference:');
      expect(prompt).toContain('Use Target region B as the destination guide for placement and alignment.');
      expect(prompt).toContain('treat that content as visual context only, not as content to edit');
      expect(prompt).toContain('- above: [Title]');
      expect(prompt).toContain('Move the contents of Source region A into the placement indicated by Target region B');
      expect(prompt).toContain("Preserve any obvious spatial relationship implied by the user's boxes");
      expect(prompt).toContain('keep the move conservative and ask for clarification instead of guessing a strong alignment rule');
      expect(prompt).toContain('Preserve the source content, approximate size, proportions, visual hierarchy, and existing style');
      expect(prompt).toContain('Align with nearby elements when the alignment relationship is visually obvious');
      expect(prompt).toContain('Do not convert this into a full redesign');
    }
  });

  it("returns error if move operation is missing targetContext", () => {
    const input = mockRegionContext("move", "Move this to there", false);
    
    const result = buildIntentPrompt([input], { language: "en", page: { url: "", title: "" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("missing target region");
    }
  });
});
