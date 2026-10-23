import { describe, expect, it } from "vitest";
import { CollaborationSharingSelection } from "./collaboration-sharing";
import type { CollaborationReviewItem } from "./collaboration-review";

const item = (id: string, after = "40px"): CollaborationReviewItem => ({ id, number: 1, contributorId: "me", contributor: "Me", sourceIds: [id], locator: "#title", targetLabel: "Title", description: "Font", conflict: false,
  task: { id, sequence: 0, kind: "style", summary: "Font", property: "fontSize", after } });

describe("explicit local sharing choices", () => {
  it("starts unchecked and selects only explicitly approved values", () => {
    const choices = new CollaborationSharingSelection(), items = [item("a"), item("b")];
    choices.sync("p:me", items); expect(choices.selected(items)).toEqual([]);
    choices.choose(items[0], true); expect(choices.selected(items)).toEqual([items[0]]);
    choices.sync("p:me", [...items, item("new")]); expect(choices.selected(items)).toEqual([items[0]]);
    choices.choose(items[0], false); expect(choices.selected(items)).toEqual([]);
  });
  it("retains identical values across refresh but requires re-selection after an edit or undo", () => {
    const choices = new CollaborationSharingSelection(), first = item("stable");
    choices.sync("p:me", [first]); choices.choose(first, true);
    const refreshed = { ...first, task: { ...first.task, id: "regenerated", sequence: 5 } };
    choices.sync("p:me", [refreshed]); expect(choices.has(refreshed)).toBe(true);
    const changed = item("stable", "50px"); choices.sync("p:me", [changed]); expect(choices.has(changed)).toBe(false);
    choices.sync("p:me", [first]); expect(choices.has(first)).toBe(false);
  });
  it("drops removed/submitted choices and isolates project/member identities", () => {
    const choices = new CollaborationSharingSelection(), first = item("a");
    choices.sync("p:me", [first]); choices.choose(first, true);
    choices.sync("p:me", []); choices.sync("p:me", [first]); expect(choices.has(first)).toBe(false);
    choices.choose(first, true); choices.sync("p:other", [first]); expect(choices.has(first)).toBe(false);
    choices.choose(first, true); choices.sync("other:other", [first]); expect(choices.has(first)).toBe(false);
  });
});
