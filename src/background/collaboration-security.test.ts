import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCollaborationSecurity, isSecureCollaborationSender } from "./collaboration-security";
import { readSourceFingerprint } from "./source-fingerprint";
import type { CollaborationRequest, CollaborationResponse, CollaborationParticipation } from "../shared/messages";

const fingerprint = "a".repeat(64);
const p: CollaborationParticipation = { projectId: "p", memberId: "m", role: "owner", projectTitle: "P", expiresAt: 9999999999999, inviteCode: "secret" };
const source = { id: "ext", frameId: 0, documentId: "doc1", url: "https://example.com", tab: { id: 1, url: "https://example.com" } } as chrome.runtime.MessageSender;
const secureSender = (id = 2) => ({ id: "ext", frameId: 0, url: "chrome-extension://ext/collaboration.html", tab: { id } }) as chrome.runtime.MessageSender;
function area() {
  const values: Record<string, any> = {};
  return { values, get: vi.fn(async (key: string | null) => key === null ? { ...values } : { [key]: structuredClone(values[key]) }),
    set: vi.fn(async (next: Record<string, unknown>) => { Object.assign(values, structuredClone(next)); }),
    remove: vi.fn(async (keys: string | string[]) => { for (const k of Array.isArray(keys) ? keys : [keys]) delete values[k]; }) };
}
describe("trusted collaboration confirmation", () => {
  let local: ReturnType<typeof area>, session: ReturnType<typeof area>;
  let handle: ReturnType<typeof vi.fn<(request: CollaborationRequest) => Promise<CollaborationResponse>>>, broker: ReturnType<typeof createCollaborationSecurity>;
  const ticket = () => Object.keys(session.values).find(k => k.startsWith("clickdeck:secure-ticket:"))!.split(":").at(-1)!;
  beforeEach(() => {
    local = area(); session = area();
    let nextTab = 2;
    vi.stubGlobal("chrome", {
      runtime: { id: "ext", getURL: (s: string) => `chrome-extension://ext/${s}` }, storage: { local, session },
      windows: { create: vi.fn(async () => ({ id: 10, tabs: [{ id: nextTab++ }] })), remove: vi.fn(async () => undefined) },
      tabs: { get: vi.fn(async () => source.tab), sendMessage: vi.fn(async () => ({ alive: true })) }
    });
    handle = vi.fn(async (): Promise<CollaborationResponse> => ({ ok: true, data: { participation: p } }));
    broker = createCollaborationSecurity({ handle });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('allows Google login only from a live confirmed trusted window without consuming its project ticket', async () => {
    const loginGoogle = vi.fn(async () => ({ ok: true as const, data: { googleSignedIn: true } }));
    broker = createCollaborationSecurity({ handle, loginGoogle });
    await broker.open({ action: 'secure-window', pageFingerprint: fingerprint }, source);
    const id = ticket();
    expect(await broker.secure({ command: 'login-google', ticket: id, consent: true }, source)).toMatchObject({ ok: false });
    expect(await broker.secure({ command: 'login-google', ticket: id }, secureSender())).toMatchObject({ ok: false });
    expect(await broker.secure({ command: 'login-google', ticket: id, consent: true }, secureSender(99))).toMatchObject({ ok: false });
    expect(loginGoogle).not.toHaveBeenCalled();
    expect(await broker.secure({ command: 'login-google', ticket: id, consent: true }, secureSender())).toMatchObject({ ok: true });
    expect(session.values['clickdeck:secure-ticket:' + id]).toBeDefined();
    expect(handle).not.toHaveBeenCalled();
    expect(Object.keys(local.values)).toHaveLength(0);
  });

  it("preflights an invitation only with consent and keeps the ticket and local associations untouched", async () => {
    await broker.open({ action: "secure-window", pageFingerprint: fingerprint }, source);
    const id = ticket();
    const before = structuredClone(local.values);
    expect(await broker.secure({ command: "preview-join", ticket: id, invite: "code" }, secureSender())).toMatchObject({ ok: false, error: "consent-required" });
    expect(handle).not.toHaveBeenCalled();
    handle.mockResolvedValueOnce({ ok: true, data: { inviteExpiresAt: p.expiresAt } });
    expect(await broker.secure({ command: "preview-join", ticket: id, invite: "code", consent: true }, secureSender())).toEqual({ ok: true, data: { inviteExpiresAt: p.expiresAt } });
    expect(handle).toHaveBeenCalledWith({ action: "preview-join", inviteCode: "code", pageFingerprint: fingerprint });
    expect(ticket()).toBe(id);
    expect(local.values).toEqual(before);
    expect(await broker.secure({ command: "join", ticket: id, invite: "code", name: "Reviewer", consent: true }, secureSender())).toMatchObject({ ok: true });
    expect(session.values["clickdeck:secure-ticket:" + id]).toBeUndefined();
  });

  it("keeps legacy associations unchanged until an owner confirms a rechecked source upgrade", async () => {
    const html = "<!doctype html><body>Original</body>";
    const fetchSource = vi.fn(async () => new Response(html));
    vi.stubGlobal("fetch", fetchSource);
    const verified = await readSourceFingerprint(source.tab!.url);
    if (!verified.ok) throw Error("fixture unavailable");
    local.values["clickdeck:collaboration-page:v1:" + fingerprint] = p;
    local.values.edits = "preserved";
    expect(await broker.open({ action: "secure-window", pageFingerprint: verified.fingerprint, sourceVerified: true, upgradeProjectId: "p" }, source)).toMatchObject({ ok: true });
    expect(local.values["clickdeck:collaboration-page:v1:" + verified.fingerprint]).toBeUndefined();
    expect(local.values["clickdeck:collaboration-page:v1:" + fingerprint].projectId).toBe("p");
    const id = ticket();
    expect(await broker.secure({ command: "upgrade-source", ticket: id }, secureSender())).toMatchObject({ ok: false });
    fetchSource.mockImplementation(async () => new Response(html + "<!-- changed -->"));
    expect(await broker.secure({ command: "upgrade-source", ticket: id, consent: true }, secureSender())).toMatchObject({ ok: false, error: "source-changed" });
    expect(handle).not.toHaveBeenCalled();
    fetchSource.mockImplementation(async () => new Response(html));
    expect(await broker.secure({ command: "upgrade-source", ticket: id, consent: true }, secureSender())).toMatchObject({ ok: true });
    expect(handle).toHaveBeenCalledWith({ action: "upgrade-source", projectId: "p", pageFingerprint: verified.fingerprint });
    expect(local.values.edits).toBe("preserved");
    expect(local.values["clickdeck:collaboration-page:v1:" + fingerprint].projectId).toBe("p");
  });

  it("restricts recovery to confirmed trusted windows and drops stale previews without deleting edits", async () => {
    local.values["clickdeck:collaboration-page:v1:" + fingerprint] = p;
    local.values.edits = "preserved";
    const recoverIdentity = vi.fn(async () => ({ ok: true as const, data: { identityRecovered: true as const } }));
    broker = createCollaborationSecurity({ handle, recoverIdentity });
    await broker.open({ action: "secure-window", pageFingerprint: fingerprint, tasks: [{ id: "t", sequence: 0, kind: "content", summary: "A" }] }, source);
    const id = ticket();
    expect(await broker.secure({ command: "recover", ticket: id, consent: true }, source)).toMatchObject({ ok: false });
    expect(await broker.secure({ command: "recover", ticket: id }, secureSender())).toMatchObject({ ok: false });
    expect(recoverIdentity).not.toHaveBeenCalled();
    expect(await broker.secure({ command: "recover", ticket: id, consent: true }, secureSender())).toMatchObject({ ok: true });
    expect(await broker.secure({ command: "view", ticket: id }, secureSender())).toMatchObject({ ok: true, data: { tasks: undefined, participation: undefined } });
    expect(local.values.edits).toBe("preserved");
    expect(local.values["clickdeck:collaboration-page:v1:" + fingerprint].projectId).toBe("p");
    expect(await broker.secure({ command: "submit", ticket: id, consent: true }, secureSender())).toMatchObject({ ok: false });
    expect(handle).not.toHaveBeenCalled();
  });

  it("rejects webpage origins, other extensions, subframes and the wrong window", async () => {
    await broker.open({ action: "secure-window", pageFingerprint: fingerprint }, source);
    for (const sender of [source, { ...secureSender(), id: "other" }, { ...secureSender(), frameId: 1 }, secureSender(99)]) {
      expect((await broker.secure({ command: "create", ticket: ticket(), consent: true }, sender)).ok).toBe(false);
    }
    expect(isSecureCollaborationSender(source)).toBe(false);
    expect(handle).not.toHaveBeenCalled();
  });

  it("requires consent, consumes confirmation once, and migrates invites out of participation", async () => {
    local.values["clickdeck:collaboration-page:v1:" + fingerprint] = p;
    await broker.open({ action: "secure-window", pageFingerprint: fingerprint }, source);
    let id = ticket();
    expect(local.values["clickdeck:collaboration-page:v1:" + fingerprint].inviteCode).toBeUndefined();
    expect(local.values["clickdeck:secure-invite:p"]).toBe("secret");
    expect(await broker.secure({ command: "create", ticket: id }, secureSender())).toMatchObject({ ok: false, error: "consent-required" });
    expect(handle).not.toHaveBeenCalled();
    expect(await broker.secure({ command: "create", ticket: id, consent: true }, secureSender())).toMatchObject({ ok: false, error: "project-already-linked" });
    delete local.values["clickdeck:collaboration-page:v1:" + fingerprint];
    await broker.open({ action: "secure-window", pageFingerprint: fingerprint }, source);
    id = ticket();
    expect((await broker.secure({ command: "create", ticket: id, consent: true, title: "P", name: "A" }, secureSender(3))).ok).toBe(true);
    expect(await broker.secure({ command: "create", ticket: id, consent: true }, secureSender(3))).toMatchObject({ ok: false, error: "request-expired" });
    expect(session.values["clickdeck:secure-tab:1"]).toBeUndefined();
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("replaces old windows and uses the exact new task snapshot", async () => {
    local.values["clickdeck:collaboration-page:v1:" + fingerprint] = p;
    await broker.open({ action: "secure-window", pageFingerprint: fingerprint }, source);
    const old = ticket();
    const tasks = [{ id: "t", sequence: 0, kind: "content" as const, summary: "A", after: "B" }];
    await broker.open({ action: "secure-window", pageFingerprint: fingerprint, tasks }, source);
    tasks[0].after = "mutated";
    expect(chrome.windows.remove).toHaveBeenCalledWith(10);
    expect(await broker.secure({ command: "view", ticket: old }, secureSender())).toMatchObject({ ok: false });
    const id = ticket();
    await broker.secure({ command: "submit", ticket: id, consent: true }, secureSender(3));
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ action: "submit", tasks: [expect.objectContaining({ after: "B" })] }));
  });

  it("invalidates expired requests, navigation, closed pages and same-URL reloads", async () => {
    await broker.open({ action: "secure-window", pageFingerprint: fingerprint }, source);
    const id = ticket();
    vi.mocked(chrome.tabs.get).mockResolvedValueOnce({ ...source.tab, url: "https://other.com" } as chrome.tabs.Tab);
    expect(await broker.secure({ command: "view", ticket: id }, secureSender())).toMatchObject({ ok: false });
    vi.mocked(chrome.tabs.sendMessage).mockRejectedValueOnce(new Error("document no longer exists"));
    expect(await broker.secure({ command: "view", ticket: id }, secureSender())).toMatchObject({ ok: false });
    session.values["clickdeck:secure-ticket:" + id].expiresAt = 0;
    expect(await broker.secure({ command: "view", ticket: id }, secureSender())).toMatchObject({ ok: false });
    expect(handle).not.toHaveBeenCalled();
  });
});
