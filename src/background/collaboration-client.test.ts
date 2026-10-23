import { describe, expect, it, vi } from "vitest";
import { createCollaborationClient } from "./collaboration-client";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

it("preflights only the invite expiry and reports an undeployed migration without joining", async () => {
  const expiry = new Date(Date.now() + 3600000).toISOString();
  const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('/auth/')
    ? json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: { id: 'u' } }) : json(expiry));
  const client = createCollaborationClient({ config: { projectUrl: 'https://example.supabase.co', publishableKey: 'test' }, storage: memoryStorage(), fetcher: fetcher as typeof fetch });
  const request = { action: 'preview-join' as const, inviteCode: `CD1.123e4567-e89b-42d3-a456-426614174000.${'a'.repeat(36)}`, pageFingerprint: 'a'.repeat(64) };
  expect(await client.handle(request)).toEqual({ ok: true, data: { inviteExpiresAt: Date.parse(expiry) } });
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/join_clickdeck_project'))).toBe(false);
  fetcher.mockImplementation(async () => json({ code: 'PGRST202' }, 404));
  expect(await client.handle(request)).toEqual({ ok: false, error: 'migration-required' });
});

function memoryStorage() {
  const values: Record<string, unknown> = {};
  return {
    get: vi.fn(async (key: string) => ({ [key]: values[key] })),
    set: vi.fn(async (next: Record<string, unknown>) => { Object.assign(values, next); }),
    remove: vi.fn(async (key: string) => { delete values[key]; })
  };
}

describe("collaboration client", () => {
  const config = { projectUrl: "https://example.supabase.co", publishableKey: "publishable-key-value-123456" };
  const sessionKey = "clickdeck:collaboration-auth:v1";
  it('reads a controlled snapshot in one POST and retains task quarantine and author mapping', async () => {
    const storage = memoryStorage();
    await storage.set({ [sessionKey]: { accessToken: 'access', refreshToken: 'refresh', userId: 'u', expiresAt: 9999999999999 } });
    const task = { id: 'good', sequence: 0, kind: 'content', summary: 'A', after: 'B' };
    const fetcher = vi.fn<typeof fetch>(async () => json({
      projects: [{ id: 'p', title: 'P' }], members: [{ id: 'm', user_id: 'u', role: 'owner' }],
      submissions: [{ id: 's', user_id: 'u', tasks: [task, { ...task, locator: { cssPath: 'h1' } }] }]
    }));
    const client = createCollaborationClient({ config, storage, fetcher, controlledProjectRead: true });
    const result = await client.handle({ action: 'read', projectId: 'p' });
    expect(result).toMatchObject({ ok: true, data: { snapshot: {
      rawTaskCount: 2, invalidTaskCount: 1, project: { ownerMemberId: 'm' },
      submissions: [{ memberId: 'm', tasks: [task] }]
    } } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(config.projectUrl + '/rest/v1/rpc/read_clickdeck_project');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ requested_project_id: 'p' }) });
  });
  it.each([
    [{ code: 'PGRST202' }, 404, 'migration-required'],
    [{ message: 'rate-limit' }, 400, 'rate-limit'],
    [{ message: 'service-disabled' }, 400, 'service-disabled'],
    [{ projects: [] }, 200, 'migration-required']
  ])('never falls back to table reads when controlled snapshot fails (%s)', async (payload, status, error) => {
    const storage = memoryStorage();
    await storage.set({ [sessionKey]: { accessToken: 'access', refreshToken: 'refresh', userId: 'u', expiresAt: 9999999999999 } });
    const fetcher = vi.fn<typeof fetch>(async () => json(payload, status as number));
    const client = createCollaborationClient({ config, storage, fetcher, controlledProjectRead: true });
    expect(await client.handle({ action: 'read', projectId: 'p' })).toEqual({ ok: false, error });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain('/rpc/read_clickdeck_project');
  });
  it('preserves an existing anonymous identity rather than signing in as a different owner', async () => {
    const storage = memoryStorage();
    const previous = { accessToken: 'old', refreshToken: 'keep', expiresAt: Date.now() + 3600000, userId: 'old-user' };
    await storage.set({ [sessionKey]: previous });
    const googleLogin = vi.fn(async () => ({ ...previous, userId: 'different-user' }));
    const fetcher = vi.fn<typeof fetch>(async () => json({ id: 'old-user', is_anonymous: true, identities: [] }));
    const client = createCollaborationClient({ config, storage, fetcher, googleLogin });
    expect(await client.loginGoogle()).toEqual({ ok: false, error: 'identity-link-conflict' });
    expect(googleLogin).toHaveBeenCalledWith({ accessToken: 'old', userId: 'old-user' });
    expect((await storage.get(sessionKey))[sessionKey]).toEqual(previous);
  });
  it('saves a first Google identity without anonymous signup and never returns credentials to UI', async () => {
    const storage = memoryStorage();
    const fetcher = vi.fn<typeof fetch>();
    const session = { accessToken: 'private-access', refreshToken: 'private-refresh', userId: 'google', expiresAt: 9999999999999 };
    const client = createCollaborationClient({ config, storage, fetcher, googleLogin: async () => session });
    expect(await client.loginGoogle()).toEqual({ ok: true, data: { googleSignedIn: true } });
    expect((await storage.get(sessionKey))[sessionKey]).toEqual(session);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('links Google to the same UID while retaining local projects and edits', async () => {
    const storage = memoryStorage();
    const previous = { accessToken: 'old', refreshToken: 'old-refresh', userId: 'same-user', expiresAt: 9999999999999 };
    const linked = { ...previous, accessToken: 'linked', refreshToken: 'linked-refresh' };
    await storage.set({ [sessionKey]: previous, project: { id: 'keep' }, edits: ['keep'] });
    const fetcher = vi.fn<typeof fetch>(async () => json({ id: 'same-user', is_anonymous: true, identities: [] }));
    const googleLogin = vi.fn(async () => linked);
    const client = createCollaborationClient({ config, storage, fetcher, googleLogin });
    expect(await client.loginGoogle()).toEqual({ ok: true, data: { googleSignedIn: true } });
    expect(googleLogin).toHaveBeenCalledWith({ userId: 'same-user', accessToken: 'old' });
    expect((await storage.get(sessionKey))[sessionKey]).toEqual(linked);
    expect(await storage.get('project')).toEqual({ project: { id: 'keep' } });
    expect(await storage.get('edits')).toEqual({ edits: ['keep'] });
  });
  it("preflights existing identities without silently signing up", async () => {
    const storage = memoryStorage();
    const fetcher = vi.fn<typeof fetch>(async () => json({ error_code: "refresh_token_not_found" }, 400));
    const client = createCollaborationClient({ config, storage, fetcher });
    expect(await client.checkConnection()).toMatchObject({ ok: true });
    expect(fetcher).not.toHaveBeenCalled();
    await storage.set({ [sessionKey]: { accessToken: "old", refreshToken: "old", expiresAt: 1, userId: "u" } });
    expect(await client.checkConnection()).toMatchObject({ ok: false, error: "session-expired" });
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("signup"))).toBe(false);
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it("recovers a removed anonymous session only explicitly, retaining local data and the old credential backup", async () => {
    const storage = memoryStorage();
    const old = { accessToken: "old", refreshToken: "gone", userId: "old-user", expiresAt: 1 };
    await storage.set({ [sessionKey]: old, edits: "keep", project: "keep" });
    const fetcher = vi.fn<typeof fetch>(async input => {
      if (String(input).includes("/token")) return json({ error_code: "refresh_token_not_found" }, 400);
      return json({ access_token: "new", refresh_token: "new-refresh", expires_in: 3600, user: { id: "new-user" } });
    });
    const client = createCollaborationClient({ config, storage, fetcher });
    expect(await client.handle({ action: "read", projectId: "p" })).toEqual({ ok: false, error: "session-expired" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await client.recoverIdentity()).toMatchObject({ ok: true });
    expect((await storage.get(sessionKey))[sessionKey]).toMatchObject({ userId: "new-user" });
    expect((await storage.get(sessionKey + ":previous"))[sessionKey + ":previous"]).toEqual(old);
    expect(await storage.get("edits")).toEqual({ edits: "keep" });
    expect(await storage.get("project")).toEqual({ project: "keep" });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it.each([429, 500])("does not replace identity when recovery encounters HTTP %s", async status => {
    const storage = memoryStorage();
    const old = { accessToken: "old", refreshToken: "keep", userId: "u", expiresAt: 1 };
    await storage.set({ [sessionKey]: old });
    const fetcher = vi.fn<typeof fetch>(async () => json({}, status));
    const client = createCollaborationClient({ config, storage, fetcher });
    expect(await client.recoverIdentity()).toMatchObject({ ok: false });
    expect((await storage.get(sessionKey))[sessionKey]).toEqual(old);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps the old credential if replacement signup fails and reuses a healthy identity", async () => {
    const storage = memoryStorage();
    const old = { accessToken: "old", refreshToken: "keep", userId: "u", expiresAt: 1 };
    await storage.set({ [sessionKey]: old });
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error_code: "session_not_found" }, 400))
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(json({ access_token: "new", refresh_token: "next", expires_in: 3600, user: { id: "u" } }));
    const client = createCollaborationClient({ config, storage, fetcher });
    expect(await client.recoverIdentity()).toMatchObject({ ok: false });
    expect((await storage.get(sessionKey))[sessionKey]).toEqual(old);
    expect(await client.recoverIdentity()).toMatchObject({ ok: true });
    expect((await storage.get(sessionKey))[sessionKey]).toMatchObject({ userId: "u" });
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/signup"))).toHaveLength(1);
  });
  it.each([false, true])('rejects refresh into a different user, invited=%s', async invitedGuestAdmission => {
    const storage = memoryStorage();
    const old = { accessToken: 'old', refreshToken: 'keep', userId: 'original', expiresAt: 1 };
    await storage.set({ [sessionKey]: old, edits: ['keep'], project: 'keep' });
    const fetcher = vi.fn<typeof fetch>(async () => json({ access_token: 'wrong', refresh_token: 'wrong',
      expires_in: 3600, user: { id: 'different' } }));
    const client = createCollaborationClient({ config, storage, fetcher, invitedGuestAdmission });
    expect(await client.handle({ action: 'read', projectId: 'p' })).toEqual({ ok: false, error: 'identity-changed' });
    expect(await client.recoverIdentity()).toEqual({ ok: false, error: 'identity-changed' });
    expect((await storage.get(sessionKey))[sessionKey]).toEqual(old);
    expect(await storage.get('edits')).toEqual({ edits: ['keep'] });
    expect(await storage.get('project')).toEqual({ project: 'keep' });
    expect(fetcher.mock.calls.every(([url]) => String(url).includes('grant_type=refresh_token'))).toBe(true);
  });

  it.each(['original', 'different'])('does not overwrite a newer session for %s after a delayed refresh', async userId => {
    const storage = memoryStorage();
    await storage.set({ [sessionKey]: { accessToken: 'old', refreshToken: 'old-refresh', userId: 'original', expiresAt: 1 } });
    const newer = { accessToken: 'newer', refreshToken: 'newer-refresh', userId, expiresAt: 9999999999999 };
    const fetcher = vi.fn<typeof fetch>(async () => {
      await storage.set({ [sessionKey]: newer });
      return json({ access_token: 'late', refresh_token: 'late-refresh', expires_in: 3600, user: { id: 'original' } });
    });
    const client = createCollaborationClient({ config, storage, fetcher });
    expect(await client.handle({ action: 'read', projectId: 'p' })).toEqual({ ok: false, error: 'identity-changed' });
    expect((await storage.get(sessionKey))[sessionKey]).toEqual(newer);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([0, 429, 500, 401])("preserves the identity after refresh failure %s without signing up", async status => {
    const storage = memoryStorage();
    const session = { accessToken: "old", refreshToken: "keep", userId: "original", expiresAt: 1 };
    await storage.set({ [sessionKey]: session });
    const fetcher = vi.fn<typeof fetch>(async () => {
      if (!status) throw new TypeError("offline");
      return json(status === 401 ? { error_code: "refresh_token_not_found" } : {}, status);
    });
    const client = createCollaborationClient({ config, fetcher, storage });
    expect(await client.handle({ action: "read", projectId: "p" })).toEqual({ ok: false, error: status === 401 ? "session-expired" : "network-error" });
    expect((await storage.get(sessionKey))[sessionKey]).toEqual(session);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.every(([url]) => String(url).includes("grant_type=refresh_token"))).toBe(true);
  });

  it("shares concurrent refresh and quarantines bad tasks without losing good ones", async () => {
    const storage = memoryStorage();
    await storage.set({ [sessionKey]: { accessToken: "old", refreshToken: "keep", userId: "u", expiresAt: 1 } });
    const task = { id: "good", sequence: 0, kind: "content", summary: "A", after: "B" };
    const fetcher = vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url.includes("/auth/")) return json({ access_token: "new", refresh_token: "next", expires_in: 3600, user: { id: "u" } });
      if (url.includes("clickdeck_projects")) return json([{ id: "p", title: "P" }]);
      if (url.includes("clickdeck_members")) return json([{ id: "m", user_id: "u", role: "owner" }]);
      if (url.includes("clickdeck_submissions")) return json([{ tasks: [task, { ...task, locator: { cssPath: "h1" } }, { ...task, source: { anchor: {}, contents: [{}], nearby: [], userIntent: "move" } }] }]);
      throw Error("unexpected request");
    });
    const client = createCollaborationClient({ config, fetcher, storage });
    const results = await Promise.all([client.handle({ action: "read", projectId: "p" }), client.handle({ action: "read", projectId: "p" })]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/auth/"))).toHaveLength(1);
    for (const result of results) {
      expect(result.ok).toBe(true);
      if (result.ok && "snapshot" in result.data) {
        expect(result.data.snapshot).toMatchObject({ invalidTaskCount: 2, rawTaskCount: 3 });
        expect(result.data.snapshot?.submissions[0].tasks).toEqual([task]);
      }
    }
  });

  it("acknowledges a successful write without a fallible follow-up read", async () => {
    const storage = memoryStorage();
    await storage.set({ [sessionKey]: { accessToken: "valid", refreshToken: "keep", userId: "u", expiresAt: Date.now() + 3600_000 } });
    const fetcher = vi.fn<typeof fetch>(async input => {
      if (String(input).includes("/rpc/submit_clickdeck_tasks")) return json("saved");
      throw new TypeError("follow-up offline");
    });
    const client = createCollaborationClient({ config, fetcher, storage });
    expect(await client.handle({ action: "submit", projectId: "p", pageFingerprint: "a".repeat(64), tasks: [{ id: "t", sequence: 0, kind: "content", summary: "A" }] })).toEqual({ ok: true, data: { submissionId: "saved" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("stays offline when the private Beta build is not configured", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createCollaborationClient({ config: null, fetcher, storage: memoryStorage() });

    await expect(client.handle({ action: "status" })).resolves.toEqual({ ok: true, data: { configured: false } });
    await expect(client.handle({ action: "read", projectId: "x" })).resolves.toEqual({ ok: false, error: "not-configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects creation without Google login without creating an anonymous identity', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createCollaborationClient({ config, fetcher, storage: memoryStorage() });
    expect(await client.handle({ action: 'create', title: 'A', ownerName: 'B', pageFingerprint: 'f'.repeat(64) }))
      .toEqual({ ok: false, error: 'google-login-required' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires verified Google identity to create and returns a single copyable invite code", async () => {
    const storage = memoryStorage();
    await storage.set({ [sessionKey]: { accessToken: 'access', refreshToken: 'refresh', expiresAt: 9999999999999, userId: 'user-a' } });
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) {
        return json({ id: 'user-a', is_anonymous: false, identities: [{ provider: 'google' }] });
      }
      if (url.includes("/rpc/create_clickdeck_project")) {
        return json([{ project_id: "123e4567-e89b-42d3-a456-426614174000", owner_member_id: "member-a", invite_token: "a".repeat(36), expires_at: "2026-09-13T00:00:00.000Z" }]);
      }
      return json({}, 404);
    });
    const client = createCollaborationClient({
      config: { projectUrl: "https://example.supabase.co", publishableKey: "publishable-key-value-123456" },
      fetcher,
      storage,
      now: () => Date.parse("2026-09-11T00:00:00.000Z")
    });

    const result = await client.handle({ action: "create", title: "A", ownerName: "B", pageFingerprint: "f".repeat(64) });
    expect(result.ok).toBe(true);
    if (result.ok && "participation" in result.data) {
      expect(result.data.participation.inviteCode).toBe(`CD1.123e4567-e89b-42d3-a456-426614174000.${"a".repeat(36)}`);
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects an existing anonymous creator before calling the project RPC', async () => {
    const storage = memoryStorage();
    const previous = { accessToken: 'access', refreshToken: 'refresh', expiresAt: 9999999999999, userId: 'legacy' };
    await storage.set({ [sessionKey]: previous });
    const fetcher = vi.fn<typeof fetch>(async () => json({ id: 'legacy', is_anonymous: true, identities: [] }));
    const client = createCollaborationClient({ config, storage, fetcher });
    expect(await client.handle({ action: 'create', title: 'A', ownerName: 'B', pageFingerprint: 'f'.repeat(64) }))
      .toEqual({ ok: false, error: 'google-login-required' });
    expect(fetcher.mock.calls.every(([url]) => String(url).endsWith('/auth/v1/user'))).toBe(true);
    expect((await storage.get(sessionKey))[sessionKey]).toEqual(previous);
  });

  it("joins, readses, submits, and refreshes through authenticated REST calls", async () => {
    const projectId = "123e4567-e89b-42d3-a456-426614174000";
    const projectRow = {
      id: projectId, title: "A", page_fingerprint: "f".repeat(64), created_at: "2026-09-11T00:00:00Z",
      last_activity_at: "2026-09-11T00:00:00Z", expires_at: "2026-09-13T00:00:00Z"
    };
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/v1/signup")) return json({ access_token: "access", refresh_token: "refresh", expires_in: 3600, user: { id: "user-b" } });
      if (url.includes("/rpc/join_clickdeck_project")) return json("member-b");
      if (url.includes("/rpc/submit_clickdeck_tasks")) return json("submission-b");
      if (url.includes("clickdeck_projects")) return json([projectRow]);
      if (url.includes("clickdeck_members")) return json([{ id: "member-b", project_id: projectId, user_id: "user-b", display_name: "B", role: "member", joined_at: "2026-09-11T00:00:00Z" }]);
      if (url.includes("clickdeck_submissions")) return json([{ id: "submission-b", project_id: projectId, user_id: "user-b", member_display_name: "B", page_fingerprint: "f".repeat(64), tasks: [{ id: "task-b", sequence: 0, kind: "content", summary: "B" }], submitted_at: "2026-09-11T00:01:00Z" }]);
      return json({}, 404);
    });
    const client = createCollaborationClient({
      config: { projectUrl: "https://example.supabase.co", publishableKey: "publishable-key-value-123456" },
      fetcher, storage: memoryStorage(), now: () => Date.parse("2026-09-11T00:00:00Z")
    });
    const inviteCode = `CD1.${projectId}.${"a".repeat(36)}`;
    const joined = await client.handle({ action: "join", inviteCode, displayName: "B", pageFingerprint: "f".repeat(64) });
    expect(joined.ok && "snapshot" in joined.data ? joined.data.snapshot?.members[0].displayName : "").toBe("B");
    const submitted = await client.handle({ action: "submit", projectId, pageFingerprint: "f".repeat(64), tasks: [{ id: "task-b", sequence: 0, kind: "content", summary: "B" }] });
    expect(submitted).toEqual({ ok: true, data: { submissionId: "submission-b" } });
    const refreshed = await client.handle({ action: "read", projectId });
    expect(refreshed.ok && "snapshot" in refreshed.data ? refreshed.data.snapshot?.submissions : []).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes("/auth/v1/signup"))).toHaveLength(1);
  });
});
