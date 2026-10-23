import type { SharedProjectSnapshot, SharedTask } from "../shared/collaboration-contract";
import { compactSubmissionTasks } from "../shared/collaboration-compaction";

// Compare proposals without rewriting local history or withdrawing saved suggestions.
function taskKey(task: SharedTask): string {
  const field = task.kind === "style" ? task.property : task.kind === "attribute" ? task.attribute : task.kind === "content" ? "text" : undefined;
  return task.locator?.cssPath && field
    ? JSON.stringify([task.kind, task.locator.cssPath, task.locator.tagName, field])
    : JSON.stringify(["id", task.id]);
}

export function proposedValueSignature(task: SharedTask): string {
  return task.locator && ["style", "content", "attribute"].includes(task.kind)
    ? JSON.stringify([task.after])
    : JSON.stringify(canonical([task.summary, task.source, task.target]));
}

// A read/validation round-trip can reorder object keys without changing a request.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, canonical(child)]));
  return value;
}

export function pendingCollaborationTasks(local: SharedTask[], snapshot: SharedProjectSnapshot | null, memberId: string): SharedTask[] {
  const saved = compactSubmissionTasks((snapshot?.submissions ?? [])
    .filter(submission => submission.memberId === memberId)
    .slice().sort((a, b) => a.submittedAt - b.submittedAt)
    .flatMap(submission => submission.tasks));
  const values = new Map(saved.map(task => [taskKey(task), proposedValueSignature(task)]));
  return compactSubmissionTasks(local).filter(task => values.get(taskKey(task)) !== proposedValueSignature(task));
}

export function pendingCollaborationCount(local: SharedTask[], snapshot: SharedProjectSnapshot | null, memberId: string): number {
  return pendingCollaborationTasks(local, snapshot, memberId).length;
}
