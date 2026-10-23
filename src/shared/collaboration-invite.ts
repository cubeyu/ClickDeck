export type CollaborationInvite = {
  projectId: string;
  inviteToken: string;
};

const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVITE_TOKEN_PATTERN = /^[0-9a-f]{36}$/i;

export function encodeCollaborationInvite(invite: CollaborationInvite): string {
  if (!PROJECT_ID_PATTERN.test(invite.projectId) || !INVITE_TOKEN_PATTERN.test(invite.inviteToken)) {
    throw new Error("invalid-invite");
  }
  return `CD1.${invite.projectId}.${invite.inviteToken}`;
}

export function decodeCollaborationInvite(value: string): CollaborationInvite | null {
  const [version, projectId, inviteToken, extra] = value.trim().split(".");
  if (version !== "CD1" || extra !== undefined) return null;
  if (!PROJECT_ID_PATTERN.test(projectId ?? "") || !INVITE_TOKEN_PATTERN.test(inviteToken ?? "")) return null;
  return { projectId, inviteToken };
}
