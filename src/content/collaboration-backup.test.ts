import { describe, expect, it } from "vitest";
import { collaborationBackup } from "./collaboration-backup";
import type { SharedProjectSnapshot } from "../shared/collaboration-contract";

describe("team suggestion archive", () => {
  it("keeps all authors and conflicting values independently of prompt selection", () => {
    const snapshot: SharedProjectSnapshot = {
      version: 1, project: { version: 1, id: "p", title: "<script>not executable</script>", pageFingerprint: "a", ownerMemberId: "a", createdAt: 0, lastActivityAt: 0, expiresAt: 172800000 },
      members: [], submissions: ["A", "B"].map((name, i) => ({ version: 1, id: name, projectId: "p", memberId: name, memberDisplayName: name, pageFingerprint: "a", submittedAt: i,
        tasks: [{ id: name, sequence: i, kind: "style", summary: "Font", locator: { tagName: "h1", cssPath: "#title", descriptor: "Title", nthOfTypePath: "h1", siblingIndex: 0 }, property: "fontSize", after: `${40+i}px` }] }))
    };
    const before = JSON.stringify(snapshot);
    const backup = collaborationBackup(snapshot, 1000, true);
    expect(backup).toContain("A · style"); expect(backup).toContain("B · style");
    expect(backup).toContain("Before unknown"); expect(backup).toContain("上次成功读取的快照");
    expect(JSON.parse(backup.split("Full downloaded data (JSON)\n")[1])).toEqual(snapshot);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(collaborationBackup({ ...snapshot, invalidTaskCount: 1 }, 1000, false)).toContain("本备份不完整");
  });
});
