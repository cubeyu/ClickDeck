import { describe, expect, it } from "vitest";
import { validSharedTasks } from "./collaboration-validation";
import cases from "../../fixtures/security-tasks.json";
const task = { id: "a", sequence: 0, kind: "content", summary: "A → B", before: "A", after: "B" };
describe("untrusted collaboration payloads", () => {
  it.each(cases)("matches the SQL contract: $name", sample => {
    expect(validSharedTasks([sample.task])).toBe(sample.valid);
  });
  it("accepts bounded text including inert HTML", () => {
    expect(validSharedTasks([{ ...task, after: '<img src=x onerror=alert(1)>' }])).toBe(true);
  });
  it("rejects malformed types before review rendering", () => {
    for (const bad of [null, {}, [], [{...task, kind: {}}], [{...task, summary: []}], [{...task, source: {}}], [{...task, sequence: -1}]]) expect(validSharedTasks(bad)).toBe(false);
  });
  it("rejects oversized and deeply nested payloads", () => {
    expect(validSharedTasks([{...task, after: 'x'.repeat(4001)}])).toBe(false);
    expect(validSharedTasks(Array.from({length:100}, () => ({...task, after:'x'.repeat(4000)})))).toBe(false);
    expect(validSharedTasks([{...task, locator:{tagName:'div', cssPath:'x'.repeat(1001)}}])).toBe(false);
  });
});
