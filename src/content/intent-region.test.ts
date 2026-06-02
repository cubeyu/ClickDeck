// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import {
  normalizeRect,
  toDocumentRect,
  toRelativeRect,
  detectPageMode,
  findRegionAnchor,
  createIntentRegion
} from "./intent-region";

describe("Intent Region Core Functions", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // Reset global scroll values for JSDOM
    window.scrollX = 0;
    window.scrollY = 0;
  });

  it("normalizeRect should fill missing right and bottom", () => {
    const rect = normalizeRect({ left: 10, top: 20, width: 100, height: 50 });
    expect(rect.right).toBe(110);
    expect(rect.bottom).toBe(70);
  });

  it("toDocumentRect should add scroll offsets", () => {
    const viewportBox = normalizeRect({ left: 10, top: 20, width: 100, height: 50 });
    const docBox = toDocumentRect(viewportBox, 15, 25);
    expect(docBox.left).toBe(25);
    expect(docBox.top).toBe(45);
    expect(docBox.right).toBe(125);
    expect(docBox.bottom).toBe(95);
  });

  it("toRelativeRect should correctly compute percentage based coordinates", () => {
    const anchorRect = normalizeRect({ left: 100, top: 100, width: 400, height: 400 });
    const box = normalizeRect({ left: 200, top: 300, width: 100, height: 50 });
    
    const rel = toRelativeRect(box, anchorRect);
    // (200 - 100) / 400 = 0.25 => 25%
    expect(rel.left).toBe(25);
    // (300 - 100) / 400 = 0.50 => 50%
    expect(rel.top).toBe(50);
    // 100 / 400 => 25%
    expect(rel.width).toBe(25);
    // 50 / 400 => 12.5%
    expect(rel.height).toBe(12.5);
    expect(rel.right).toBe(50);
    expect(rel.bottom).toBe(62.5);
  });

  it("detectPageMode should identify slide mode by aria-roledescription", () => {
    const div = document.createElement("div");
    div.setAttribute("aria-roledescription", "slide");
    document.body.appendChild(div);
    
    expect(detectPageMode(document.body)).toBe("slide");
  });

  it("detectPageMode should identify long mode based on scrollHeight", () => {
    // Override properties just for this test
    Object.defineProperty(document.body, 'scrollHeight', { value: 3000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });

    expect(detectPageMode(document.body)).toBe("long");
  });

  it("findRegionAnchor should find overlapping slide in slide mode", () => {
    document.body.innerHTML = `
      <section class="slide" id="slide1" style="width: 800px; height: 600px;"></section>
      <section class="slide" id="slide2" style="width: 800px; height: 600px;"></section>
    `;

    const slides = document.querySelectorAll(".slide");
    // Mock rects
    (slides[0] as any).getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });
    (slides[1] as any).getBoundingClientRect = () => ({ left: 0, top: 600, width: 800, height: 600, right: 800, bottom: 1200 });

    const box = normalizeRect({ left: 100, top: 700, width: 100, height: 100 });
    
    const anchor = findRegionAnchor(box, document.body);
    expect(anchor.kind).toBe("slide");
    expect(anchor.locator?.descriptor).toContain("#slide2");
  });

  it("createIntentRegion should preserve userIntent and compute correct properties", () => {
    document.body.innerHTML = `
      <section class="slide" id="slide1" style="width: 800px; height: 600px;"></section>
    `;
    const slide = document.querySelector("#slide1") as HTMLElement;
    (slide as any).getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });

    const box = normalizeRect({ left: 200, top: 300, width: 100, height: 100 });
    const userIntent = "I want to delete this specific box please.";

    const region = createIntentRegion({
      action: "delete",
      userIntent,
      viewportBox: box,
      root: document.body
    });

    expect(region.action).toBe("delete");
    expect(region.userIntent).toBe(userIntent); // Must preserve exactly what user said
    expect(region.pageMode).toBe("slide");
    expect(region.anchor.kind).toBe("slide");
    expect(region.anchor.locator?.descriptor).toContain("#slide1");
    expect(region.relativeBox?.left).toBe(25); // (200 / 800) * 100
    expect(region.relativeBox?.top).toBe(50);  // (300 / 600) * 100
  });
});
