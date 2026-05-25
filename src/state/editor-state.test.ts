/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildStorageKey,
  hydratePersistedPatches,
  serializePatches,
  type ContentPatch,
  type AttributePatch,
  type PersistedPatch,
  type StylePatch
} from "./editor-state";

describe("buildStorageKey", () => {
  it("is stable for the same URL and ignores hash", () => {
    expect(buildStorageKey("https://example.com/a?x=1#top")).toBe(buildStorageKey("https://example.com/a?x=1#other"));
  });
});

describe("serializePatches", () => {
  it("does not include HTMLElement fields in persisted patches", () => {
    document.body.innerHTML = `<main><h1 id="t">Hello</h1></main>`;
    const el = document.getElementById("t") as HTMLElement;

    const patch: StylePatch = {
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
      before: "",
      after: "20px",
      createdAt: 1
    };

    const persisted = serializePatches([patch]);
    expect(persisted).toHaveLength(1);
    // @ts-expect-error intentional runtime check
    expect(persisted[0].targetElement).toBeUndefined();
  });

  it("serializes attribute patches with attribute name", () => {
    document.body.innerHTML = `<main><img id="img" src="a.png" /></main>`;
    const el = document.getElementById("img") as HTMLElement;

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
      after: "data:image/png;base64,AA==",
      createdAt: 1
    };

    const persisted = serializePatches([patch]);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].kind).toBe("attribute");
    expect(persisted[0].attribute).toBe("src");
  });
});

describe("hydratePersistedPatches", () => {
  it("skips patches whose locator cannot be resolved", () => {
    document.body.innerHTML = `<main><h1 id="t">Hello</h1></main>`;
    const warn = vi.fn();

    const persisted: PersistedPatch[] = [
      {
        id: "1",
        kind: "style",
        targetDescriptor: "div.missing",
        targetLocator: {
          descriptor: "div .missing",
          tagName: "div",
          cssPath: "div.missing",
          nthOfTypePath: "div:nth-of-type(1)",
          siblingIndex: 0
        },
        property: "fontSize",
        before: "",
        after: "20px",
        createdAt: 1
      }
    ];

    const hydrated = hydratePersistedPatches(persisted, { warn });
    expect(hydrated).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it("hydrates style and content patches when locator resolves", () => {
    document.body.innerHTML = `<main><h1 id="t">Hello</h1></main>`;

    const persisted: PersistedPatch[] = [
      {
        id: "1",
        kind: "style",
        targetDescriptor: "h1#t",
        targetLocator: {
          descriptor: "h1 #t",
          tagName: "h1",
          cssPath: "#t",
          nthOfTypePath: "h1:nth-of-type(1)",
          siblingIndex: 0
        },
        property: "fontSize",
        before: "",
        after: "20px",
        createdAt: 1
      },
      {
        id: "2",
        kind: "content",
        targetDescriptor: "h1#t",
        targetLocator: {
          descriptor: "h1 #t",
          tagName: "h1",
          cssPath: "#t",
          nthOfTypePath: "h1:nth-of-type(1)",
          siblingIndex: 0
        },
        before: "Hello",
        after: "Hi",
        createdAt: 2
      }
    ];

    const hydrated = hydratePersistedPatches(persisted);
    expect(hydrated).toHaveLength(2);
    expect(hydrated[0].kind).toBe("style");
    expect(hydrated[1].kind).toBe("content");
    expect((hydrated[0] as StylePatch).targetElement).toBeInstanceOf(HTMLElement);
    expect((hydrated[1] as ContentPatch).targetElement).toBeInstanceOf(HTMLElement);
  });
});
