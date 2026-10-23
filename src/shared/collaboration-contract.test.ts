// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { IntentPromptInput } from "../export/intent-prompt";
import type { PersistedPatch } from "../state/editor-state";
import { createSharedSubmission } from "./collaboration-contract";
import { validSharedTasks } from "./collaboration-validation";

const locator = {
  descriptor: "h1.hero-title",
  tagName: "h1",
  cssPath: "main > h1.hero-title",
  nthOfTypePath: "body:nth-of-type(1) > main:nth-of-type(1) > h1:nth-of-type(1)",
  siblingIndex: 0,
  textSnippet: "A"
};

describe("collaboration contract", () => {
  it("compacts a long click history before applying the 100-task submission limit", () => {
    const result = createSharedSubmission({ id: "s", projectId: "p", memberId: "m", memberDisplayName: "A", pageFingerprint: "a".repeat(64), submittedAt: 1, intents: [],
      patches: Array.from({ length: 121 }, (_, index) => ({ id: `p-${index}`, kind: "style" as const, targetDescriptor: "Title", targetLocator: locator, property: "fontSize", before: `${32+index}px`, after: `${33+index}px`, createdAt: index })) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.submission.tasks).toHaveLength(1);
      expect(result.submission.tasks[0]).toMatchObject({ before: "32px", after: "153px" });
    }
  });
  it("serializes patches and intents without retaining DOM references", () => {
    const element = document.createElement("h1");
    const patch: PersistedPatch = {
      id: "patch-1",
      kind: "style",
      targetDescriptor: "h1.hero-title",
      targetLocator: locator,
      property: "fontSize",
      before: "32px",
      after: "40px",
      createdAt: 1
    };
    const intent = {
      operation: { id: "op-1", action: "intent", source: {}, createdAt: 1 },
      sourceContext: {
        region: {
          id: "region-1",
          action: "intent",
          userIntent: "Increase contrast",
          pageMode: "slide",
          viewportBox: { left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50 },
          relativeBox: { left: 10, top: 10, width: 20, height: 10, right: 30, bottom: 20 },
          documentBox: { left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50 },
          anchor: { kind: "slide", label: "Slide 1", locator, confidence: "high" },
          createdAt: 1
        },
        candidates: [{ unit: { kind: "textLine", element, textSnippet: "A" }, rank: 1, reason: "text", overlapRatio: 1, centerInBox: true }],
        nearby: [],
        empty: false,
        confidence: "high"
      }
    } as unknown as IntentPromptInput;

    const result = createSharedSubmission({
      id: "submission-1",
      projectId: "project-1",
      memberId: "member-1",
      memberDisplayName: "A",
      pageFingerprint: "a".repeat(64),
      patches: [patch],
      intents: [intent],
      submittedAt: 2
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validSharedTasks(result.submission.tasks)).toBe(true);
    expect(result.submission.tasks.map((task) => task.kind)).toEqual(["intent", "style"]);
    const json = JSON.stringify(result.submission);
    expect(json).not.toContain("HTMLHeadingElement");
    expect(json).not.toContain("targetElement");
    expect(json).not.toContain("backgroundImageHint");
    expect(() => structuredClone(result.submission)).not.toThrow();
  });

  it("rejects a move without Target B instead of silently weakening it", () => {
    const intent = {
      operation: { id: "move-1", action: "move" },
      sourceContext: { region: { userIntent: "move" } }
    } as unknown as IntentPromptInput;
    const result = createSharedSubmission({
      id: "submission-1",
      projectId: "project-1",
      memberId: "member-1",
      memberDisplayName: "A",
      pageFingerprint: "a".repeat(64),
      patches: [],
      intents: [intent],
      submittedAt: 2
    });
    expect(result).toEqual({ ok: false, rejectedTaskIds: ["move-1"], reason: "unsafe-task" });
  });
});
