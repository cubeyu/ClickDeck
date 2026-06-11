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
  it("identifies large containers based on area", async () => {
    // We need to import isLargeContainer to test it directly or test via getEditableTarget
    const { isLargeContainer } = await import("./selection");

    const el = document.createElement("div");
    // Mock getBoundingClientRect
    el.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000,
      x: 0, y: 0, toJSON: () => {}
    });

    // 1000x1000 is 1M. viewport is 1024x768 (786k). 40% is ~314k.
    expect(isLargeContainer(el)).toBe(true);

    // Make it small
    el.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100,
      x: 0, y: 0, toJSON: () => {}
    });
    expect(isLargeContainer(el)).toBe(false);
  });

  it("getEditableTarget falls back to first specific editable child if target is large container", async () => {
    const { getEditableTarget } = await import("./selection");

    document.body.innerHTML = `
      <div id="large-container">
        <span id="child">Target Text</span>
      </div>
    `;

    const largeContainer = document.getElementById("large-container") as HTMLElement;
    const child = document.getElementById("child") as HTMLElement;

    largeContainer.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000,
      x: 0, y: 0, toJSON: () => {}
    });

    child.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100,
      x: 0, y: 0, toJSON: () => {}
    });

    // When clicking large container (and it's not currently selected), it falls back to child
    expect(getEditableTarget(largeContainer)).toBe(child);

    // If large container IS already selected, it does NOT fall back (so controller can clear it)
    expect(getEditableTarget(largeContainer, largeContainer)).toBe(largeContainer);
  });
});

