// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { computeActiveGuides } from "./intent-ghost";
import type { GuideCandidate } from "./region-context";

const box = { left: 100, top: 100, width: 80, height: 40, right: 180, bottom: 140 };

describe("intent ghost guides", () => {
  it("returns only guides active for the final rect", () => {
    const candidates: GuideCandidate[] = [
      {
        axis: "x",
        position: 140,
        sourceEdge: "centerX",
        unitSummary: "Old passed guide",
        unitKind: "textLine"
      },
      {
        axis: "y",
        position: 120,
        sourceEdge: "centerY",
        unitSummary: "Title",
        unitKind: "textLine"
      }
    ];

    const finalBox = { ...box, left: 200, right: 280 };
    const activeGuides = computeActiveGuides(finalBox, candidates);

    expect(activeGuides.some(guide => guide.unitSummary === "Old passed guide")).toBe(false);
    expect(activeGuides).toEqual([
      {
        axis: "y",
        position: 120,
        targetEdge: "centerY",
        sourceEdge: "centerY",
        unitSummary: "Title",
        deltaPx: 0
      }
    ]);
  });

  it("records which target edge aligned with which source edge", () => {
    const candidates: GuideCandidate[] = [
      {
        axis: "x",
        position: 180,
        sourceEdge: "right",
        unitSummary: "Reference card",
        unitKind: "block"
      }
    ];

    const activeGuides = computeActiveGuides(box, candidates);

    expect(activeGuides).toEqual([
      {
        axis: "x",
        position: 180,
        targetEdge: "right",
        sourceEdge: "right",
        unitSummary: "Reference card",
        deltaPx: 0
      }
    ]);
  });
});
