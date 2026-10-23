import {
  COLLABORATION_LIMITS,
  type SharedMember,
  type SharedProject,
  type SharedProjectSnapshot,
  type SharedSubmission
} from "./collaboration-contract";

export type CollaborationErrorCode =
  | "project-not-found"
  | "project-expired"
  | "invalid-invite"
  | "fingerprint-mismatch"
  | "member-limit"
  | "member-not-found"
  | "task-limit"
  | "empty-submission";

export class CollaborationError extends Error {
  constructor(readonly code: CollaborationErrorCode) {
    super(code);
  }
}
type StoredProject = { project: SharedProject; inviteToken: string };

export class InMemoryCollaborationStore {
  private readonly projects = new Map<string, StoredProject>();
  private readonly members = new Map<string, SharedMember[]>();
  private readonly submissions = new Map<string, SharedSubmission[]>();
  private nextId = 1;

  private id(prefix: string): string {
    return `${prefix}-${this.nextId++}`;
  }

  private requireActiveProject(projectId: string, now: number): StoredProject {
    const stored = this.projects.get(projectId);
    if (!stored) throw new CollaborationError("project-not-found");
    if (stored.project.expiresAt <= now) throw new CollaborationError("project-expired");
    return stored;
  }

  private touch(stored: StoredProject, now: number): void {
    stored.project.lastActivityAt = now;
  }

  createProject(input: { title: string; pageFingerprint: string; ownerName: string; now: number; inviteToken?: string }): {
    project: SharedProject;
    owner: SharedMember;
    inviteToken: string;
  } {
    const projectId = this.id("project");
    const ownerId = this.id("member");
    const inviteToken = input.inviteToken ?? `${this.id("invite")}-0123456789abcdef`;
    const project: SharedProject = {
      version: 1,
      id: projectId,
      title: input.title,
      pageFingerprint: input.pageFingerprint,
      ownerMemberId: ownerId,
      createdAt: input.now,
      lastActivityAt: input.now,
      expiresAt: input.now + COLLABORATION_LIMITS.projectLifetimeMs
    };
    const owner: SharedMember = {
      version: 1,
      id: ownerId,
      projectId,
      displayName: input.ownerName,
      role: "owner",
      joinedAt: input.now
    };
    this.projects.set(projectId, { project, inviteToken });
    this.members.set(projectId, [owner]);
    this.submissions.set(projectId, []);
    return { project: { ...project }, owner: { ...owner }, inviteToken };
  }

  joinProject(input: { projectId: string; inviteToken: string; pageFingerprint: string; displayName: string; now: number }): SharedMember {
    const stored = this.requireActiveProject(input.projectId, input.now);
    if (stored.inviteToken !== input.inviteToken) throw new CollaborationError("invalid-invite");
    if (stored.project.pageFingerprint !== input.pageFingerprint) throw new CollaborationError("fingerprint-mismatch");
    const members = this.members.get(input.projectId) ?? [];
    if (members.length >= COLLABORATION_LIMITS.maxMembers) throw new CollaborationError("member-limit");
    const member: SharedMember = {
      version: 1,
      id: this.id("member"),
      projectId: input.projectId,
      displayName: input.displayName,
      role: "member",
      joinedAt: input.now
    };
    members.push(member);
    this.touch(stored, input.now);
    return { ...member };
  }

  submit(submission: SharedSubmission, now: number): void {
    const stored = this.requireActiveProject(submission.projectId, now);
    if (submission.pageFingerprint !== stored.project.pageFingerprint) throw new CollaborationError("fingerprint-mismatch");
    const members = this.members.get(submission.projectId) ?? [];
    if (!members.some((member) => member.id === submission.memberId)) throw new CollaborationError("member-not-found");
    if (submission.tasks.length === 0) throw new CollaborationError("empty-submission");
    const submissions = this.submissions.get(submission.projectId) ?? [];
    const existingTaskCount = submissions.reduce((total, item) => total + item.tasks.length, 0);
    if (existingTaskCount + submission.tasks.length > COLLABORATION_LIMITS.maxTasks) {
      throw new CollaborationError("task-limit");
    }
    submissions.push(structuredClone(submission));
    this.touch(stored, now);
  }

  readProject(projectId: string, memberId: string, now: number): SharedProjectSnapshot {
    const stored = this.requireActiveProject(projectId, now);
    const members = this.members.get(projectId) ?? [];
    if (!members.some((member) => member.id === memberId)) throw new CollaborationError("member-not-found");
    return structuredClone({
      version: 1,
      project: stored.project,
      members,
      submissions: this.submissions.get(projectId) ?? []
    });
  }

  purgeExpired(now: number): number {
    let removed = 0;
    for (const [projectId, stored] of this.projects) {
      if (stored.project.expiresAt > now) continue;
      this.projects.delete(projectId);
      this.members.delete(projectId);
      this.submissions.delete(projectId);
      removed++;
    }
    return removed;
  }
}
