import type { CollaborationParticipation, CollaborationRequest, CollaborationResponse } from "../shared/messages";
import type { SharedTask } from "../shared/collaboration-contract";
import { validSharedTasks } from "../shared/collaboration-validation";
import { readSourceFingerprint } from "./source-fingerprint";

type Ticket = {
  id: string; tabId: number; documentId: string; url: string; expiresAt: number; windowTabId?: number;
  fingerprint: string; tasks?: SharedTask[]; participation?: CollaborationParticipation;
  sourceVerified?: boolean; upgradeProjectId?: string;
};
const PREFIX = "clickdeck:collaboration-page:v1:";
const TICKETS = "clickdeck:secure-ticket:";
const INVITES = "clickdeck:secure-invite:";
const securePath = "collaboration.html";
// Keep this small URL-key helper local: content scripts must remain standalone
// classic scripts, not Rollup entries importing a shared ES module chunk.
function pageAssociationKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return "clickdeck:collaboration-url:v1:" + parsed.href;
}
const safeParticipation = (p: CollaborationParticipation): CollaborationParticipation => {
  const { inviteCode: _invite, ...safe } = p;
  return safe;
};

export function isSecureCollaborationSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.frameId === 0 && Boolean(sender.tab?.id)
    && sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL(securePath);
}

export function createCollaborationSecurity(client: { loginGoogle?(): Promise<{ ok: true; data: { googleSignedIn: boolean } } | { ok: false; error: string }>; handle(request: CollaborationRequest): Promise<CollaborationResponse>; checkConnection?(): Promise<CollaborationResponse>; recoverIdentity?(): Promise<{ ok: true; data: { identityRecovered: true } } | { ok: false; error: string }> }, privateStorage?: { get(key: string): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void> }) {
  const secrets = () => privateStorage ?? chrome.storage.local;
  const busy = new Set<string>();
  const opening = new Set<number>();

  async function open(request: Extract<CollaborationRequest, { action: "secure-window" }>, sender: chrome.runtime.MessageSender): Promise<CollaborationResponse> {
    if (!sender.tab?.id || !sender.tab.url || !sender.documentId || !/^[0-9a-f]{64}$/.test(request.pageFingerprint)
      || (request.tasks !== undefined && !validSharedTasks(request.tasks))) return { ok: false, error: "invalid-input" };
    const tabId = sender.tab.id;
    if (opening.has(tabId)) return { ok: false, error: "rate-limit" };
    opening.add(tabId);
    try {
      if (request.sourceVerified) {
        const source = await readSourceFingerprint(sender.tab.url);
        if (!source.ok) return source;
        if (source.fingerprint !== request.pageFingerprint) return { ok: false, error: "source-changed" };
      }
      const activeKey = `clickdeck:secure-tab:${tabId}`;
      const active = (await chrome.storage.session.get(activeKey))[activeKey] as { windowId: number; ticketId: string; expiresAt: number } | undefined;
      if (active) {
        await chrome.storage.session.remove([activeKey, TICKETS + active.ticketId]);
        await chrome.windows.remove(active.windowId).catch(() => undefined);
      }
      const cached = await chrome.storage.session.get(null);
      const stale = Object.entries(cached).filter(([key, value]) => (key.startsWith(TICKETS) || key.startsWith("clickdeck:secure-tab:")) && value.expiresAt <= Date.now()).map(([key]) => key);
      if (stale.length) await chrome.storage.session.remove(stale);
      const key = PREFIX + request.pageFingerprint;
      let participation = (await chrome.storage.local.get(key))[key] as CollaborationParticipation | undefined;
      if (request.upgradeProjectId) {
        if (!request.sourceVerified) return { ok: false, error: "invalid-input" };
        const all = await chrome.storage.local.get(null);
        participation = Object.entries(all).find(([k,p]) => k.startsWith(PREFIX) && p?.projectId === request.upgradeProjectId && p?.role === "owner")?.[1];
        if (!participation) return { ok: false, error: "member-not-found" };
      }
      if (participation && participation.expiresAt <= Date.now()) participation = undefined;
      if (participation?.inviteCode) {
        await secrets().set({ [INVITES + participation.projectId]: participation.inviteCode });
        participation = safeParticipation(participation);
        if (!request.upgradeProjectId) await chrome.storage.local.set({ [key]: participation });
      }
      if (request.tasks && !participation) return { ok: false, error: "project-not-found" };
      const id = crypto.randomUUID();
      const ticket: Ticket = { id, tabId, documentId: sender.documentId, url: sender.tab.url, fingerprint: request.pageFingerprint, tasks: request.tasks, participation, sourceVerified: request.sourceVerified, upgradeProjectId: request.upgradeProjectId, expiresAt: Date.now() + 5 * 60_000 };
      await chrome.storage.session.set({ [TICKETS + id]: ticket });
      const win = await chrome.windows.create({ url: chrome.runtime.getURL(`${securePath}#${id}`), type: "popup", width: 600, height: 740, focused: true });
      ticket.windowTabId = win.tabs?.[0]?.id;
      await chrome.storage.session.set({ [TICKETS + id]: ticket, [activeKey]: { windowId: win.id, ticketId: id, expiresAt: ticket.expiresAt } });
      return { ok: true, data: { secureWindow: true } };
    } finally { opening.delete(tabId); }
  }

  async function secure(message: { ticket?: string; command?: string; title?: string; name?: string; invite?: string; consent?: boolean }, sender: chrome.runtime.MessageSender) {
    if (!isSecureCollaborationSender(sender) || typeof message.ticket !== "string") return { ok: false, error: "unauthorized" };
    const key = TICKETS + message.ticket;
    const ticket = (await chrome.storage.session.get(key))[key] as Ticket | undefined;
    if (!ticket || ticket.windowTabId !== sender.tab?.id || ticket.expiresAt <= Date.now()) return { ok: false, error: "request-expired" };
    const tab = await chrome.tabs.get(ticket.tabId).catch(() => null);
    if (!tab || tab.url !== ticket.url) return { ok: false, error: "request-expired" };
    const alive = await chrome.tabs.sendMessage(ticket.tabId, { type: "CLICKDECK_COLLABORATION_SOURCE_ALIVE" }, { documentId: ticket.documentId }).catch(() => null);
    if (alive?.alive !== true) return { ok: false, error: "request-expired" };
    if (message.command === "view") {
      const checked = await client.checkConnection?.();
      let connectionError = checked && !checked.ok ? checked.error : undefined;
      let invite: string | undefined;
      if (!connectionError && ticket.participation?.role === "owner") {
        const result = await client.handle({ action: "read", projectId: ticket.participation.projectId });
        if (result.ok && "participation" in result.data && result.data.participation.role === "owner") {
          invite = (await secrets().get(INVITES + ticket.participation.projectId))[INVITES + ticket.participation.projectId];
        }
        if (!result.ok) connectionError = result.error;
      }
      const creatorReady = Boolean(checked?.ok && 'configured' in checked.data && checked.data.creatorReady);
      return { ok: true, data: { url: ticket.url, tasks: ticket.tasks, participation: ticket.participation, invite, connectionError, creatorReady, upgradeProjectId: ticket.upgradeProjectId } };
    }
    if (!message.consent || !["login-google", "create", "join", "preview-join", "submit", "recover", "upgrade-source"].includes(message.command ?? "")) return { ok: false, error: "consent-required" };
    if (busy.has(ticket.id)) return { ok: false, error: "rate-limit" };
    busy.add(ticket.id);
    try {
      // A concurrent confirmation may have read the ticket before it was consumed.
      if (!(await chrome.storage.session.get(key))[key]) return { ok: false, error: "request-expired" };
      if (message.command === 'login-google') {
        if (!client.loginGoogle) return { ok: false, error: 'not-configured' };
        return await client.loginGoogle();
      }
      if (message.command === "recover") {
        if (!client.recoverIdentity) return { ok: false, error: "invalid-input" };
        const result = await client.recoverIdentity();
        if (result.ok) {
          // Keep saved project references and local edits, but do not submit an
          // old preview under a potentially different identity.
          delete ticket.tasks;
          delete ticket.participation;
          delete ticket.upgradeProjectId;
          await chrome.storage.session.set({ [key]: ticket });
        }
        return result;
      }
      let request: CollaborationRequest;
      if (ticket.sourceVerified) {
        const source = await readSourceFingerprint(ticket.url);
        if (!source.ok) return source;
        if (source.fingerprint !== ticket.fingerprint) return { ok: false, error: "source-changed" };
      }
      if (!ticket.tasks && ticket.participation && ticket.participation.expiresAt > Date.now() && !ticket.upgradeProjectId) return { ok: false, error: "project-already-linked" };
      if (ticket.upgradeProjectId) {
        if (message.command !== "upgrade-source" || ticket.participation?.role !== "owner") return { ok: false, error: "unauthorized" };
        request = { action: "upgrade-source", projectId: ticket.upgradeProjectId, pageFingerprint: ticket.fingerprint };
      } else if (ticket.tasks) {
        if (message.command !== "submit" || !ticket.participation) return { ok: false, error: "invalid-input" };
        request = { action: "submit", projectId: ticket.participation.projectId, pageFingerprint: ticket.fingerprint, tasks: ticket.tasks };
      } else if (message.command === "create") {
        request = { action: "create", title: message.title ?? "", ownerName: message.name ?? "", pageFingerprint: ticket.fingerprint, sourceVerified: ticket.sourceVerified };
      } else if (message.command === "preview-join") {
        return await client.handle({ action: "preview-join", inviteCode: message.invite ?? "", pageFingerprint: ticket.fingerprint });
      } else if (message.command === "join") {
        request = { action: "join", inviteCode: message.invite ?? "", displayName: message.name ?? "", pageFingerprint: ticket.fingerprint };
      } else return { ok: false, error: "invalid-input" };
      const result = await client.handle(request);
      if (!result.ok) return result;
      if ("participation" in result.data) {
        const p = result.data.participation;
        if (p.inviteCode) await secrets().set({ [INVITES + p.projectId]: p.inviteCode });
        await chrome.storage.local.set({ [PREFIX + ticket.fingerprint]: safeParticipation(p) });
        await chrome.storage.local.set({ [pageAssociationKey(ticket.url)]: { fingerprint: ticket.fingerprint, participation: safeParticipation(p) } });
      }
      // Successful approval is single use, even if the response is replayed.
      await chrome.storage.session.remove([key, `clickdeck:secure-tab:${ticket.tabId}`]);
      await chrome.tabs.sendMessage(ticket.tabId, { type: "CLICKDECK_COLLABORATION_UPDATED", action: request.action }).catch(() => undefined);
      return result;
    } finally { busy.delete(ticket.id); }
  }
  return { open, secure };
}
