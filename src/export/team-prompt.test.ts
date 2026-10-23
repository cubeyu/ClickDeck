import { describe, expect, it } from "vitest";
import type { SharedElementLocator, SharedProjectSnapshot, SharedTask } from "../shared/collaboration-contract";
import { buildTeamPrompt } from "./team-prompt";

function snapshot(): SharedProjectSnapshot {
  return {
    version: 1,
    project: { version: 1, id: "p", title: "Demo", pageFingerprint: "a".repeat(64), ownerMemberId: "m1", createdAt: 0, lastActivityAt: 0, expiresAt: 1 },
    members: [
      { version: 1, id: "m1", projectId: "p", displayName: "Owner", role: "owner", joinedAt: 0 },
      { version: 1, id: "m2", projectId: "p", displayName: "B", role: "member", joinedAt: 0 }
    ],
    submissions: [
      { version: 1, id: "s2", projectId: "p", memberId: "m2", memberDisplayName: "B", pageFingerprint: "a".repeat(64), submittedAt: 20, tasks: [{ id: "b", sequence: 0, kind: "intent", summary: "Second" }] },
      { version: 1, id: "s1", projectId: "p", memberId: "m1", memberDisplayName: "Owner", pageFingerprint: "a".repeat(64), submittedAt: 10, tasks: [
        { id: "a2", sequence: 1, kind: "content", summary: "First B", before: "A", after: "B" },
        { id: "a1", sequence: 0, kind: "style", summary: "First A", property: "font-size", before: "12px", after: "14px" }
      ] }
    ]
  };
}

function locator(cssPath: string, descriptor: string): SharedElementLocator {
  return {
    descriptor,
    tagName: descriptor.split(/[ .]/)[0],
    cssPath,
    nthOfTypePath: cssPath,
    siblingIndex: 0,
    selectorStability: "medium"
  };
}

function patch(id: string, sequence: number, input: Partial<SharedTask> & Pick<SharedTask, "kind" | "summary">): SharedTask {
  return { id, sequence, ...input };
}

describe("team prompt", () => {
  it("discloses quarantined source tasks instead of presenting a complete export", () => {
    const value = snapshot();
    value.invalidTaskCount = 2;
    const result = buildTeamPrompt(value);
    expect(result.ok && result.prompt).toContain("2 invalid source tasks were quarantined");
  });
  it("uses stable global task ids and preserves contributor evidence", () => {
    const result = buildTeamPrompt(snapshot());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.taskCount).toBe(3);
    expect(result.prompt.indexOf("First A")).toBeLessThan(result.prompt.indexOf("First B"));
    expect(result.prompt.indexOf("First B")).toBeLessThan(result.prompt.indexOf("Second"));
    expect(result.prompt).toContain("TEAM-TASK-1");
    expect(result.prompt).toContain("TEAM-TASK-3");
    expect(result.prompt).toContain("Contributor: B");
    expect(result.prompt).toContain("source-id: s1/a1");
  });

  it("rejects malformed tasks", () => {
    const value = snapshot();
    value.submissions[0].tasks[0].summary = "";
    expect(buildTeamPrompt(value)).toEqual({ ok: false, reason: "unsafe-task", rejectedTaskIds: ["b"] });
  });

  it("compacts eight sequential edits into three final-state tasks", () => {
    const value = snapshot();
    const heading = locator("body > main > section > h1", "h1");
    const primary = locator("body > main > section > a:nth-of-type(1)", "a.button.primary");
    const secondary = locator("body > main > section > a:nth-of-type(2)", "a.button");
    value.submissions = [{
      version: 1,
      id: "submission-1",
      projectId: "p",
      memberId: "m2",
      memberDisplayName: "1",
      pageFingerprint: "a".repeat(64),
      submittedAt: 10,
      tasks: [
        patch("h1-1", 0, { kind: "style", summary: "h1", locator: heading, property: "fontSize", before: "", after: "91.04px" }),
        patch("h1-2", 1, { kind: "style", summary: "h1", locator: heading, property: "fontSize", before: "91.04px", after: "93.04px" }),
        patch("h1-3", 2, { kind: "style", summary: "h1", locator: heading, property: "fontSize", before: "93.04px", after: "95.04px" }),
        patch("h1-4", 3, { kind: "style", summary: "h1", locator: heading, property: "fontSize", before: "95.04px", after: "97.04px" }),
        patch("button-1", 4, { kind: "style", summary: "a.button.primary", locator: primary, property: "fontSize", before: "", after: "18px" }),
        patch("button-2", 5, { kind: "style", summary: "a.button.primary", locator: primary, property: "fontSize", before: "18px", after: "20px" }),
        patch("button-3", 6, { kind: "style", summary: "a.button.primary", locator: primary, property: "fontSize", before: "20px", after: "22px" }),
        patch("content-1", 7, { kind: "content", summary: "a.button", locator: secondary, before: "查看行程", after: "1行程" })
      ]
    }];

    const result = buildTeamPrompt(value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.taskCount).toBe(3);
    expect(result.prompt).toContain("Before: \"\"");
    expect(result.prompt).toContain("After: \"97.04px\"");
    expect(result.prompt).toContain("After: \"22px\"");
    expect(result.prompt).toContain("After: \"1行程\"");
    expect(result.prompt).toContain("Compacted from: 4 source changes");
    expect(result.prompt).toContain("submission-1/h1-1, submission-1/h1-2, submission-1/h1-3, submission-1/h1-4");
  });

  it("keeps different contributors separate and deduplicates repeated non-mergeable task ids", () => {
    const value = snapshot();
    const heading = locator("body > main > h1", "h1");
    const sharedStyle = (id: string, after: string): SharedTask => patch(id, 0, {
      kind: "style", summary: "h1", locator: heading, property: "fontSize", before: "72px", after
    });
    const repeatedIntent = patch("intent-1", 1, { kind: "intent", summary: "Keep the title visible" });
    value.submissions = [
      { version: 1, id: "s1", projectId: "p", memberId: "m1", memberDisplayName: "Owner", pageFingerprint: "a".repeat(64), submittedAt: 10, tasks: [sharedStyle("owner-style", "80px"), repeatedIntent] },
      { version: 1, id: "s2", projectId: "p", memberId: "m1", memberDisplayName: "Owner", pageFingerprint: "a".repeat(64), submittedAt: 20, tasks: [repeatedIntent] },
      { version: 1, id: "s3", projectId: "p", memberId: "m2", memberDisplayName: "B", pageFingerprint: "a".repeat(64), submittedAt: 30, tasks: [sharedStyle("member-style", "88px")] }
    ];

    const result = buildTeamPrompt(value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.taskCount).toBe(3);
    expect(result.prompt.match(/Type: intent/g)).toHaveLength(1);
    expect(result.prompt).toContain("After: \"80px\"");
    expect(result.prompt).toContain("After: \"88px\"");
    expect(result.prompt).toContain("source-ids: s1/intent-1, s2/intent-1");
  });
});
