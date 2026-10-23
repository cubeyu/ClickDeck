// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { startReviewPreview } from "./collaboration-preview";
import type { CollaborationReviewItem } from "./collaboration-review";

function item(kind: "style" | "content" = "style"): CollaborationReviewItem {
  return { id: "i", number: 1, contributorId: "m", contributor: "M", sourceIds: ["s/t"], locator: "#heading", targetLabel: "A", description: "A", conflict: false,
    task: { id: "t", sequence: 0, kind, summary: "A", property: "fontSize", before: "A", after: kind === "style" ? "86px" : "B", locator: { tagName: "h1", cssPath: "#heading", nthOfTypePath: "#heading", idHint: "heading", descriptor: "A", siblingIndex: 0 } } };
}
afterEach(() => { document.body.innerHTML = ""; document.head.querySelectorAll("[data-clickdeck]").forEach(node => node.remove()); vi.unstubAllGlobals(); });
describe("temporary review preview", () => {
  it("uses removable CSS without modifying the source inline styles", () => {
    vi.stubGlobal("CSS", { supports: () => true });
    document.body.innerHTML = '<h1 id="heading" style="font-size:56px">A</h1>';
    const before = document.body.innerHTML;
    const preview = startReviewPreview(item());
    expect(preview).not.toBeNull();
    expect(document.head.querySelector("style")?.textContent).toContain("86px");
    expect(document.body.innerHTML).toBe(before);
    preview!.restore();
    expect(document.head.querySelector("style")).toBeNull();
  });
  it("restores literal leaf text without interpreting HTML", () => {
    document.body.innerHTML = '<h1 id="heading">A</h1>';
    const change = item("content"); change.task.after = "<img src=x onerror=alert(1)>";
    const preview = startReviewPreview(change)!;
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("h1")?.textContent).toBe(change.task.after);
    preview.restore(); expect(document.querySelector("h1")?.textContent).toBe("A");
  });
  it("does not overwrite an independent text change during preview", () => {
    document.body.innerHTML = '<h1 id="heading">A</h1>';
    const preview = startReviewPreview(item("content"))!;
    document.querySelector("h1")!.textContent = "C";
    preview.restore(); expect(document.querySelector("h1")?.textContent).toBe("C");
  });
  it("refuses changed text, complex text, ambiguous locators and network CSS", () => {
    vi.stubGlobal("CSS", { supports: () => true });
    document.body.innerHTML = '<h1 id="heading">Different</h1>';
    expect(startReviewPreview(item("content"))).toBeNull();
    document.querySelector("h1")!.innerHTML = "<span>A</span>";
    expect(startReviewPreview(item("content"))).toBeNull();
    const change = item(); change.task.after = "url(https://example.com/tracker)";
    expect(startReviewPreview(change)).toBeNull();
    document.body.innerHTML += '<h1 id="heading">A</h1>';
    expect(startReviewPreview(item())).toBeNull();
  });
});
