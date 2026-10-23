import { describe, expect, it } from "vitest";
import { compactSubmissionTasks } from "./collaboration-compaction";
import type { SharedTask } from "./collaboration-contract";
const locator = { tagName: "h1", cssPath: "#title", nthOfTypePath: "h1", descriptor: "Title", siblingIndex: 0 };
const task = (id: string, after: string): SharedTask => ({ id, sequence: 0, kind: "style", summary: "Title", locator, property: "fontSize", before: "32px", after });
describe("submission compaction", () => {
  it("sends one final font size rather than 81 clicks without mutating history", () => {
    const input = Array.from({ length: 81 }, (_, i) => task(String(i), `${33+i}px`));
    expect(compactSubmissionTasks(input)).toEqual([{ ...task("80", "113px"), sequence: 0 }]);
    expect(input).toHaveLength(81);
  });
  it("preserves different targets/properties and independent region opinions", () => {
    const inputs: SharedTask[] = [task("a", "40px"), { ...task("b", "red"), property: "color" }, { ...task("c", "40px"), locator: { ...locator, cssPath: "#other" } }, { id: "d", sequence: 4, kind: "intent", summary: "First" }, { id: "e", sequence: 5, kind: "intent", summary: "Second" }];
    expect(compactSubmissionTasks(inputs)).toHaveLength(5);
    expect(compactSubmissionTasks([...inputs, {...inputs[3],summary:"Updated"}])[3].summary).toBe("Updated");
  });
});
