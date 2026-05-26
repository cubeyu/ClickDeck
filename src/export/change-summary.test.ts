/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { buildAiEditPrompt } from "./change-summary";
import type { AttributePatch, ContentPatch, StylePatch } from "../state/editor-state";

const PAGE_EN = { language: "en" as const, page: { url: "https://example.com/", title: "Test Page" } };
const PAGE_ZH = { language: "zh" as const, page: { url: "https://example.com/", title: "Test Page" } };

describe("buildAiEditPrompt", () => {
  it("returns empty message when there are no patches", () => {
    const result = buildAiEditPrompt([], PAGE_EN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("empty");
      expect(result.message).toContain("No edits");
    }
  });

  it("includes page URL and title in English prompt", () => {
    document.body.innerHTML = `<main><h1 id="t">Hello</h1></main>`;
    const el = document.getElementById("t") as HTMLElement;
    const patch: StylePatch = {
      id: "1", kind: "style", targetElement: el, targetDescriptor: "h1#t",
      targetLocator: { descriptor: "h1", tagName: "h1", cssPath: "#t", nthOfTypePath: "h1:nth-of-type(1)", siblingIndex: 0 },
      property: "fontSize", before: "16px", after: "20px", createdAt: 1
    };
    const result = buildAiEditPrompt([patch], PAGE_EN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain("URL: https://example.com/");
      expect(result.prompt).toContain("Title: Test Page");
      expect(result.prompt).toContain("Current active browser page only.");
      expect(result.prompt).toContain("Changes:");
    }
  });

  it("includes page URL and title in Chinese prompt with Chinese headings", () => {
    document.body.innerHTML = `<main><h1 id="t">Hello</h1></main>`;
    const el = document.getElementById("t") as HTMLElement;
    const patch: StylePatch = {
      id: "1", kind: "style", targetElement: el, targetDescriptor: "h1#t",
      targetLocator: { descriptor: "h1", tagName: "h1", cssPath: "#t", nthOfTypePath: "h1:nth-of-type(1)", siblingIndex: 0 },
      property: "fontSize", before: "16px", after: "20px", createdAt: 1
    };
    const result = buildAiEditPrompt([patch], PAGE_ZH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain("URL: https://example.com/");
      expect(result.prompt).toContain("修改列表");
    }
  });

  it("includes locator for style and content patches", () => {
    document.body.innerHTML = `<main><h1 id="t">Hello</h1></main>`;
    const el = document.getElementById("t") as HTMLElement;

    const stylePatch: StylePatch = {
      id: "1", kind: "style", targetElement: el, targetDescriptor: "h1#t",
      targetLocator: { descriptor: "h1 #t", tagName: "h1", cssPath: "#t", nthOfTypePath: "h1:nth-of-type(1)", siblingIndex: 0 },
      property: "fontSize", before: "16px", after: "20px", createdAt: 1
    };

    const contentPatch: ContentPatch = {
      id: "2", kind: "content", targetElement: el, targetDescriptor: "h1#t",
      targetLocator: stylePatch.targetLocator, before: "Hello", after: "Hi", createdAt: 2
    };

    const result = buildAiEditPrompt([stylePatch, contentPatch], PAGE_EN);
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
      id: "a1", kind: "attribute", targetElement: el, targetDescriptor: "img#img",
      targetLocator: { descriptor: "img #img", tagName: "img", cssPath: "#img", nthOfTypePath: "img:nth-of-type(1)", siblingIndex: 0 },
      attribute: "src", before: "a.png", after: "data:image/png;base64,AAAAAA", createdAt: 1
    };

    const result = buildAiEditPrompt([patch], PAGE_EN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prompt).toContain("[data URL image]");
      expect(result.prompt).not.toContain("data:image/png;base64,AAAAAA");
    }
  });

  it("returns empty when all patches have been undone (empty effective list)", () => {
    const result = buildAiEditPrompt([], PAGE_EN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("empty");
    }
  });

  it("excludes undone patches when caller passes only effective patches", () => {
    document.body.innerHTML = `<main><h1 id="t">Hello</h1></main>`;
    const el = document.getElementById("t") as HTMLElement;

    const undoneStylePatch: StylePatch = {
      id: "undone", kind: "style", targetElement: el, targetDescriptor: "h1#t",
      targetLocator: { descriptor: "h1 #t", tagName: "h1", cssPath: "#t", nthOfTypePath: "h1:nth-of-type(1)", siblingIndex: 0 },
      property: "fontSize", before: "16px", after: "20px", createdAt: 1
    };

    // Controller provides only effective patches – undone patches excluded.
    const emptyResult = buildAiEditPrompt([], PAGE_EN);
    expect(emptyResult.ok).toBe(false);

    const effectiveOnly = buildAiEditPrompt([undoneStylePatch], PAGE_EN);
    expect(effectiveOnly.ok).toBe(true);
    if (effectiveOnly.ok) {
      expect(effectiveOnly.prompt).toContain("fontSize");
    }
  });

  it("includes slide context when target is inside a slide container", () => {
    document.body.innerHTML = `<main><section class="slide" data-slide="4"><h1 id="t">Hello</h1></section></main>`;
    const el = document.getElementById("t") as HTMLElement;
    const patch: StylePatch = {
      id: "1", kind: "style", targetElement: el, targetDescriptor: "h1#t",
      targetLocator: { descriptor: "h1", tagName: "h1", cssPath: "#t", nthOfTypePath: "h1:nth-of-type(1)", siblingIndex: 0 },
      property: "fontSize", before: "16px", after: "20px", createdAt: 1
    };
    
    // EN
    const resultEn = buildAiEditPrompt([patch], PAGE_EN);
    expect(resultEn.ok).toBe(true);
    if (resultEn.ok) {
      expect(resultEn.prompt).toContain("Slide/Page Context: Slide 4");
    }

    // ZH
    const resultZh = buildAiEditPrompt([patch], PAGE_ZH);
    expect(resultZh.ok).toBe(true);
    if (resultZh.ok) {
      expect(resultZh.prompt).toContain("所属页面/Slide: Slide 4");
    }
  });
});
