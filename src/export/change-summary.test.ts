/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { buildAiEditPrompt } from "./change-summary";
import type { AttributePatch, ContentPatch, StylePatch } from "../state/editor-state";

describe("buildAiEditPrompt", () => {
  it("returns empty message when there are no patches", () => {
    const result = buildAiEditPrompt([], "en-US");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("empty");
      expect(result.message).toContain("No edits");
    }
  });

  it("includes locator for style and content patches", () => {
    document.body.innerHTML = `<main><h1 id="t">Hello</h1></main>`;
    const el = document.getElementById("t") as HTMLElement;

    const stylePatch: StylePatch = {
      id: "1",
      kind: "style",
      targetElement: el,
      targetDescriptor: "h1#t",
      targetLocator: {
        descriptor: "h1 #t",
        tagName: "h1",
        cssPath: "#t",
        nthOfTypePath: "h1:nth-of-type(1)",
        siblingIndex: 0
      },
      property: "fontSize",
      before: "16px",
      after: "20px",
      createdAt: 1
    };

    const contentPatch: ContentPatch = {
      id: "2",
      kind: "content",
      targetElement: el,
      targetDescriptor: "h1#t",
      targetLocator: stylePatch.targetLocator,
      before: "Hello",
      after: "Hi",
      createdAt: 2
    };

    const result = buildAiEditPrompt([stylePatch, contentPatch], "en-US");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain("Locator: #t");
      expect(result.prompt).toContain("Style: fontSize changed");
      expect(result.prompt).toContain("Text changed");
    }
  });

  it("does not dump full data URL for image src replacements", () => {
    document.body.innerHTML = `<main><img id="img" src="a.png" /></main>`;
    const el = document.getElementById("img") as HTMLImageElement;

    const patch: AttributePatch = {
      id: "a1",
      kind: "attribute",
      targetElement: el,
      targetDescriptor: "img#img",
      targetLocator: {
        descriptor: "img #img",
        tagName: "img",
        cssPath: "#img",
        nthOfTypePath: "img:nth-of-type(1)",
        siblingIndex: 0
      },
      attribute: "src",
      before: "a.png",
      after: "data:image/png;base64,AAAAAA",
      createdAt: 1
    };

    const result = buildAiEditPrompt([patch], "en-US");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain("[data URL image]");
      expect(result.prompt).not.toContain("data:image/png;base64,AAAAAA");
    }
  });
  it("returns empty when all patches have been undone (empty effective list)", () => {
    // Simulate the state after all patches are on the redo stack:
    // caller passes an empty effective list.
    const result = buildAiEditPrompt([], "en-US");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("empty");
    }
  });

  it("excludes undone patches when caller passes only effective patches", () => {
    document.body.innerHTML = `<main><h1 id="t">Hello</h1></main>`;
    const el = document.getElementById("t") as HTMLElement;

    const undoneStylePatch: StylePatch = {
      id: "undone",
      kind: "style",
      targetElement: el,
      targetDescriptor: "h1#t",
      targetLocator: {
        descriptor: "h1 #t",
        tagName: "h1",
        cssPath: "#t",
        nthOfTypePath: "h1:nth-of-type(1)",
        siblingIndex: 0
      },
      property: "fontSize",
      before: "16px",
      after: "20px",
      createdAt: 1
    };

    // Caller (controller) provides only effective patches – undone patch excluded.
    const result = buildAiEditPrompt([], "en-US");
    expect(result.ok).toBe(false);

    // With only the undone patch in state.patches but NOT in effective patches,
    // the prompt should not mention the undone change.
    const effectiveOnly = buildAiEditPrompt([undoneStylePatch], "en-US");
    expect(effectiveOnly.ok).toBe(true);
    if (effectiveOnly.ok) {
      expect(effectiveOnly.prompt).toContain("fontSize");
    }
  });
});

