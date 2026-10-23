// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { SharedElementLocator, SharedProjectSnapshot, SharedTask } from "../shared/collaboration-contract";
import { buildCollaborationReviewItems, getVisibleCollaborationReviewTarget, resolveCollaborationReviewTarget, reviewLocation, reviewChangeSummary, canScrollReviewTarget } from "./collaboration-review";

function locator(cssPath: string, descriptor: string): SharedElementLocator {
  return {
    descriptor,
    tagName: descriptor.split(/[ .]/)[0],
    cssPath,
    nthOfTypePath: cssPath,
    siblingIndex: 0,
    selectorStability: "high"
  };
}

function task(id: string, sequence: number, input: Omit<SharedTask, "id" | "sequence">): SharedTask {
  return { id, sequence, ...input };
}

function makeSnapshot(): SharedProjectSnapshot {
  const heading = locator("#heading", "h1.title");
  const primary = locator("#primary", "a.button.primary");
  const secondary = locator("#secondary", "a.button");
  return {
    version: 1,
    project: { version: 1, id: "project", title: "Test", pageFingerprint: "a".repeat(64), ownerMemberId: "owner", createdAt: 1, lastActivityAt: 1, expiresAt: 2 },
    members: [{ version: 1, id: "reviewer", projectId: "project", displayName: "审阅者", role: "member", joinedAt: 1 }],
    submissions: [{
      version: 1,
      id: "submission",
      projectId: "project",
      memberId: "reviewer",
      memberDisplayName: "审阅者",
      pageFingerprint: "a".repeat(64),
      submittedAt: 10,
      tasks: [
        ...[91, 93, 95, 97].map((size, index) => task(`heading-${index}`, index, { kind: "style", summary: "h1", locator: heading, property: "fontSize", before: index ? `${89 + index * 2}px` : "", after: `${size}px` })),
        ...[18, 20, 22].map((size, index) => task(`primary-${index}`, index + 4, { kind: "style", summary: "primary", locator: primary, property: "fontSize", before: index ? `${16 + index * 2}px` : "", after: `${size}px` })),
        task("secondary", 7, { kind: "content", summary: "secondary", locator: secondary, before: "查看行程", after: "1行程" })
      ]
    }]
  };
}

describe("collaboration review mapping", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("reports explicit page order without pretending hidden slides can be scrolled into view", () => {
    document.body.innerHTML = '<section class="slide"><h2>第一页</h2></section><section class="slide" hidden><h1 id="heading">第二页标题</h1></section>';
    const result = buildCollaborationReviewItems(makeSnapshot(), "zh");
    if (!result.ok) throw Error("missing items");
    expect(reviewLocation(result.items[0], "zh")).toBe("第 2 页（结构顺序） · 第二页标题");
    expect(canScrollReviewTarget(document.querySelector("#heading")!)).toBe(false);
    expect(reviewChangeSummary(result.items[0])).toBe("字号 → 97px");
    expect(reviewLocation(result.items[0], "zh", false)).not.toContain("第 2 页");
  });

  it("uses section names for ordinary pages and acknowledges missing locations", () => {
    document.body.innerHTML = '<section><h1 id="heading">项目概况</h1></section><section>其他内容</section>';
    const result = buildCollaborationReviewItems(makeSnapshot(), "zh");
    if (!result.ok) throw Error("missing items");
    expect(reviewLocation(result.items[0], "zh")).toBe("区域 · 项目概况");
    document.body.innerHTML = "";
    expect(reviewLocation(result.items[0], "zh")).toBe("页码／位置未能确认");
  });

  it("reuses team compaction so eight source changes become three review items", () => {
    const result = buildCollaborationReviewItems(makeSnapshot(), "zh");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(3);
    expect(result.items.map((item) => item.number)).toEqual([1, 2, 3]);
    expect(result.items[0].sourceIds).toHaveLength(4);
    expect(result.items[0].contributorId).toBe("reviewer");
    expect(result.items[0].description).toContain("字号 → 97px");
    expect(result.items[1].description).toContain("字号 → 22px");
    expect(result.items[2].description).toContain("文字 → 1行程");
  });

  it("marks different contributors requesting different final values as conflicts", () => {
    const snapshot = makeSnapshot();
    snapshot.submissions.push({
      version: 1,
      id: "owner-submission",
      projectId: "project",
      memberId: "owner",
      memberDisplayName: "创建者",
      pageFingerprint: "a".repeat(64),
      submittedAt: 20,
      tasks: [task("owner-heading", 0, { kind: "style", summary: "h1", locator: locator("#heading", "h1.title"), property: "fontSize", before: "80px", after: "110px" })]
    });
    const result = buildCollaborationReviewItems(snapshot, "zh");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.filter((item) => item.locator === "#heading")).toHaveLength(2);
    expect(result.items.filter((item) => item.locator === "#heading").every((item) => item.conflict)).toBe(true);
  });

  it("resolves safe page targets but never targets ClickDeck UI or invalid selectors", () => {
    document.body.innerHTML = `<h1 id="heading">Title</h1><div data-clickdeck="true"><button id="extension-button">Tool</button></div>`;
    const result = buildCollaborationReviewItems(makeSnapshot(), "zh");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(resolveCollaborationReviewTarget(result.items[0])).toBe(document.querySelector("#heading"));
    expect(resolveCollaborationReviewTarget({ ...result.items[0], locator: "[" })).toBeNull();
    expect(resolveCollaborationReviewTarget({ ...result.items[0], locator: "#extension-button" })).toBeNull();
  });

  it("only treats connected, visible, in-viewport targets as marker candidates", () => {
    document.body.innerHTML = `<section id="slide"><h1 id="heading">Title</h1></section>`;
    const result = buildCollaborationReviewItems(makeSnapshot(), "zh");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const heading = document.querySelector<HTMLElement>("#heading")!;
    heading.getBoundingClientRect = () => ({ x: 10, y: 20, left: 10, top: 20, right: 210, bottom: 80, width: 200, height: 60, toJSON: () => ({}) });
    expect(getVisibleCollaborationReviewTarget(result.items[0])?.element).toBe(heading);

    heading.getBoundingClientRect = () => ({ x: 10, y: -100, left: 10, top: -100, right: 210, bottom: -40, width: 200, height: 60, toJSON: () => ({}) });
    expect(getVisibleCollaborationReviewTarget(result.items[0])).toBeNull();

    heading.getBoundingClientRect = () => ({ x: 10, y: 20, left: 10, top: 20, right: 210, bottom: 80, width: 200, height: 60, toJSON: () => ({}) });
    document.querySelector("#slide")?.classList.add("clickdeck-presentation-hidden-slide");
    expect(getVisibleCollaborationReviewTarget(result.items[0])).toBeNull();
  });
});
