import type { CollaborationParticipation } from "./messages";

export const PARTICIPATION_PREFIX = "clickdeck:collaboration-page:v1:";
export const PAGE_ASSOCIATION_PREFIX = "clickdeck:collaboration-url:v1:";

// Fragment changes often represent slide navigation, not a different file.
// This key only restores a review entry; never use it to authorize submission.
export function pageAssociationKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return PAGE_ASSOCIATION_PREFIX + parsed.href;
}

export function isParticipation(value: unknown): value is CollaborationParticipation {
  if (!value || typeof value !== "object") return false;
  const p = value as CollaborationParticipation;
  return typeof p.projectId === "string" && typeof p.memberId === "string"
    && typeof p.projectTitle === "string" && Number.isFinite(p.expiresAt)
    && (p.role === "owner" || p.role === "member");
}
