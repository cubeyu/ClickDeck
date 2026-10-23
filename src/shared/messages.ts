import type { SharedProjectSnapshot, SharedTask } from "./collaboration-contract";

export const CLICKDECK_TOGGLE_MESSAGE = "CLICKDECK_TOGGLE" as const;
export const CLICKDECK_CAPTURE_VISIBLE_TAB = "CLICKDECK_CAPTURE_VISIBLE_TAB" as const;
export const CLICKDECK_RESOLVE_SOURCE_LOCATIONS = "CLICKDECK_RESOLVE_SOURCE_LOCATIONS" as const;
export const CLICKDECK_COLLABORATION_REQUEST = "CLICKDECK_COLLABORATION_REQUEST" as const;

export type ClickDeckToggleMessage = {
  type: typeof CLICKDECK_TOGGLE_MESSAGE;
};

export type ClickDeckCaptureVisibleTabMessage = {
  type: typeof CLICKDECK_CAPTURE_VISIBLE_TAB;
};

export type SourceLocationTarget = {
  key: string;
  tagName: string;
  idHint?: string;
  classHint?: string;
  textSnippet?: string;
  imageHint?: string;
  selectorStability?: "high" | "medium" | "low";
};

export type SourceLocationEvidence = {
  key: string;
  sourceUrl: string;
  line: number;
  column: number;
  confidence: "high";
  matchMethod: "unique-id" | "unique-class" | "unique-text" | "unique-image";
};

export type ResolveSourceLocationsResponse = {
  sourceUrl?: string;
  locations: Record<string, SourceLocationEvidence>;
  unavailableReason?: string;
};

export type ClickDeckResolveSourceLocationsMessage = {
  type: typeof CLICKDECK_RESOLVE_SOURCE_LOCATIONS;
  targets: SourceLocationTarget[];
};

export type CollaborationParticipation = {
  projectId: string;
  memberId: string;
  role: "owner" | "member";
  projectTitle: string;
  inviteCode?: string;
  expiresAt: number;
};

export type CollaborationRequest =
  | { action: "verify-source" }
  | { action: "secure-window"; pageFingerprint: string; tasks?: SharedTask[]; sourceVerified?: boolean; upgradeProjectId?: string }
  | { action: "status" }
  | { action: "create"; title: string; ownerName: string; pageFingerprint: string; sourceVerified?: boolean }
  | { action: "upgrade-source"; projectId: string; pageFingerprint: string }
  | { action: "join"; inviteCode: string; displayName: string; pageFingerprint: string }
  | { action: "preview-join"; inviteCode: string; pageFingerprint: string }
  | { action: "submit"; projectId: string; pageFingerprint: string; tasks: SharedTask[] }
  | { action: "read"; projectId: string };

export type CollaborationResponse =
  | { ok: true; data: { fingerprint: string } }
  | { ok: true; data: { secureWindow: true } }
  | { ok: true; data: { configured: boolean; creatorReady?: boolean } }
  | { ok: true; data: { inviteExpiresAt: number } }
  | { ok: true; data: { participation: CollaborationParticipation; snapshot?: SharedProjectSnapshot } }
  | { ok: true; data: { submissionId: string; expiresAt?: number } }
  | { ok: true; data: { participation: CollaborationParticipation; snapshot: SharedProjectSnapshot } }
  | { ok: false; error: string; sourceDiagnostic?: string };

export type ClickDeckCollaborationRequestMessage = {
  type: typeof CLICKDECK_COLLABORATION_REQUEST;
  request: CollaborationRequest;
};

export type ClickDeckMessage =
  | ClickDeckToggleMessage
  | ClickDeckCaptureVisibleTabMessage
  | ClickDeckResolveSourceLocationsMessage
  | ClickDeckCollaborationRequestMessage;
