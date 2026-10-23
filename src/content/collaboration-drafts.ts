import type { SharedProjectSnapshot, SharedTask } from "../shared/collaboration-contract";
import type { CollaborationParticipation } from "../shared/messages";
import { buildCollaborationReviewItems, type CollaborationReviewItem } from "./collaboration-review";
import { pendingCollaborationTasks } from "./collaboration-pending";

export function isLocalAdjustment(task: SharedTask): boolean {
  return ["style", "content", "attribute"].includes(task.kind);
}

// Only exact element edits share a location group. A broad region is not an element.
export function proposalLocationKey(item: CollaborationReviewItem): string {
  const locator = item.task.locator;
  return isLocalAdjustment(item.task) && locator?.cssPath
    ? JSON.stringify(["element", locator.cssPath, locator.tagName])
    : item.id;
}

export function buildLocalDraftItems(tasks: SharedTask[], snapshot: SharedProjectSnapshot | null, participation: CollaborationParticipation, fingerprint: string, language: "zh" | "en"): CollaborationReviewItem[] {
  const pending = pendingCollaborationTasks(tasks, snapshot, participation.memberId);
  const project = snapshot?.project ?? { version: 1 as const, id: participation.projectId, title: participation.projectTitle, pageFingerprint: fingerprint, ownerMemberId: participation.memberId, createdAt: 0, lastActivityAt: 0, expiresAt: participation.expiresAt };
  const local: SharedProjectSnapshot = { version: 1, project, members: [], submissions: [{ version: 1, id: "local-draft", projectId: participation.projectId, memberId: participation.memberId, memberDisplayName: language === "zh" ? "我" : "Me", pageFingerprint: fingerprint, submittedAt: 0, tasks: pending }] };
  const result = buildCollaborationReviewItems(local, language);
  if (!result.ok) return [];
  return result.items.map(item => ({ ...item, id: `draft:${JSON.stringify(isLocalAdjustment(item.task) && item.task.locator?.cssPath ? [item.task.kind, item.task.locator.cssPath, item.task.locator.tagName, item.task.property, item.task.attribute] : [item.task.id])}` }));
}
