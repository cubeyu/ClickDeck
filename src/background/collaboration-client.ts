import { getCollaborationConfig, type CollaborationConfig } from "../shared/collaboration-config";
import { decodeCollaborationInvite, encodeCollaborationInvite } from "../shared/collaboration-invite";
import { validSharedTask, validSharedTasks } from "../shared/collaboration-validation";
import type { OAuthLinkContext } from './collaboration-oauth';
import type {
  CollaborationParticipation,
  CollaborationRequest,
  CollaborationResponse
} from "../shared/messages";
import type {
  SharedMember,
  SharedProject,
  SharedProjectSnapshot,
  SharedSubmission
} from "../shared/collaboration-contract";

const SESSION_KEY = "clickdeck:collaboration-auth:v1";
const SESSION_MARGIN_MS = 60_000;

// Only an explicit Auth rejection proves that registration did not commit.
class GuestRegistrationRejected extends Error {}

type StoredSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
};

type StorageArea = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

type ClientOptions = {
  // Selected together by the worker's explicit coordinated build protocol.
  invitedGuestAdmission?: boolean;
  // No direct-table fallback when the selected backend requires controlled reads.
  controlledProjectRead?: boolean;
  googleLogin?: (link?: OAuthLinkContext) => Promise<StoredSession>;
  config?: CollaborationConfig | null;
  fetcher?: typeof fetch;
  storage?: StorageArea;
  // Trusted extension session storage; survives worker suspension, not browser restart.
  recoveryStorage?: StorageArea;
  now?: () => number;
};

type AuthPayload = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function timestamp(value: unknown): number {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  const known = [
    "identity-changed", "guest-registration-uncertain", "identity-storage-failed", "google-login-required", "authentication-required", "invalid-title", "invalid-display-name", "invalid-fingerprint",
    "invalid-invite", "project-not-found", "project-expired", "fingerprint-mismatch",
    "member-limit", "member-not-found", "task-limit", "invalid-task-count", "invalid-tasks",
    "invalid-input", "payload-limit", "project-limit", "service-capacity", "rate-limit", "session-expired", "service-disabled", "migration-required"
  ];
  return known.find((code) => raw.includes(code)) ?? "network-error";
}

function defaultStorage(): StorageArea {
  return chrome.storage.local as unknown as StorageArea;
}

export function createCollaborationClient(options: ClientOptions = {}) {
  const config = options.config === undefined ? getCollaborationConfig() : options.config;
  const fetcher = options.fetcher ?? fetch;
  const suppliedStorage = options.storage;
  const now = options.now ?? Date.now;
  const invitedGuestAdmission = options.invitedGuestAdmission === true;
  const guestAttemptKey = `${SESSION_KEY}:guest-attempt:${config?.projectUrl ?? ''}`;
  const guestRecoveryKey = `${guestAttemptKey}:response`;
  // Preserve a received response across a transient storage failure, never in UI/logs.
  let unsavedGuest: StoredSession | undefined;
  let sessionFlight: Promise<StoredSession> | undefined;

  async function restoreGuest(storage: StorageArea): Promise<boolean> {
    if (!invitedGuestAdmission) return false;
    const rawAttempt = (await storage.get(guestAttemptKey))[guestAttemptKey];
    const attempt = asRecord(rawAttempt);
    if (!unsavedGuest && options.recoveryStorage && attempt.attemptId) {
      const recovery = asRecord((await options.recoveryStorage.get(guestRecoveryKey))[guestRecoveryKey]);
      const session = asRecord(recovery.session);
      if (recovery.attemptId === attempt.attemptId && text(session.accessToken) && text(session.refreshToken)
        && text(session.userId) && typeof session.expiresAt === 'number' && Number.isFinite(session.expiresAt)) {
        unsavedGuest = { accessToken: text(session.accessToken), refreshToken: text(session.refreshToken),
          userId: text(session.userId), expiresAt: session.expiresAt };
      }
    }
    if (unsavedGuest) {
      try { await storage.set({ [SESSION_KEY]: unsavedGuest }); }
      catch { throw new Error('identity-storage-failed'); }
      unsavedGuest = undefined;
      await storage.remove(guestAttemptKey).catch(() => undefined);
      await options.recoveryStorage?.remove(guestRecoveryKey).catch(() => undefined);
      return true;
    }
    if (rawAttempt) throw new Error('guest-registration-uncertain');
    return false;
  }

  async function loginGoogle() {
    if (!config || !options.googleLogin) return { ok: false as const, error: 'not-configured' };
    if (sessionFlight) return { ok: false as const, error: 'rate-limit' };
    const storage = suppliedStorage ?? defaultStorage();
    sessionFlight = (async () => {
      if (!asRecord((await storage.get(SESSION_KEY))[SESSION_KEY]).refreshToken) await restoreGuest(storage);
      const previous = asRecord((await storage.get(SESSION_KEY))[SESSION_KEY]);
      if (previous.refreshToken) {
        const existing = await loadSession();
        const user = asRecord(await requestJson('/auth/v1/user', { method: 'GET' }, existing.accessToken));
        if (user.id !== existing.userId) throw new Error('identity-changed');
        if (user.is_anonymous === false && Array.isArray(user.identities)
          && user.identities.some(value => asRecord(value).provider === 'google')) return existing;
        if (user.is_anonymous !== true) throw new Error('identity-link-required');
        const linked = await options.googleLogin!({ accessToken: existing.accessToken, userId: existing.userId });
        if (linked.userId !== existing.userId) throw new Error('identity-link-conflict');
        const current = asRecord((await storage.get(SESSION_KEY))[SESSION_KEY]);
        if (current.userId !== existing.userId || current.refreshToken !== existing.refreshToken) throw new Error('identity-changed');
        await storage.set({ [SESSION_KEY]: linked });
        return linked;
      }
      const session = await options.googleLogin!();
      // Another identity may have been restored in a different context meanwhile.
      if (asRecord((await storage.get(SESSION_KEY))[SESSION_KEY]).refreshToken) throw new Error('identity-changed');
      await storage.set({ [SESSION_KEY]: session });
      return session;
    })();
    const flight = sessionFlight;
    try { await flight; return { ok: true as const, data: { googleSignedIn: true } }; }
    catch (error) {
      const allowed = ['identity-link-disabled', 'identity-link-conflict', 'identity-link-failed', 'oauth-permission-required', 'identity-link-required', 'identity-changed', 'oauth-cancelled', 'oauth-expired',
        'oauth-busy', 'oauth-failed', 'oauth-exchange-failed', 'invalid-oauth-callback', 'invalid-oauth-session'];
      return { ok: false as const, error: error instanceof Error && allowed.includes(error.message) ? error.message : normalizeError(error) };
    } finally { if (sessionFlight === flight) sessionFlight = undefined; }
  }

  async function requestJson(path: string, init: RequestInit, accessToken?: string): Promise<unknown> {
    if (!config) throw new Error("not-configured");
    const response = await fetcher(`${config.projectUrl}${path}`, {
      ...init,
      headers: {
        apikey: config.publishableKey,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        "Content-Type": "application/json",
        ...(init.headers ?? {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const record = asRecord(body);
      if (path === '/auth/v1/signup' && response.status === 403 && record.code === 403
        && ['invalid-invite', 'fingerprint-mismatch', 'member-limit', 'project-expired', 'service-disabled', 'service-capacity', 'rate-limit']
          .includes(text(record.msg))) throw new GuestRegistrationRejected(text(record.msg));
      if (text(record.code) === "PGRST202" && /create_clickdeck_source_project|upgrade_clickdeck_source|preview_clickdeck_invite|preview_clickdeck_guest_invite|accept_clickdeck_guest_invite|read_clickdeck_project/.test(path)) throw new Error("migration-required");
      if (text(record.code) === "42501") throw new Error("service-disabled");
      if (path === "/auth/v1/user" && response.status === 401) throw new Error("session-expired");
      if (path.startsWith("/auth/v1/token") && response.status >= 400 && response.status < 500 && ["refresh_token_not_found", "refresh_token_already_used", "session_not_found"].includes(text(record.error_code) || text(record.code))) throw new Error("session-expired");
      // Auth Hook rejections use { code: number, msg: string }, unlike
      // PostgREST's { code: string, message: string } error envelope.
      throw new Error(text(record.message) || text(record.msg) || text(record.error_description) || `http-${response.status}`);
    }
    return body;
  }

  function authSession(payload: AuthPayload): StoredSession {
    if (!payload?.access_token || !payload.refresh_token || !payload.user?.id || !Number.isFinite(payload.expires_in)) throw new Error("network-error");
    const session: StoredSession = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: now() + payload.expires_in * 1000,
      userId: payload.user.id
    };
    return session;
  }

  async function saveAuth(payload: AuthPayload, storage: StorageArea): Promise<StoredSession> {
    const session = authSession(payload);
    await storage.set({ [SESSION_KEY]: session });
    return session;
  }

  async function loadSession(forceRefresh = false): Promise<StoredSession> {
    const storage = suppliedStorage ?? defaultStorage();
    const stored = asRecord((await storage.get(SESSION_KEY))[SESSION_KEY]) as Partial<StoredSession>;
    if (!forceRefresh && stored.accessToken && stored.refreshToken && stored.userId && Number(stored.expiresAt) > now() + SESSION_MARGIN_MS) {
      return stored as StoredSession;
    }
    if (stored.refreshToken) {
      const refreshed = await requestJson("/auth/v1/token?grant_type=refresh_token", {
          method: "POST",
          body: JSON.stringify({ refresh_token: stored.refreshToken })
        }) as AuthPayload;
      const session = authSession(refreshed);
      // Refresh renews credentials, never changes the owner of local project state.
      if (!stored.userId || session.userId !== stored.userId) throw new Error('identity-changed');
      const current = asRecord((await storage.get(SESSION_KEY))[SESSION_KEY]);
      if (current.userId !== stored.userId || current.refreshToken !== stored.refreshToken) {
        throw new Error('identity-changed');
      }
      await storage.set({ [SESSION_KEY]: session });
      return session;
    }
    if (invitedGuestAdmission) {
      if (await restoreGuest(storage)) return loadSession(forceRefresh);
      throw new Error('authentication-required');
    }
    const created = await requestJson("/auth/v1/signup", { method: "POST", body: "{}" }) as AuthPayload;
    return saveAuth(created, storage);
  }

  async function ensureSession(): Promise<StoredSession> {
    sessionFlight ??= loadSession();
    const flight = sessionFlight;
    try { return await flight; } finally { if (sessionFlight === flight) sessionFlight = undefined; }
  }

  // Only the trusted confirmation broker exposes this operation. Never replace
  // an identity because of a timeout, rate limit or a business permission error.
  async function recoverIdentity(): Promise<{ ok: true; data: { identityRecovered: true } } | { ok: false; error: string }> {
    if (!config) return { ok: false, error: "not-configured" };
    if (sessionFlight) return { ok: false, error: "rate-limit" };
    const storage = suppliedStorage ?? defaultStorage();
    sessionFlight = (async () => {
      try { return await loadSession(true); }
      catch (error) {
        if (normalizeError(error) !== "session-expired") throw error;
        if (invitedGuestAdmission) throw error;
        const previous = (await storage.get(SESSION_KEY))[SESSION_KEY];
        // Keep one local backup, never expose credentials in UI or diagnostics.
        await storage.set({ [SESSION_KEY + ":previous"]: previous });
        const created = await requestJson("/auth/v1/signup", { method: "POST", body: "{}" }) as AuthPayload;
        return saveAuth(created, storage);
      }
    })();
    const flight = sessionFlight;
    try {
      await flight;
      return { ok: true, data: { identityRecovered: true } };
    } catch (error) { return { ok: false, error: normalizeError(error) }; }
    finally { if (sessionFlight === flight) sessionFlight = undefined; }
  }

  async function rpc(name: string, values: Record<string, unknown>, token: string): Promise<unknown> {
    return requestJson(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(values) }, token);
  }

  async function table(path: string, token: string): Promise<Record<string, unknown>[]> {
    const value = await requestJson(`/rest/v1/${path}`, { method: "GET" }, token);
    return Array.isArray(value) ? value.map(asRecord) : [];
  }

  function project(row: Record<string, unknown>): SharedProject {
    return {
      version: 1, id: text(row.id), title: text(row.title), pageFingerprint: text(row.page_fingerprint),
      fingerprintVersion: row.fingerprint_version === "source-v2" ? "source-v2" : "dom-v1",
      ownerMemberId: "", createdAt: timestamp(row.created_at), lastActivityAt: timestamp(row.last_activity_at),
      expiresAt: timestamp(row.expires_at)
    };
  }

  function member(row: Record<string, unknown>): SharedMember {
    return {
      version: 1, id: text(row.id), projectId: text(row.project_id), displayName: text(row.display_name),
      role: row.role === "owner" ? "owner" : "member", joinedAt: timestamp(row.joined_at)
    };
  }

  function submission(row: Record<string, unknown>, memberIdByUserId: Map<string, string>): SharedSubmission {
    return {
      version: 1, id: text(row.id), projectId: text(row.project_id), memberId: memberIdByUserId.get(text(row.user_id)) ?? "",
      memberDisplayName: text(row.member_display_name), pageFingerprint: text(row.page_fingerprint),
      tasks: Array.isArray(row.tasks) ? row.tasks.filter(validSharedTask) : [], submittedAt: timestamp(row.submitted_at)
    };
  }

  async function readProject(projectId: string, session: StoredSession): Promise<{ participation: CollaborationParticipation; snapshot: SharedProjectSnapshot }> {
    const encoded = encodeURIComponent(projectId);
    let rows: Record<string, unknown>[][];
    if (options.controlledProjectRead) {
      const snapshot = asRecord(await rpc('read_clickdeck_project', { requested_project_id: projectId }, session.accessToken));
      if (![snapshot.projects, snapshot.members, snapshot.submissions].every(Array.isArray)) throw new Error('migration-required');
      rows = [snapshot.projects, snapshot.members, snapshot.submissions].map(value => (value as unknown[]).map(asRecord));
      // No direct-table fallback: that would bypass the server budget.
    } else rows = await Promise.all([
      table(`clickdeck_projects?id=eq.${encoded}&select=*`, session.accessToken),
      table(`clickdeck_members?project_id=eq.${encoded}&select=*`, session.accessToken),
      table(`clickdeck_submissions?project_id=eq.${encoded}&select=*&order=submitted_at.asc,id.asc`, session.accessToken)
    ]);
    const [projectRows, memberRows, submissionRows] = rows;
    if (!projectRows[0]) throw new Error("project-not-found");
    const members = memberRows.map(member);
    const memberIdByUserId = new Map(memberRows.map((row) => [text(row.user_id), text(row.id)]));
    const currentRow = memberRows.find((row) => row.user_id === session.userId);
    if (!currentRow) throw new Error("member-not-found");
    const sharedProject = project(projectRows[0]);
    sharedProject.ownerMemberId = members.find((item) => item.role === "owner")?.id ?? "";
    const current = member(currentRow);
    const submissions = submissionRows.map(row => submission(row, memberIdByUserId));
    const rawTaskCount = submissionRows.reduce((sum, row) => sum + (Array.isArray(row.tasks) ? row.tasks.length : Math.max(1, Number(row.task_count) || 0)), 0);
    const invalidTaskCount = rawTaskCount - submissions.reduce((sum, row) => sum + row.tasks.length, 0);
    return {
      participation: {
        projectId, memberId: current.id, role: current.role, projectTitle: sharedProject.title,
        expiresAt: sharedProject.expiresAt
      },
      snapshot: { version: 1, project: sharedProject, members, submissions, rawTaskCount, invalidTaskCount }
    };
  }

  async function handle(request: CollaborationRequest): Promise<CollaborationResponse> {
    if (request?.action === "verify-source") return { ok: false, error: "invalid-input" };
    if (request?.action === "secure-window") return { ok: false, error: "invalid-input" };
    if (!request || typeof request !== "object" || !["status", "create", "join", "preview-join", "submit", "read", "upgrade-source"].includes(request.action)) return { ok: false, error: "invalid-input" };
    if (request.action === "submit" && !validSharedTasks(request.tasks)) return { ok: false, error: "invalid-tasks" };
    const fields: Partial<Record<CollaborationRequest["action"], string[]>> = {
      create: ["title", "ownerName", "pageFingerprint"], join: ["inviteCode", "displayName", "pageFingerprint"],
      "preview-join": ["inviteCode", "pageFingerprint"],
      submit: ["projectId", "pageFingerprint"], read: ["projectId"],
      "upgrade-source": ["projectId", "pageFingerprint"]
    };
    if ((fields[request.action] ?? []).some(key => {
      const value = (request as unknown as Record<string, unknown>)[key];
      return typeof value !== "string" || !value.trim() || value.length > 500;
    })) return { ok: false, error: "invalid-input" };
    if (request.action === "status") return { ok: true, data: { configured: Boolean(config) } };
    if (!config) return { ok: false, error: "not-configured" };
    try {
      if (invitedGuestAdmission && (request.action === 'preview-join' || request.action === 'join')) {
        const invite = decodeCollaborationInvite(request.inviteCode);
        if (!invite) throw new Error('invalid-invite');
        const expiry = timestamp(await requestJson('/rest/v1/rpc/preview_clickdeck_guest_invite', {
          method: 'POST', body: JSON.stringify({ requested_project_id: invite.projectId,
            requested_invite_token: invite.inviteToken, requested_page_fingerprint: request.pageFingerprint })
        }));
        if (!expiry) throw new Error('migration-required');
        if (expiry <= now()) throw new Error('project-expired');
        if (request.action === 'preview-join') return { ok: true, data: { inviteExpiresAt: expiry } };
        const storage = suppliedStorage ?? defaultStorage();
        if (!asRecord((await storage.get(SESSION_KEY))[SESSION_KEY]).refreshToken) {
          // Never share one new guest registration across different concurrent
          // invitation intents, and never race a Google login/identity restore.
          if (sessionFlight) throw new Error('rate-limit');
          sessionFlight = (async () => {
            if (asRecord((await storage.get(SESSION_KEY))[SESSION_KEY]).refreshToken) throw new Error('authentication-required');
            if (await restoreGuest(storage)) return loadSession();
            // Write before dispatch. No invitation, HTML, name or credentials in this marker.
            // Do not expire it on a timer: elapsed time does not prove Auth rolled back.
            const attemptId = crypto.randomUUID();
            try { await storage.set({ [guestAttemptKey]: { startedAt: now(), attemptId } }); }
            catch { throw new Error('identity-storage-failed'); }
            let created: AuthPayload;
            try {
              created = await requestJson('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ data: {
                clickdeck_guest: { project_id: invite.projectId, invite_token: invite.inviteToken,
                  page_fingerprint: request.pageFingerprint, display_name: request.displayName }
              } }) }) as AuthPayload;
              if (asRecord(created.user).is_anonymous !== true) throw new Error('authentication-required');
              unsavedGuest = authSession(created);
              // Independent short-lived backup, never store the raw Auth user/metadata.
              // If this write fails, still try the primary save with the received session.
              await options.recoveryStorage?.set({ [guestRecoveryKey]: { attemptId, session: unsavedGuest } })
                .catch(() => undefined);
            } catch (error) {
              if (error instanceof GuestRegistrationRejected) {
                await storage.remove(guestAttemptKey);
                throw error;
              }
              throw new Error('guest-registration-uncertain');
            }
            if (asRecord((await storage.get(SESSION_KEY))[SESSION_KEY]).refreshToken) throw new Error('authentication-required');
            await restoreGuest(storage);
            return loadSession();
          })();
          const flight = sessionFlight;
          try { await flight; } finally { if (sessionFlight === flight) sessionFlight = undefined; }
        }
        const session = await ensureSession();
        const memberId = await rpc('accept_clickdeck_guest_invite', {
          requested_project_id: invite.projectId, requested_invite_token: invite.inviteToken,
          requested_page_fingerprint: request.pageFingerprint, requested_display_name: request.displayName
        }, session.accessToken) as string;
        const read = await readProject(invite.projectId, session);
        read.participation.memberId = memberId;
        return { ok: true, data: read };
      }
      if (request.action === 'create') {
        const storage = suppliedStorage ?? defaultStorage();
        if (!asRecord((await storage.get(SESSION_KEY))[SESSION_KEY]).refreshToken) throw new Error('google-login-required');
      }
      const session = await ensureSession();
      if (request.action === "create") {
        const user = asRecord(await requestJson('/auth/v1/user', { method: 'GET' }, session.accessToken));
        if (user.id !== session.userId || user.is_anonymous !== false || !Array.isArray(user.identities)
          || !user.identities.some(value => asRecord(value).provider === 'google')) throw new Error('google-login-required');
        const rows = await rpc(request.sourceVerified ? "create_clickdeck_source_project" : "create_clickdeck_project", {
          requested_title: request.title,
          requested_page_fingerprint: request.pageFingerprint,
          requested_owner_name: request.ownerName
        }, session.accessToken) as Record<string, unknown>[];
        const row = rows[0];
        if (!row) throw new Error("project-not-found");
        return { ok: true, data: { participation: {
          projectId: text(row.project_id), memberId: text(row.owner_member_id), role: "owner",
          projectTitle: request.title.trim(), inviteCode: encodeCollaborationInvite({ projectId: text(row.project_id), inviteToken: text(row.invite_token) }),
          expiresAt: timestamp(row.expires_at)
        } } };
      }
      if (request.action === "upgrade-source") {
        await rpc("upgrade_clickdeck_source", { requested_project_id: request.projectId, requested_page_fingerprint: request.pageFingerprint }, session.accessToken);
        return { ok: true, data: await readProject(request.projectId, session) };
      }
      if (request.action === "preview-join") {
        const invite = decodeCollaborationInvite(request.inviteCode);
        if (!invite) throw new Error("invalid-invite");
        const expiry = timestamp(await rpc("preview_clickdeck_invite", {
          requested_project_id: invite.projectId, requested_invite_token: invite.inviteToken,
          requested_page_fingerprint: request.pageFingerprint
        }, session.accessToken));
        if (!expiry) throw new Error("migration-required");
        return { ok: true, data: { inviteExpiresAt: expiry } };
      }
      if (request.action === "join") {
        const invite = decodeCollaborationInvite(request.inviteCode);
        if (!invite) throw new Error("invalid-invite");
        const memberId = await rpc("join_clickdeck_project", {
          requested_project_id: invite.projectId,
          requested_invite_token: invite.inviteToken,
          requested_page_fingerprint: request.pageFingerprint,
          requested_display_name: request.displayName
        }, session.accessToken) as string;
        const read = await readProject(invite.projectId, session);
        read.participation.memberId = memberId;
        return { ok: true, data: read };
      }
      if (request.action === "submit") {
        const submissionId = await rpc("submit_clickdeck_tasks", {
          requested_project_id: request.projectId,
          requested_page_fingerprint: request.pageFingerprint,
          requested_tasks: request.tasks
        }, session.accessToken) as string;
        // A failed follow-up read must not turn an acknowledged write into a retry.
        // Refresh expiry and the review board independently after confirmation.
        return { ok: true, data: { submissionId } };
      }
      return { ok: true, data: await readProject(request.projectId, session) };
    } catch (error) {
      return { ok: false, error: normalizeError(error) };
    }
  }

  async function checkConnection(): Promise<CollaborationResponse> {
    if (!config) return { ok: false, error: "not-configured" };
    const storage = suppliedStorage ?? defaultStorage();
    const stored = asRecord((await storage.get(SESSION_KEY))[SESSION_KEY]);
    // Do not create an anonymous identity before the user's submission consent.
    if (!stored.refreshToken) return { ok: true, data: { configured: true } };
    try {
      let session = await ensureSession();
      let user: Record<string, unknown>;
      try { user = asRecord(await requestJson("/auth/v1/user", { method: "GET" }, session.accessToken)); }
      catch (error) {
        if (normalizeError(error) !== "session-expired") throw error;
        sessionFlight ??= loadSession(true);
        const flight = sessionFlight;
        try { session = await flight; } finally { if (sessionFlight === flight) sessionFlight = undefined; }
        user = asRecord(await requestJson("/auth/v1/user", { method: "GET" }, session.accessToken));
      }
      const creatorReady = user.id === session.userId && user.is_anonymous === false && Array.isArray(user.identities)
        && user.identities.some(value => asRecord(value).provider === 'google');
      return { ok: true, data: { configured: true, creatorReady } };
    } catch (error) { return { ok: false, error: normalizeError(error) }; }
  }

  return { handle, recoverIdentity, checkConnection, loginGoogle };
}
