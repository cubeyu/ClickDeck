import { describe, expect, it } from "vitest";
import { COLLABORATION_LIMITS, type SharedSubmission, type SharedTask } from "./collaboration-contract";
import { CollaborationError, InMemoryCollaborationStore } from "./collaboration-store";

function task(id: string): SharedTask {
  return { id, sequence: Number(id.replace("task-", "")) || 0, kind: "intent", summary: id };
}

function submission(projectId: string, memberId: string, pageFingerprint: string, tasks: SharedTask[], submittedAt: number): SharedSubmission {
  return { version: 1, id: `submission-${submittedAt}`, projectId, memberId, memberDisplayName: memberId, pageFingerprint, tasks, submittedAt };
}

describe("in-memory collaboration flow", () => {
  it("verifies create, join and submit without extending the fixed deadline", () => {
    const store = new InMemoryCollaborationStore();
    const fingerprint = "a".repeat(64);
    const created = store.createProject({ title: "Demo", pageFingerprint: fingerprint, ownerName: "Owner", now: 0, inviteToken: "secure-token" });
    const member = store.joinProject({ projectId: created.project.id, inviteToken: created.inviteToken, pageFingerprint: fingerprint, displayName: "B", now: 100 });
    store.submit(submission(created.project.id, member.id, fingerprint, [task("task-1")], 200), 200);
    const snapshot = store.readProject(created.project.id, created.owner.id, 300);
    expect(snapshot.members).toHaveLength(2);
    expect(snapshot.submissions).toHaveLength(1);
    expect(snapshot.project.expiresAt).toBe(COLLABORATION_LIMITS.projectLifetimeMs);
    expect(snapshot.project.lastActivityAt).toBe(200);
    expect(() => store.readProject(created.project.id, created.owner.id, snapshot.project.expiresAt)).toThrowError(
      expect.objectContaining({ code: "project-expired" })
    );
    expect(store.purgeExpired(snapshot.project.expiresAt)).toBe(1);
  });

  it("rejects wrong pages, outsiders, a seventh member and a 101st task", () => {
    const store = new InMemoryCollaborationStore();
    const fingerprint = "a".repeat(64);
    const created = store.createProject({ title: "Demo", pageFingerprint: fingerprint, ownerName: "Owner", now: 0, inviteToken: "secure-token" });
    expect(() => store.joinProject({ projectId: created.project.id, inviteToken: created.inviteToken, pageFingerprint: "b".repeat(64), displayName: "Wrong", now: 1 }))
      .toThrowError(expect.objectContaining({ code: "fingerprint-mismatch" }));
    for (let index = 0; index < 5; index++) {
      store.joinProject({ projectId: created.project.id, inviteToken: created.inviteToken, pageFingerprint: fingerprint, displayName: `M${index}`, now: index + 1 });
    }
    expect(() => store.joinProject({ projectId: created.project.id, inviteToken: created.inviteToken, pageFingerprint: fingerprint, displayName: "M6", now: 10 }))
      .toThrowError(expect.objectContaining({ code: "member-limit" }));
    const hundredTasks = Array.from({ length: 100 }, (_, index) => task(`task-${index + 1}`));
    store.submit(submission(created.project.id, created.owner.id, fingerprint, hundredTasks, 20), 20);
    expect(() => store.submit(submission(created.project.id, created.owner.id, fingerprint, [task("task-101")], 21), 21))
      .toThrowError(expect.objectContaining({ code: "task-limit" }));
    const outsider = submission(created.project.id, "outsider", fingerprint, [task("task-x")], 22);
    expect(() => store.submit(outsider, 22)).toThrowError(expect.objectContaining({ code: "member-not-found" }));
  });

  it("uses typed error codes", () => {
    const error = new CollaborationError("invalid-invite");
    expect(error.code).toBe("invalid-invite");
  });
});
