// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { SharedProjectSnapshot, SharedTask } from "../shared/collaboration-contract";
import { buildLocalDraftItems, proposalLocationKey, isLocalAdjustment } from "./collaboration-drafts";
import { getVisibleCollaborationReviewTarget, resolveCollaborationReviewTarget } from "./collaboration-review";

const participation = { projectId: "p", memberId: "me", projectTitle: "Test", role: "owner" as const, expiresAt: Date.now() + 100000 };
const fingerprint = "a".repeat(64);
const locator = { cssPath: "#heading", tagName: "h1", descriptor: "h1", nthOfTypePath: "h1", siblingIndex: 0, selectorStability: "high" as const };
const task = (id = "font", after = "40px"): SharedTask => ({ id, kind: "style", sequence: 0, summary: "h1", property: "fontSize", before: "", after, locator });

describe("unified local draft projection", () => {
  it("compacts repeated edits and keeps a stable draft identity when patch IDs change", () => {
    const first = buildLocalDraftItems([task(), task("later", "42px")], null, participation, fingerprint, "zh");
    const next = buildLocalDraftItems([task("new", "44px")], null, participation, fingerprint, "zh");
    expect(first).toHaveLength(1); expect(first[0].task.after).toBe("42px");
    expect(first[0].id).toBe(next[0].id); expect(first[0].contributor).toBe("我");
  });
  it("removes unchanged submitted values from the local pending projection without mutating either source", () => {
    const items = buildLocalDraftItems([task()], null, participation, fingerprint, "en");
    const snapshot: SharedProjectSnapshot = { version: 1, project: { version: 1, id: "p", title: "Test", pageFingerprint: fingerprint, ownerMemberId: "me", createdAt: 0, lastActivityAt: 0, expiresAt: participation.expiresAt }, members: [], submissions: [{ version: 1, id: "s", projectId: "p", memberId: "me", memberDisplayName: "Me", pageFingerprint: fingerprint, submittedAt: 1, tasks: [task()] }] };
    expect(buildLocalDraftItems([task()], snapshot, participation, fingerprint, "en")).toEqual([]);
    expect(items).toHaveLength(1); expect(snapshot.submissions[0].tasks).toHaveLength(1);
  });
  it("groups exact element properties but not two region opinions sharing an anchor", () => {
    const region: SharedTask = { id: "region", sequence: 1, kind: "intent", summary: "Use Tabs", source: { userIntent: "Use Tabs", pageMode: "long", anchor: { kind: "section", locator, label: "Heading area", confidence: "high" }, contents: ["Heading area"], nearby: [], confidence: "high" } };
    const items = buildLocalDraftItems([task(), { ...task("color", "#123456"), property: "color" }, region, { ...region, id: "other" }], null, participation, fingerprint, "en");
    expect(items).toHaveLength(4); expect(proposalLocationKey(items[0])).toBe(proposalLocationKey(items[1]));
    expect(proposalLocationKey(items[2])).not.toBe(proposalLocationKey(items[3]));
    expect(isLocalAdjustment(region)).toBe(false);
  });
  it("does not locate ambiguous selectors; region geometry uses the recorded anchor-relative box", () => {
    document.body.innerHTML = '<h1 id="heading"></h1><i class="duplicate"></i><i class="duplicate"></i>';
    const item = buildLocalDraftItems([task()], null, participation, fingerprint, "en")[0];
    expect(resolveCollaborationReviewTarget({ ...item, locator: ".duplicate" })).toBeNull();
    const heading = document.querySelector('h1')!;
    heading.getBoundingClientRect = () => new DOMRect(10, 20, 200, 100);
    const region = { userIntent: "Move", pageMode: "long" as const, relativeBox: { left: 10, top: 20, width: 30, height: 40, right: 40, bottom: 60 }, anchor: { kind: "section" as const, locator, confidence: "high" as const }, contents: [], nearby: [], confidence: "high" as const };
    const visible = getVisibleCollaborationReviewTarget({ ...item, task: { id: "r", sequence: 0, kind: "intent", summary: "Move", source: region } });
    expect(visible?.rect.left).toBe(30); expect(visible?.rect.width).toBe(60);
    expect(visible?.rect.top).toBe(40); expect(visible?.rect.height).toBe(40);
    document.body.innerHTML = "";
  });
});
