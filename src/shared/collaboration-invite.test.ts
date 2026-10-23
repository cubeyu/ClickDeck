import { describe, expect, it } from "vitest";
import { decodeCollaborationInvite, encodeCollaborationInvite } from "./collaboration-invite";

describe("collaboration invitation", () => {
  const projectId = "123e4567-e89b-42d3-a456-426614174000";
  const inviteToken = "a".repeat(36);

  it("encodes one copyable invitation and restores its two credentials", () => {
    const encoded = encodeCollaborationInvite({ projectId, inviteToken });
    expect(encoded.startsWith("CD1.")).toBe(true);
    expect(decodeCollaborationInvite(encoded)).toEqual({ projectId, inviteToken });
  });

  it("rejects malformed or truncated invitations", () => {
    expect(decodeCollaborationInvite("123456")).toBeNull();
    expect(decodeCollaborationInvite(`CD1.${projectId}.short`)).toBeNull();
    expect(() => encodeCollaborationInvite({ projectId: "wrong", inviteToken })).toThrow("invalid-invite");
  });
});
