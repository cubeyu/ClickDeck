import { describe, expect, it } from "vitest";
import type { SharedProjectSnapshot, SharedTask } from "../shared/collaboration-contract";
import { pendingCollaborationCount, pendingCollaborationTasks } from "./collaboration-pending";

const font = (after: string, id = "font"): SharedTask => ({ id, sequence: 0, kind: "style", summary: "font", property: "fontSize", before: "", after, locator: { tagName: "h1", cssPath: "#heading", descriptor: "h1", nthOfTypePath: "h1", siblingIndex: 0, selectorStability: "high" } });
const snapshot = (tasks: SharedTask[], memberId = "me") => ({ submissions: [{ memberId, submittedAt: 1, tasks }] }) as SharedProjectSnapshot;

describe("pending collaboration display count", () => {
  it("compacts repeated adjustments without mutating the local history", () => {
    const tasks = [font("40px"), font("42px", "last")];
    expect(pendingCollaborationCount(tasks, null, "me")).toBe(1);
    expect(tasks).toHaveLength(2);
  });
  it("compares the latest proposed value, not generated IDs, sequence or before metadata", () => {
    expect(pendingCollaborationCount([font("42px", "new")], snapshot([{ ...font("42px"), sequence: 9, before: "24px" }]), "me")).toBe(0);
    expect(pendingCollaborationCount([font("44px")], snapshot([font("42px")]), "me")).toBe(1);
    expect(pendingCollaborationCount([], snapshot([font("42px")]), "me")).toBe(0);
  });
  it("never treats someone else's matching proposal as my submission", () => {
    expect(pendingCollaborationCount([font("42px")], snapshot([font("42px")], "other"), "me")).toBe(1);
  });
  it("returns only changed proposals for the capsule, retaining original task data", () => {
    const color: SharedTask = { ...font("#123456", "color"), property: "color" };
    const local = [font("42px"), color];
    const pending = pendingCollaborationTasks(local, snapshot([font("42px")]), "me");
    expect(pending).toEqual([{ ...color, sequence: 1 }]);
    expect(local).toEqual([font("42px"), color]);
  });
  it("takes submission order into account and includes changed free-form intent", () => {
    const intent: SharedTask = { id: "intent", sequence: 1, kind: "intent", summary: "Move this" };
    const state = snapshot([font("44px"), intent]);
    state.submissions.push({ ...state.submissions[0], submittedAt: 0, tasks: [font("42px")] });
    expect(pendingCollaborationCount([font("44px"), { ...intent, summary: "Keep this" }], state, "me")).toBe(1);
  });
  it("does not leave a submitted region request pending because validation reordered keys", () => {
    const source = { userIntent: "Use Tabs", pageMode: "long" as const, anchor: { kind: "section" as const, label: "Header", confidence: "high" as const }, contents: ["Title"], nearby: [], confidence: "high" as const };
    const local: SharedTask = { id: "intent", sequence: 0, kind: "intent", summary: "Use Tabs", source };
    const remote: SharedTask = { ...local, source: { confidence: source.confidence, nearby: [], contents: source.contents, anchor: { confidence: "high", label: "Header", kind: "section" }, pageMode: source.pageMode, userIntent: source.userIntent } };
    expect(pendingCollaborationCount([local], snapshot([remote]), "me")).toBe(0);
  });
});
