// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { getTabSwitchTarget } from "./selection";

describe("getTabSwitchTarget", () => {
  it("Tab prefers parent when available", () => {
    document.body.innerHTML = `
      <main>
        <div id="parent">
          <span id="child">Hello</span>
        </div>
      </main>
    `;

    const child = document.getElementById("child") as HTMLElement;
    const parent = document.getElementById("parent") as HTMLElement;
    expect(getTabSwitchTarget(child, "forward")).toBe(parent);
  });

  it("Shift+Tab prefers first descendant when available", () => {
    document.body.innerHTML = `
      <main>
        <div id="parent">
          <span id="child">Hello</span>
        </div>
      </main>
    `;

    const parent = document.getElementById("parent") as HTMLElement;
    const child = document.getElementById("child") as HTMLElement;
    expect(getTabSwitchTarget(parent, "backward")).toBe(child);
  });

  it("falls back to descendant when parent is not selectable (body/html)", () => {
    document.body.innerHTML = `
      <div id="root">
        <span id="child">Hello</span>
      </div>
    `;

    const root = document.getElementById("root") as HTMLElement;
    const child = document.getElementById("child") as HTMLElement;

    // root's parent is body (not selectable), so Tab uses first descendant.
    expect(getTabSwitchTarget(root, "forward")).toBe(child);
  });
});

describe("isLargeContainer and getEditableTarget", () => {
  describe("isLargeContainer refinements", () => {
    it("identifies large containers based on area and tag", async () => {
      const { isLargeContainer } = await import("./selection");

      const el = document.createElement("div");
      el.getBoundingClientRect = () => ({
        left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000,
        x: 0, y: 0, toJSON: () => {}
      });

      expect(isLargeContainer(el)).toBe(true);

      // Make it small
      el.getBoundingClientRect = () => ({
        left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100,
        x: 0, y: 0, toJSON: () => {}
      });
      expect(isLargeContainer(el)).toBe(false);
    });

    it("rejects large elements that are not layout tags", async () => {
      const { isLargeContainer } = await import("./selection");
      const el = document.createElement("span");
      el.getBoundingClientRect = () => ({
        left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000,
        x: 0, y: 0, toJSON: () => {}
      });
      expect(isLargeContainer(el)).toBe(false);
    });

    it("rejects large elements with role dialog/navigation", async () => {
      const { isLargeContainer } = await import("./selection");
      const el = document.createElement("div");
      el.getBoundingClientRect = () => ({
        left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000,
        x: 0, y: 0, toJSON: () => {}
      });
      
      el.setAttribute("role", "dialog");
      expect(isLargeContainer(el)).toBe(false);
      
      el.removeAttribute("role");
      el.setAttribute("aria-modal", "true");
      expect(isLargeContainer(el)).toBe(false);
    });
  });

  it("getEditableTarget falls back to first meaningful child if target is large container", async () => {
    const { getEditableTarget } = await import("./selection");

    document.body.innerHTML = `
      <div id="large-container">
        <div id="empty-div"></div>
        <span id="layout-span"></span>
        <button id="child">Target Text</button>
      </div>
    `;

    const largeContainer = document.getElementById("large-container") as HTMLElement;
    const child = document.getElementById("child") as HTMLElement;
    const emptyDiv = document.getElementById("empty-div") as HTMLElement;
    const layoutSpan = document.getElementById("layout-span") as HTMLElement;

    largeContainer.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000,
      x: 0, y: 0, toJSON: () => {}
    });

    child.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100,
      x: 0, y: 0, toJSON: () => {}
    });
    
    emptyDiv.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100,
      x: 0, y: 0, toJSON: () => {}
    });
    
    layoutSpan.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100,
      x: 0, y: 0, toJSON: () => {}
    });

    // When clicking large container (and it's not currently selected), it falls back to child
    // It should skip emptyDiv and layoutSpan because they are not meaningful
    expect(getEditableTarget(largeContainer)).toBe(child);

    // If large container IS already selected, it does NOT fall back (so controller can clear it)
    expect(getEditableTarget(largeContainer, largeContainer)).toBe(largeContainer);
  });
});

