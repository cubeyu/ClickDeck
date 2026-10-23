// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedProjectSnapshot } from "../shared/collaboration-contract";
import type { CollaborationParticipation, CollaborationRequest, CollaborationResponse } from "../shared/messages";
import { createCollaborationPanel } from "./collaboration-panel";
import { downloadCollaborationBackup } from "./collaboration-backup";
vi.mock("./collaboration-backup", () => ({ downloadCollaborationBackup: vi.fn() }));

const participation: CollaborationParticipation = {
  projectId: "project-1",
  memberId: "member-owner",
  role: "owner",
  projectTitle: "封面复核",
  inviteCode: "ABCD-1234",
  expiresAt: Date.now() + 48 * 3600_000
};

const snapshot: SharedProjectSnapshot = {
  version: 1,
  project: {
    version: 1,
    id: "project-1",
    title: "封面复核",
    pageFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ownerMemberId: "member-owner",
    createdAt: Date.UTC(2026, 8, 22, 8),
    lastActivityAt: Date.UTC(2026, 8, 22, 9),
    expiresAt: participation.expiresAt
  },
  members: [
    { version: 1, id: "member-owner", projectId: "project-1", displayName: "小宁", role: "owner", joinedAt: Date.UTC(2026, 8, 22, 8) },
    { version: 1, id: "member-reviewer", projectId: "project-1", displayName: "审阅者 B", role: "member", joinedAt: Date.UTC(2026, 8, 22, 8, 20) }
  ],
  submissions: [{
    version: 1,
    id: "submission-1",
    projectId: "project-1",
    memberId: "member-reviewer",
    memberDisplayName: "审阅者 B",
    pageFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    submittedAt: Date.UTC(2026, 8, 22, 9),
    tasks: [{
      id: "task-1",
      sequence: 0,
      kind: "content",
      summary: "标题文字需要更简洁",
      before: "把城市走慢一点",
      after: "慢慢看城市",
      locator: {
        descriptor: "h1.title",
        tagName: "h1",
        cssPath: "#review-heading",
        nthOfTypePath: "body > h1:nth-of-type(1)",
        siblingIndex: 0,
        selectorStability: "high"
      }
    }]
  }]
};

describe("collaboration panel", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    writeText.mockClear();
    vi.mocked(downloadCollaborationBackup).mockClear();
    vi.stubGlobal("chrome", {
      i18n: { getUILanguage: () => "zh-CN" },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined)
        }
      }
    });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "clipboard");
    document.body.innerHTML = "";
  });

  it.each(["owner", "member"] as const)("labels numeric project names, current role and inclusive headcount for %s", async role => {
    const current = { ...participation, projectTitle: "1", role,
      memberId: role === "owner" ? "member-owner" : "member-reviewer" };
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({
      ["clickdeck:collaboration-page:v1:" + snapshot.project.pageFingerprint]: current
    }));
    const host = document.createElement("div"); document.body.appendChild(host);
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(snapshot.project.pageFingerprint),
      getTasks: () => ({ ok: false, error: "empty" }), onTeamPrompt: vi.fn(),
      request: async input => input.action === "status" ? { ok: true, data: { configured: true } }
        : { ok: true, data: { participation: current, snapshot } } });
    try {
      await panel.open();
      const summary = host.querySelector(".clickdeck-collab-summary")!;
      expect(summary.textContent).toContain("项目：1");
      expect(summary.textContent).toContain(role === "owner" ? "你的角色：创建者" : "你的角色：成员");
      expect(summary.textContent).toContain("共 2 人（含创建者）");
      expect(summary.textContent).not.toContain("位协作者");
    } finally { panel.destroy(); }
  });

  it("explains the file-plus-invite flow before creation or joining", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const request = vi.fn(async (): Promise<CollaborationResponse> => ({ ok: true, data: { configured: true } }));
    const panel = createCollaborationPanel({
      host,
      pageFingerprint: Promise.resolve(snapshot.project.pageFingerprint),
      getTasks: () => ({ ok: false, error: "empty" }),
      onTeamPrompt: vi.fn(),
      request
    });

    await panel.open();

    expect(host.textContent).toContain("团队审阅");
    expect(host.querySelector(".clickdeck-collab-overlay--entry")).not.toBeNull();
    expect(host.textContent).toContain("当前页面尚未关联项目");
    expect(host.querySelector<HTMLDetailsElement>("[data-collab-help]")?.open).toBe(false);
    expect(host.querySelector(".clickdeck-collab-modal__header small")).toBeNull();
    expect(host.textContent).toContain("协作项目不托管网页");
    expect(host.querySelector("[data-collab='manage']")).not.toBeNull();
    expect(host.querySelector("form")).toBeNull();
    expect(host.textContent).toContain("独立扩展窗口");
    expect(host.textContent).toContain("刷新均不续期");
  });

  it('reports the exact source failure and retries instead of retaining the initial empty fingerprint', async () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    let allowed = false;
    const request = vi.fn(async (input: CollaborationRequest): Promise<CollaborationResponse> => {
      if (input.action === 'verify-source') return allowed
        ? { ok: true, data: { fingerprint: snapshot.project.pageFingerprint } }
        : { ok: false, error: 'source-file-permission' };
      return { ok: true, data: { configured: true } };
    });
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(''), sourceVerification: true,
      getTasks: () => ({ ok: false, error: 'empty' }), onTeamPrompt: vi.fn(), request });
    await panel.open();
    expect(host.textContent).toContain('浏览器未允许此扩展访问本地文件');
    allowed = true;
    host.querySelector<HTMLButtonElement>('[data-collab="verify-source"]')!.click();
    await vi.waitFor(() => expect(host.textContent).toContain('原始版本已核验'));
    expect(request.mock.calls.filter(([input]) => input.action === 'verify-source')).toHaveLength(2);
    expect(request.mock.calls.some(([input]) => ['create', 'join', 'submit'].includes(input.action))).toBe(false);
    panel.destroy();
  });

  it.each(['refresh', 'reopen', 'current-page'])('automatically retries a failed source check on %s and reuses success', async recovery => {
    const host = document.createElement('div'); document.body.appendChild(host);
    let allowed = false;
    const onSourceVerified = vi.fn();
    const request = vi.fn(async (input: CollaborationRequest): Promise<CollaborationResponse> => {
      if (input.action === 'verify-source') return allowed
        ? { ok: true, data: { fingerprint: snapshot.project.pageFingerprint } }
        : { ok: false, error: 'source-fetch-failed' };
      return { ok: true, data: { configured: true } };
    });
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(''), sourceVerification: true,
      onSourceVerified, getTasks: () => ({ ok: false, error: 'empty' }), onTeamPrompt: vi.fn(), request });
    try {
      await panel.open();
      expect(host.textContent).toContain('核验步骤3');
      expect(host.textContent).toContain('暂时无法确认关联项目');
      expect(host.textContent).not.toContain('当前页面尚未关联项目');
      expect(onSourceVerified).not.toHaveBeenCalled();
      allowed = true;
      if (recovery === 'reopen') {
        host.querySelector<HTMLButtonElement>('[data-collab="close"]')!.click();
        await panel.open();
      } else {
        host.querySelector<HTMLButtonElement>(`[data-collab="${recovery}"]`)!.click();
        await vi.waitFor(() => expect(host.querySelector('.clickdeck-collab-modal__busy')).toBeNull());
      }
      expect(host.textContent).toContain('原始版本已核验');
      expect(host.textContent).toContain('当前页面尚未关联项目');
      expect(host.querySelector('[data-collab="verify-source"]')).toBeNull();
      expect(host.textContent).not.toContain('核验步骤3');
      expect(onSourceVerified).toHaveBeenCalledExactlyOnceWith(snapshot.project.pageFingerprint);
      await panel.open();
      expect(request.mock.calls.filter(([input]) => input.action === 'verify-source')).toHaveLength(2);
      expect(request.mock.calls.some(([input]) => ['create', 'join', 'submit'].includes(input.action))).toBe(false);
    } finally { panel.destroy(); }
    const recreated = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(onSourceVerified.mock.calls[0][0]), sourceVerification: true,
      getTasks: () => ({ ok: false, error: 'empty' }), onTeamPrompt: vi.fn(), request });
    try {
      await recreated.open();
      expect(host.textContent).toContain('原始版本已核验');
      expect(request.mock.calls.filter(([input]) => input.action === 'verify-source')).toHaveLength(2);
    } finally { recreated.destroy(); }
  });

  it('keeps a repeated source failure visible after refreshing instead of clearing it', async () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const request = vi.fn(async (input: CollaborationRequest): Promise<CollaborationResponse> => input.action === 'verify-source'
      ? { ok: false, error: 'source-fetch-failed' } : { ok: true, data: { configured: true } });
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(''), sourceVerification: true,
      getTasks: () => ({ ok: false, error: 'empty' }), onTeamPrompt: vi.fn(), request });
    try {
      await panel.open();
      host.querySelector<HTMLButtonElement>('[data-collab="refresh"]')!.click();
      await vi.waitFor(() => expect(request.mock.calls.filter(([input]) => input.action === 'verify-source')).toHaveLength(2));
      await vi.waitFor(() => expect(host.querySelector('.clickdeck-collab-modal__busy')).toBeNull());
      expect(host.textContent).toContain('核验步骤3');
      expect(host.textContent).not.toContain('原始版本已核验');
      expect(host.querySelector('[data-collab="verify-source"]')?.textContent).toBe('重试文件检查');
    } finally { panel.destroy(); }
  });

  it('keeps the last local source diagnostic after retry succeeds without another request or storage write', async () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const diagnostic = JSON.stringify({ version: 1, error: 'source-fetch-failed', network: 'net::ERR_ACCESS_DENIED' }, null, 2);
    let allowed = false;
    const request = vi.fn(async (input: CollaborationRequest): Promise<CollaborationResponse> => {
      if (input.action === 'verify-source') return allowed
        ? { ok: true, data: { fingerprint: snapshot.project.pageFingerprint } }
        : { ok: false, error: 'source-fetch-failed', sourceDiagnostic: diagnostic };
      return { ok: true, data: { configured: true } };
    });
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(''), sourceVerification: true,
      getTasks: () => ({ ok: false, error: 'empty' }), onTeamPrompt: vi.fn(), request });
    try {
      await panel.open();
      const details = host.querySelector<HTMLDetailsElement>('[data-collab-source-diagnostic]')!;
      expect(details.open).toBe(false);
      expect(details.previousElementSibling?.className).toBe('clickdeck-collab-modal__message');
      expect(details.querySelector('pre')?.textContent).toBe(diagnostic);
      details.open = true;
      allowed = true;
      host.querySelector<HTMLButtonElement>('[data-collab="verify-source"]')!.click();
      await vi.waitFor(() => expect(host.textContent).toContain('原始版本已核验'));
      expect(host.querySelector('.clickdeck-collab-modal__message')).toBeNull();
      expect(host.querySelector<HTMLDetailsElement>('[data-collab-source-diagnostic]')?.open).toBe(true);
      expect(host.querySelector('[data-collab-source-diagnostic] pre')?.textContent).toBe(diagnostic);
      host.querySelector<HTMLButtonElement>('[data-collab="close"]')!.click();
      await panel.open();
      expect(host.querySelector('[data-collab-source-diagnostic] pre')?.textContent).toBe(diagnostic);
      expect(request.mock.calls.map(([input]) => input.action)).toEqual(['status', 'verify-source', 'verify-source']);
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
    } finally { panel.destroy(); }
  });

  it.each([undefined, '', 'x'.repeat(2001)])('does not show a diagnostic entry for absent or oversized diagnostic data', async sourceDiagnostic => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(''), sourceVerification: true,
      getTasks: () => ({ ok: false, error: 'empty' }), onTeamPrompt: vi.fn(), request: async input => input.action === 'verify-source'
        ? { ok: false, error: 'source-fetch-failed', sourceDiagnostic } : { ok: true, data: { configured: true } } });
    try {
      await panel.open();
      expect(host.textContent).toContain('核验步骤3');
      expect(host.querySelector('[data-collab-source-diagnostic]')).toBeNull();
      expect(host.querySelector('[data-collab="copy-source-diagnostic"]')).toBeNull();
      expect(writeText).not.toHaveBeenCalled();
    } finally { panel.destroy(); }
  });

  it('escapes diagnostics and copies only closure data after a trusted click, never page DOM text', async () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const diagnostic = JSON.stringify({ error: 'source-fetch-failed', sample: '<img src=x onerror="alert(1)"> & </pre>' }, null, 2);
    const sendMessage = vi.fn(async ({ request }: { request: CollaborationRequest }): Promise<CollaborationResponse> => request.action === 'verify-source'
      ? { ok: false, error: 'source-fetch-failed', sourceDiagnostic: diagnostic } : { ok: true, data: { configured: true } });
    Object.assign(chrome, { runtime: { sendMessage } });
    const listeners = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(''), sourceVerification: true,
      getTasks: () => ({ ok: false, error: 'empty' }), onTeamPrompt: vi.fn() });
    try {
      await panel.open();
      const pre = host.querySelector<HTMLPreElement>('[data-collab-source-diagnostic] pre')!;
      expect(pre.textContent).toBe(diagnostic);
      expect(pre.querySelector('img')).toBeNull();
      expect(pre.style.whiteSpace).toBe('pre-wrap');
      expect(pre.style.overflowWrap).toBe('anywhere');
      const button = host.querySelector<HTMLButtonElement>('[data-collab="copy-source-diagnostic"]')!;
      pre.textContent = 'page-injected diagnostic';
      button.dataset.diagnostic = 'another page-injected diagnostic';
      button.click();
      expect(writeText).not.toHaveBeenCalled();
      // jsdom cannot emit trusted input. Invoke the registered handler with a trusted-event stub.
      const listener = listeners.mock.calls.find(([type], index) => type === 'click' && listeners.mock.contexts[index] === button)?.[1] as EventListener;
      await listener.call(button, { isTrusted: true } as Event);
      expect(writeText).toHaveBeenCalledExactlyOnceWith(diagnostic);
      expect(button.textContent).toBe('已复制诊断');
      expect(sendMessage).toHaveBeenCalledTimes(2);
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    } finally { listeners.mockRestore(); panel.destroy(); }
  });

  it('does not lose the service error when the source check succeeds', async () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(''), sourceVerification: true,
      getTasks: () => ({ ok: false, error: 'empty' }), onTeamPrompt: vi.fn(), request: async input => input.action === 'verify-source'
        ? { ok: true, data: { fingerprint: snapshot.project.pageFingerprint } } : { ok: false, error: 'network-error' } });
    try {
      await panel.open();
      expect(host.textContent).toContain('原始版本已核验');
      expect(host.querySelector('.clickdeck-collab-modal__message')?.textContent).toContain('网络请求失败');
      expect(host.querySelector<HTMLButtonElement>('[data-collab="manage"]')?.disabled).toBe(true);
    } finally { panel.destroy(); }
  });

  it('keeps keyboard focus on review controls while the automatic source check completes', async () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    let finishCheck!: (response: CollaborationResponse) => void;
    const pendingCheck = new Promise<CollaborationResponse>(resolve => { finishCheck = resolve; });
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(''), sourceVerification: true,
      getTasks: () => ({ ok: false, error: 'empty' }), onTeamPrompt: vi.fn(), request: async input => input.action === 'verify-source'
        ? pendingCheck : { ok: true, data: { configured: true } } });
    try {
      const opening = panel.open();
      await vi.waitFor(() => expect(host.textContent).toContain('正在自动检查原始文件'));
      host.querySelector<HTMLButtonElement>('[data-collab="current-page"]')!.focus();
      finishCheck({ ok: true, data: { fingerprint: snapshot.project.pageFingerprint } });
      await opening;
      expect(document.activeElement).toBe(host.querySelector('[data-collab="current-page"]'));
    } finally { panel.destroy(); }
  });

  it('keeps focus in the board after the retry button disappears on successful verification', async () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    let checks = 0;
    let finishCheck!: (response: CollaborationResponse) => void;
    const pendingCheck = new Promise<CollaborationResponse>(resolve => { finishCheck = resolve; });
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(''), sourceVerification: true,
      getTasks: () => ({ ok: false, error: 'empty' }), onTeamPrompt: vi.fn(), request: async input => {
        if (input.action !== 'verify-source') return { ok: true, data: { configured: true } };
        return ++checks === 1 ? { ok: false, error: 'source-fetch-failed' } : pendingCheck;
      } });
    try {
      await panel.open();
      const retry = host.querySelector<HTMLButtonElement>('[data-collab="verify-source"]')!;
      retry.focus(); retry.click();
      await vi.waitFor(() => expect(host.textContent).toContain('正在自动检查原始文件'));
      finishCheck({ ok: true, data: { fingerprint: snapshot.project.pageFingerprint } });
      await vi.waitFor(() => expect(host.querySelector('.clickdeck-collab-modal__busy')).toBeNull());
      expect(host.querySelector('[data-collab="verify-source"]')).toBeNull();
      expect(document.activeElement).toBe(host.querySelector('.clickdeck-collab-modal'));
    } finally { panel.destroy(); }
  });

  it("keeps a minimized project entry without deleting membership and refreshes when reopened", async () => {
    const host = document.createElement("div"); document.body.appendChild(host);
    const saved = { ["clickdeck:collaboration-page:v1:" + snapshot.project.pageFingerprint]: participation };
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => saved);
    let tasks = snapshot.submissions[0].tasks;
    const request = vi.fn(async (input: CollaborationRequest): Promise<CollaborationResponse> => input.action === "status"
      ? { ok: true, data: { configured: true } } : { ok: true, data: { participation, snapshot } });
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(snapshot.project.pageFingerprint), getTasks: () => ({ ok: true, tasks }), onTeamPrompt: vi.fn(), request });
    try {
      await panel.open();
      host.querySelector<HTMLButtonElement>('[data-collab="collapse"]')!.click();
      expect(host.classList.contains("clickdeck-panel--reviewing")).toBe(false);
      expect(host.querySelector('[data-collab-session]')).not.toBeNull();
      expect(host.querySelector('[data-session="submit"]')?.textContent).toContain("1");
      host.querySelector<HTMLButtonElement>('[data-session="submit"]')!.click();
      await vi.waitFor(() => expect(host.querySelector('[data-collab-scope="drafts"]')?.getAttribute("aria-pressed")).toBe("true"));
      await vi.waitFor(() => expect(host.querySelector('.clickdeck-collab-modal__busy')).toBeNull());
      expect(request.mock.calls.some(([input]) => input.action === "secure-window")).toBe(false);
      expect(host.querySelectorAll('[data-collab-review]')).toHaveLength(1);
      expect(host.querySelector('[data-collab-review]')?.classList.contains('is-draft')).toBe(true);
      expect(host.querySelector('[data-collab-select]')).toBeNull();
      expect(host.textContent).toContain("未选项仅留本机");
      expect(host.querySelectorAll('[data-collab-share]')).toHaveLength(1);
      expect(host.querySelector<HTMLInputElement>('[data-collab-share]')!.checked).toBe(false);
      host.querySelector<HTMLButtonElement>('[data-collab="close"]')!.click();
      expect(host.querySelector('[data-session="pause"]')?.getAttribute("title")).toContain("不退出项目");
      host.querySelector<HTMLButtonElement>('[data-session="pause"]')!.click();
      expect(host.querySelector<HTMLDivElement>('.clickdeck-collab-overlay')?.hidden).toBe(false);
      expect(host.querySelector('.clickdeck-collab-session.is-minimized')).not.toBeNull();
      expect(host.querySelector('[data-session="open"]')?.textContent).toContain(participation.projectTitle);
      expect(chrome.storage.local.remove).not.toHaveBeenCalled();
      await panel.open();
      expect(request.mock.calls.filter(([input]) => input.action === "read")).toHaveLength(3);
      expect(host.querySelector<HTMLDivElement>('.clickdeck-collab-overlay')?.hidden).toBe(false);
      host.querySelector<HTMLButtonElement>('[data-collab="close"]')!.click();
      tasks = []; panel.refreshDrafts();
      await vi.waitFor(() => expect(host.querySelector('[data-session="submit"]')?.textContent).toContain("0"));
      expect(host.querySelector<HTMLButtonElement>('[data-session="submit"]')?.disabled).toBe(false);
    } finally { panel.destroy(); }
    expect(host.querySelector('[data-collab-session]')).toBeNull();
  });

  it("marks cached suggestions uncertain after a failed reopen instead of implying no pending work", async () => {
    const host = document.createElement("div"); document.body.appendChild(host);
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({ ["clickdeck:collaboration-page:v1:" + snapshot.project.pageFingerprint]: participation }));
    let fail = false;
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(snapshot.project.pageFingerprint), getTasks: () => ({ ok: true, tasks: snapshot.submissions[0].tasks }), onTeamPrompt: vi.fn(), request: async input => input.action === "status" ? { ok: true, data: { configured: true } } : fail ? { ok: false, error: "network-error" } : { ok: true, data: { participation, snapshot } } });
    try {
      await panel.open(); host.querySelector<HTMLButtonElement>('[data-collab="close"]')!.click();
      fail = true; await panel.open(); host.querySelector<HTMLButtonElement>('[data-collab="close"]')!.click();
      expect(host.querySelector('[data-session="submit"]')?.textContent).toContain("待核对");
      expect(host.querySelector<HTMLButtonElement>('[data-session="submit"]')?.disabled).toBe(false);
      expect(host.querySelector('[data-collab-session]')?.textContent).toContain("网络请求失败");
      host.querySelector<HTMLButtonElement>('[data-session="submit"]')!.click();
      await vi.waitFor(() => expect(host.querySelector('[data-collab="submit-pending"]')).not.toBeNull());
      expect(host.querySelector<HTMLButtonElement>('[data-collab="submit-pending"]')?.disabled).toBe(true);
    } finally { panel.destroy(); }
  });

  it("keeps sharing choices separate from execution-prompt selection and invalidates changed values", async () => {
    const host = document.createElement("div"); document.body.appendChild(host);
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({ ["clickdeck:collaboration-page:v1:" + snapshot.project.pageFingerprint]: participation }));
    let tasks = [
      { ...snapshot.submissions[0].tasks[0], id: "font", kind: "style" as const, property: "fontSize", after: "40px" },
      { ...snapshot.submissions[0].tasks[0], id: "color", kind: "style" as const, property: "color", after: "#123456" }
    ];
    const request = vi.fn(async (input: CollaborationRequest): Promise<CollaborationResponse> => input.action === "status" ? { ok: true, data: { configured: true } } : { ok: true, data: { participation, snapshot } });
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(snapshot.project.pageFingerprint), getTasks: () => ({ ok: true, tasks }), onTeamPrompt: vi.fn(), request });
    try {
      await panel.open();
      host.querySelector<HTMLButtonElement>('[data-collab-scope="drafts"]')!.click();
      expect(host.querySelectorAll('[data-collab-share]')).toHaveLength(2);
      expect(host.querySelectorAll('[data-collab-share]:checked')).toHaveLength(0);
      expect(host.querySelector<HTMLButtonElement>('[data-collab="submit-pending"]')!.disabled).toBe(true);
      host.querySelector<HTMLButtonElement>('[data-collab="share-all"]')!.click();
      expect(host.querySelectorAll('[data-collab-share]:checked')).toHaveLength(2);
      host.querySelector<HTMLButtonElement>('[data-collab="share-all"]')!.click();
      expect(host.querySelectorAll('[data-collab-share]:checked')).toHaveLength(0);
      const first = host.querySelector<HTMLInputElement>('[data-collab-share]')!;
      first.checked = true; first.dispatchEvent(new Event('change'));
      expect(host.querySelector('[data-collab-sharing-count]')!.textContent).toContain('已选 1 / 2');
      expect(host.querySelectorAll('[data-collab-select]')).toHaveLength(0);
      tasks = [{ ...tasks[0], after: "55px" }, tasks[1]]; panel.refreshDrafts();
      await vi.waitFor(() => expect(host.querySelectorAll('[data-collab-share]:checked')).toHaveLength(0));
      expect(tasks.map(task=>task.after)).toEqual(['55px','#123456']);
      expect(request.mock.calls.some(([input])=>input.action==='secure-window' || input.action==='submit')).toBe(false);
      host.querySelector<HTMLButtonElement>('[data-collab-scope="team"]')!.click();
      expect(host.querySelector<HTMLInputElement>('[data-collab-select]')!.checked).toBe(true);
      expect(host.querySelector('[data-collab-select]')!.getAttribute('aria-label')).toContain('纳入执行 Prompt');
    } finally { panel.destroy(); }
  });

  it("groups each local project into a named view action and separate metadata/removal row", async () => {
    const host = document.createElement("div"); document.body.appendChild(host);
    const entries = {
      ["clickdeck:collaboration-page:v1:" + snapshot.project.pageFingerprint]: { ...participation, projectTitle: "同名项目" },
      ["clickdeck:collaboration-page:v1:" + "f".repeat(64)]: { ...participation, projectId: "other", projectTitle: "同名项目", expiresAt: 1 }
    };
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => entries);
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(snapshot.project.pageFingerprint), getTasks: () => ({ ok: false, error: "empty" }), onTeamPrompt: vi.fn(), request: async input => input.action === "status" ? { ok: true, data: { configured: true } } : { ok: true, data: { participation, snapshot } } });
    try {
      await panel.open(); host.querySelector<HTMLButtonElement>('[data-collab="projects"]')!.click();
      await vi.waitFor(() => expect(host.querySelectorAll('.clickdeck-collab-history-row')).toHaveLength(2));
      expect(host.querySelectorAll('.clickdeck-collab-history-match.is-match')).toHaveLength(1);
      expect(host.querySelector('[data-collab-history-list]')?.tagName).toBe("SECTION");
      for (const row of host.querySelectorAll('.clickdeck-collab-history-row')) {
        expect(row.querySelector('.clickdeck-collab-history-open .clickdeck-collab-history-name')?.textContent).toBe("同名项目");
        expect(row.querySelector('.clickdeck-collab-history-meta [data-collab-remove-history]')).not.toBeNull();
      }
      expect(host.innerHTML).not.toContain(participation.inviteCode);
    } finally { panel.destroy(); }
  });

  it("disables project actions when the build has no collaboration configuration", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const panel = createCollaborationPanel({
      host,
      pageFingerprint: Promise.resolve(snapshot.project.pageFingerprint),
      getTasks: () => ({ ok: false, error: "empty" }),
      onTeamPrompt: vi.fn(),
      request: vi.fn(async (): Promise<CollaborationResponse> => ({ ok: true, data: { configured: false } }))
    });

    await panel.open();

    expect(host.textContent).toContain("当前构建没有协作连接配置");
    expect(host.querySelector<HTMLButtonElement>("[data-collab='manage']")?.disabled).toBe(true);
  });

  it("rejects simulated page clicks and exposes no create or join form", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const request = vi.fn(async (input: CollaborationRequest): Promise<CollaborationResponse> => input.action === "status"
      ? { ok: true, data: { configured: true } }
      : { ok: false, error: "network-error" });
    const panel = createCollaborationPanel({
      host,
      pageFingerprint: Promise.resolve(snapshot.project.pageFingerprint),
      getTasks: () => ({ ok: false, error: "empty" }),
      onTeamPrompt: vi.fn(),
      request
    });
    await panel.open();

    host.querySelector<HTMLButtonElement>("[data-collab='manage']")!.click();
    await Promise.resolve();
    expect(request.mock.calls.map(([r]) => r.action)).toEqual(["status"]);
    expect(host.querySelector("form")).toBeNull();
    panel.destroy();
  });

  it("shows a locatable shared review board without exposing its invitation to the page", async () => {
    const heading = document.createElement("h1");
    heading.id = "review-heading";
    heading.textContent = "把城市走慢一点";
    heading.getBoundingClientRect = () => ({ x: 20, y: 30, left: 20, top: 30, right: 220, bottom: 90, width: 200, height: 60, toJSON: () => ({}) });
    document.body.appendChild(heading);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const storageGet = vi.mocked(chrome.storage.local.get);
    storageGet.mockImplementation(async (key) => ({ [String(key)]: participation }));
    const request = vi.fn(async (input: CollaborationRequest): Promise<CollaborationResponse> => {
      if (input.action === "status") return { ok: true, data: { configured: true } };
      return { ok: true, data: { participation, snapshot } };
    });
    const panel = createCollaborationPanel({
      host,
      pageFingerprint: Promise.resolve(snapshot.project.pageFingerprint),
      getTasks: () => ({ ok: false, error: "empty" }),
      onTeamPrompt: vi.fn(),
      request
    });

    await panel.open();

    expect(host.textContent).toContain("小宁");
    expect(host.textContent).toContain("审阅者 B");
    expect(host.textContent).toContain("团队提案");
    expect(host.textContent).toContain("h1.title · 文字 → 慢慢看城市");
    expect(host.textContent).toContain("当前视野可见");
    expect(host.querySelectorAll("[data-collab-review]")).toHaveLength(1);
    const summary = host.querySelector("[data-collab-expand]")!;
    expect(summary.parentElement?.querySelector(".clickdeck-collab-author")?.textContent).toBe("审阅者 B");
    expect(summary.parentElement?.querySelector("[data-collab-select]")).not.toBeNull();
    expect(host.querySelector(".clickdeck-collab-review-context .clickdeck-collab-location")).not.toBeNull();
    expect(host.querySelector("[data-collab-item-detail] .clickdeck-collab-target-short")).not.toBeNull();
    expect(host.querySelector(".clickdeck-collab-list-toolbar [data-collab-markers]")).not.toBeNull();
    expect(host.querySelector("[data-collab-details] .clickdeck-collab-fineprint")).not.toBeNull();
    expect(host.querySelector<HTMLElement>("[data-collab-item-detail]")?.hidden).toBe(true);
    host.querySelector<HTMLButtonElement>("[data-collab-expand]")!.click();
    expect(host.querySelector<HTMLElement>("[data-collab-item-detail]")?.hidden).toBe(false);
    host.querySelector<HTMLButtonElement>("[data-collab-expand]")!.click();
    expect(host.querySelector<HTMLElement>("[data-collab-item-detail]")?.hidden).toBe(true);
    expect(host.querySelectorAll("[data-collab-marker]")).toHaveLength(1);
    expect(host.querySelector(".clickdeck-collab-page-marker__label")?.textContent).toBe("审阅者 B");
    expect(host.textContent).toContain("当前文件校验码");
    heading.getBoundingClientRect = () => ({ x: 20, y: -100, left: 20, top: -100, right: 220, bottom: -40, width: 200, height: 60, toJSON: () => ({}) });
    window.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => expect(host.querySelectorAll("[data-collab-marker]")).toHaveLength(0));
    expect(host.textContent).toContain("不在当前视野或 deck");
    heading.getBoundingClientRect = () => ({ x: 20, y: 30, left: 20, top: 30, right: 220, bottom: 90, width: 200, height: 60, toJSON: () => ({}) });
    window.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => expect(host.querySelectorAll("[data-collab-marker]")).toHaveLength(1));
    heading.hidden = true;
    await vi.waitFor(() => expect(host.querySelectorAll("[data-collab-marker]")).toHaveLength(0));
    heading.hidden = false;
    await vi.waitFor(() => expect(host.querySelectorAll("[data-collab-marker]")).toHaveLength(1));
    host.querySelector<HTMLButtonElement>("[data-collab-review]")?.click();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(host.innerHTML).not.toContain(participation.inviteCode);
    expect(host.querySelector("[data-collab='copy-instructions']")).toBeNull();
    host.querySelector<HTMLButtonElement>("[data-collab='submit']")!.click();
    expect(request.mock.calls.some(([r]) => r.action === "submit" || r.action === "secure-window")).toBe(false);
    host.querySelector<HTMLButtonElement>("[data-collab='close']")?.click();
    expect(host.querySelector<HTMLElement>(".clickdeck-collab-overlay")!.hidden).toBe(false);
    expect(host.querySelector('[data-collab-session]')).not.toBeNull();
    expect(host.querySelector("[data-collab-marker]")).toBeNull();
  });

  it("shows the same team suggestions to an invited member", async () => {
    const memberParticipation: CollaborationParticipation = { ...participation, memberId: "member-reviewer", role: "member", inviteCode: undefined };
    const host = document.createElement("div");
    document.body.appendChild(host);
    vi.mocked(chrome.storage.local.get).mockImplementation(async (key) => ({ [String(key)]: memberParticipation }));
    const request = vi.fn(async (input: CollaborationRequest): Promise<CollaborationResponse> => input.action === "status"
      ? { ok: true, data: { configured: true } }
      : { ok: true, data: { participation: memberParticipation, snapshot } });
    const panel = createCollaborationPanel({
      host,
      pageFingerprint: Promise.resolve(snapshot.project.pageFingerprint),
      getTasks: () => ({ ok: false, error: "empty" }),
      onTeamPrompt: vi.fn(),
      request
    });

    await panel.open();

    expect(host.textContent).toContain("团队提案");
    expect(host.textContent).toContain("审阅者 B");
    expect(host.textContent).toContain("h1.title · 文字 → 慢慢看城市");
    expect(host.querySelector("[data-collab='team-prompt']")).toBeNull();
    panel.destroy();
  });

  it("switches review and inline prompt, retaining selection and returning to editing", async () => {
    const host = document.createElement("div"); document.body.appendChild(host);
    vi.mocked(chrome.storage.local.get).mockImplementation(async key => ({ [String(key)]: participation }));
    const request = vi.fn(async (input: CollaborationRequest): Promise<CollaborationResponse> => input.action === "status"
      ? { ok: true, data: { configured: true } } : { ok: true, data: { participation, snapshot } });
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(snapshot.project.pageFingerprint), getTasks: () => ({ ok: false, error: "empty" }), onTeamPrompt: () => {
      const prompt = document.createElement("div"); prompt.className = "clickdeck-prompt-overlay"; host.appendChild(prompt);
    }, request });
    await panel.open();
    const overlay = host.querySelector<HTMLElement>(".clickdeck-collab-overlay")!;
    host.querySelector<HTMLButtonElement>("[data-collab='dock']")!.click();
    expect(overlay.classList.contains("clickdeck-collab-overlay--left")).toBe(true);
    host.querySelector<HTMLButtonElement>("[data-collab='collapse']")!.click();
    expect(overlay.classList.contains("clickdeck-collab-overlay--editing")).toBe(true);
    expect(host.classList.contains("clickdeck-panel--reviewing")).toBe(false);
    await panel.open();
    host.querySelector<HTMLButtonElement>("[data-collab='team-prompt']")!.click();
    expect(overlay.classList.contains("clickdeck-collab-overlay--prompt")).toBe(true);
    expect(host.querySelector(".clickdeck-collab-modal .clickdeck-prompt-overlay")).not.toBeNull();
    expect(host.querySelector(".clickdeck-collab-marker-layer")).toBeNull();
    window.dispatchEvent(new Event("scroll"));
    expect(host.querySelector(".clickdeck-collab-marker-layer")).toBeNull();
    host.querySelector(".clickdeck-prompt-overlay")!.remove();
    await vi.waitFor(() => expect(overlay.classList.contains("clickdeck-collab-overlay--prompt")).toBe(false));
    expect(overlay.classList.contains("clickdeck-collab-overlay--left")).toBe(true);
    expect(host.textContent).toContain("慢慢看城市");
    host.querySelector<HTMLButtonElement>("[data-collab='close']")!.click();
    expect(overlay.hidden).toBe(false);
    expect(host.querySelector('[data-collab-session]')).not.toBeNull();
    expect(host.classList.contains("clickdeck-panel--reviewing")).toBe(false);
    await panel.open();
    expect(overlay.hidden).toBe(false);
    expect(host.classList.contains("clickdeck-panel--reviewing")).toBe(true);
    expect(host.querySelector<HTMLInputElement>("[data-collab-select]")!.checked).toBe(true);
    panel.destroy();
  });

  it("groups suggestions for one element and filters by current member", async () => {
    const groupedSnapshot = structuredClone(snapshot);
    groupedSnapshot.submissions.push({
      version: 1,
      id: "submission-owner",
      projectId: "project-1",
      memberId: "member-owner",
      memberDisplayName: "小宁",
      pageFingerprint: snapshot.project.pageFingerprint,
      submittedAt: Date.UTC(2026, 8, 22, 10),
      tasks: [{ ...structuredClone(snapshot.submissions[0].tasks[0]), id: "task-owner", kind: "style", property: "fontSize", before: "48px", after: "56px" }]
    });
    const heading = document.createElement("h1");
    heading.id = "review-heading";
    heading.getBoundingClientRect = () => ({ x: 20, y: 30, left: 20, top: 30, right: 220, bottom: 90, width: 200, height: 60, toJSON: () => ({}) });
    document.body.appendChild(heading);
    const host = document.createElement("div");
    document.body.appendChild(host);
    vi.mocked(chrome.storage.local.get).mockImplementation(async (key) => ({ [String(key)]: participation }));
    const request = vi.fn(async (input: CollaborationRequest): Promise<CollaborationResponse> => input.action === "status"
      ? { ok: true, data: { configured: true } }
      : { ok: true, data: { participation, snapshot: groupedSnapshot } });
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(snapshot.project.pageFingerprint), getTasks: () => ({ ok: false, error: "empty" }), onTeamPrompt: vi.fn(), request });

    await panel.open();

    expect(host.querySelectorAll("[data-collab-review]")).toHaveLength(2);
    expect(host.querySelector("[data-collab-marker]")?.textContent).not.toContain("+2");
    const showAll = host.querySelector<HTMLInputElement>("[data-collab-markers]")!;
    showAll.checked = true; showAll.dispatchEvent(new Event("change"));
    expect(host.querySelectorAll("[data-collab-marker]")).toHaveLength(1);
    expect(host.querySelector("[data-collab-marker]")?.textContent).toContain("+2");
    expect(host.querySelector("[data-collab-marker]")?.textContent).toContain("审阅者 B");
    expect(host.querySelector("[data-collab-marker]")?.textContent).toContain("小宁");
    host.querySelector<HTMLButtonElement>("[data-collab-review-filter='mine']")?.click();
    const cards = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-collab-review]"));
    expect(cards.filter((card) => !card.hidden)).toHaveLength(1);
    expect(cards.find((card) => !card.hidden)?.textContent).toContain("小宁");
    panel.destroy();
  });

  it("keeps the last snapshot visible and labels it stale after refresh fails", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    vi.mocked(chrome.storage.local.get).mockImplementation(async (key) => ({ [String(key)]: participation }));
    let reads = 0;
    const request = vi.fn(async (input: CollaborationRequest): Promise<CollaborationResponse> => {
      if (input.action === "status") return { ok: true, data: { configured: true } };
      reads += 1;
      return reads === 1 ? { ok: true, data: { participation, snapshot } } : { ok: false, error: "network-error" };
    });
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(snapshot.project.pageFingerprint), getTasks: () => ({ ok: false, error: "empty" }), onTeamPrompt: vi.fn(), request });

    await panel.open();
    host.querySelector<HTMLButtonElement>("[data-collab='refresh']")?.click();

    await vi.waitFor(() => expect(host.textContent).toContain("以下为上次成功同步的内容"));
    expect(host.textContent).toContain("慢慢看城市");
    panel.destroy();
  });

  it("exports only selected suggestions and blocks contradictory selections without deleting sources", async () => {
    const conflicting = structuredClone(snapshot);
    conflicting.submissions.push({ ...structuredClone(snapshot.submissions[0]), id: "s2", memberId: "member-owner", memberDisplayName: "Owner", tasks: [{ ...structuredClone(snapshot.submissions[0].tasks[0]), id: "t2", after: "另一标题" }] });
    const host = document.createElement("div"); document.body.appendChild(host);
    vi.mocked(chrome.storage.local.get).mockImplementation(async key => ({ [String(key)]: participation }));
    const onTeamPrompt = vi.fn();
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(snapshot.project.pageFingerprint), getTasks: () => ({ ok: false, error: "empty" }), onTeamPrompt, request: async input => input.action === "status" ? { ok: true, data: { configured: true } } : { ok: true, data: { participation, snapshot: conflicting } } });
    await panel.open();
    expect(host.querySelector<HTMLButtonElement>("[data-collab='team-prompt']")!.disabled).toBe(true);
    const select = (index: number) => { const input = host.querySelectorAll<HTMLInputElement>("[data-collab-select]")[index]; input.checked = true; input.dispatchEvent(new Event("change")); };
    select(0); select(1);
    host.querySelector<HTMLButtonElement>("[data-collab='team-prompt']")!.click();
    expect(onTeamPrompt).not.toHaveBeenCalled();
    expect(host.textContent).toContain("请取消其中一种");
    const second = host.querySelectorAll<HTMLInputElement>("[data-collab-select]")[1]; second.checked = false; second.dispatchEvent(new Event("change"));
    host.querySelector<HTMLButtonElement>("[data-collab='team-prompt']")!.click();
    expect(onTeamPrompt).toHaveBeenCalledTimes(1);
    expect(onTeamPrompt.mock.calls[0][0].submissions).toHaveLength(1);
    expect(conflicting.submissions).toHaveLength(2);
    panel.destroy();
  });

  it("preserves the association when the server cannot read the project", async () => {
    const host = document.createElement("div"); document.body.appendChild(host);
    vi.mocked(chrome.storage.local.get).mockImplementation(async key => ({ [String(key)]: participation }));
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(snapshot.project.pageFingerprint), getTasks: () => ({ ok: false, error: "empty" }), onTeamPrompt: vi.fn(), request: async input => input.action === "status" ? { ok: true, data: { configured: true } } : { ok: false, error: "project-not-found" } });
    await panel.open();
    expect(host.textContent).toContain("封面复核");
    expect(host.textContent).toContain("原项目关联已保留");
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
    panel.destroy();
  });

  it("keeps mismatched address records in history without opening or reading the project", async () => {
    const host = document.createElement("div"); document.body.appendChild(host);
    vi.mocked(chrome.storage.local.get).mockImplementation(async key => String(key).startsWith("clickdeck:collaboration-url:")
      ? { [String(key)]: { participation, fingerprint: snapshot.project.pageFingerprint } } : {});
    const request = vi.fn(async (input: CollaborationRequest): Promise<CollaborationResponse> => input.action === "status" ? { ok: true, data: { configured: true } } : { ok: true, data: { participation, snapshot } });
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve("f".repeat(64)), getTasks: () => ({ ok: false, error: "empty" }), onTeamPrompt: vi.fn(), request });
    await panel.open();
    expect(host.textContent).toContain("未自动打开");
    expect(host.querySelector(".clickdeck-collab-entry-status")).not.toBeNull();
    expect(host.querySelector("[data-collab='projects']")).not.toBeNull();
    expect(host.querySelector("[data-collab='unlink']")).not.toBeNull();
    expect(host.querySelector("[data-collab='submit']")).toBeNull();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(request.mock.calls.map(([input]) => input.action)).toEqual(["status"]);
    expect(host.querySelector("[data-collab-marker]")).toBeNull();
    panel.destroy();
  });

  it("allows server-checked updates at capacity without claiming new slots are free", async () => {
    const fullSnapshot = structuredClone(snapshot);
    fullSnapshot.rawTaskCount = 100;
    fullSnapshot.invalidTaskCount = 1;
    fullSnapshot.submissions[0].tasks = Array.from({ length: 99 }, (_, index) => ({
      id: `intent-${index}`,
      sequence: index,
      kind: "intent" as const,
      summary: `Suggestion ${index + 1}`
    }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    vi.mocked(chrome.storage.local.get).mockImplementation(async (key) => ({ [String(key)]: participation }));
    const request = vi.fn(async (input: CollaborationRequest): Promise<CollaborationResponse> => input.action === "status"
      ? { ok: true, data: { configured: true } }
      : { ok: true, data: { participation, snapshot: fullSnapshot } });
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(snapshot.project.pageFingerprint), getTasks: () => ({ ok: false, error: "empty" }), onTeamPrompt: vi.fn(), request });

    await panel.open();

    expect(host.textContent).toContain("100/100 条原始任务");
    expect(host.querySelector('[data-collab-scope="team"]')?.getAttribute('title')).toBe("99 条最终建议");
    expect(host.querySelectorAll("[data-collab-review]")).toHaveLength(99);
    expect(host.textContent).toContain("异常记录仍占用容量");
    expect(host.textContent).toContain("可更新已有建议");
    expect(host.querySelector<HTMLButtonElement>("[data-collab='submit']")?.disabled).toBe(false);
    panel.destroy();
  });

  it("adds the six-hour reminder without minute-by-minute panel replacement", async () => {
    vi.useFakeTimers();
    const expiresAt = Date.now() + 6 * 3600_000 + 1000;
    const saved = { ...participation, expiresAt };
    const host = document.createElement("div"); document.body.appendChild(host);
    vi.mocked(chrome.storage.local.get).mockImplementation(async key => ({ [String(key)]: saved }));
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(snapshot.project.pageFingerprint), getTasks: () => ({ ok: false, error: "empty" }), onTeamPrompt: vi.fn(), request: async input => input.action === "status" ? { ok: true, data: { configured: true } } : { ok: true, data: { participation: saved, snapshot: { ...snapshot, project: { ...snapshot.project, expiresAt } } } } });
    try {
      await panel.open();
      expect(host.textContent).not.toContain("项目即将到期");
      await vi.advanceTimersByTimeAsync(1010);
      expect(host.textContent).toContain("项目即将到期");
      const board = host.querySelector('.clickdeck-collab-modal');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(host.querySelector('.clickdeck-collab-modal')).toBe(board);
    } finally { panel.destroy(); vi.useRealTimers(); }
  });

  it("changes an open project to expired without requiring a click and offers a restart", async () => {
    vi.useFakeTimers();
    const expiresAt = Date.now() + 1000;
    const saved = { ...participation, expiresAt };
    const host = document.createElement("div"); document.body.appendChild(host);
    vi.mocked(chrome.storage.local.get).mockImplementation(async key => ({ [String(key)]: saved }));
    const panel = createCollaborationPanel({ host, pageFingerprint: Promise.resolve(snapshot.project.pageFingerprint), getTasks: () => ({ ok: false, error: "empty" }), onTeamPrompt: vi.fn(), request: async input => input.action === "status" ? { ok: true, data: { configured: true } } : { ok: true, data: { participation: saved, snapshot: { ...snapshot, project: { ...snapshot.project, expiresAt } } } } });
    try {
      await panel.open();
      expect(host.querySelector("[data-collab='submit']")).not.toBeNull();
      expect(host.textContent).toContain("项目即将到期");
      host.querySelector<HTMLButtonElement>("[data-collab='backup']")!.click();
      expect(downloadCollaborationBackup).toHaveBeenLastCalledWith(expect.objectContaining({ submissions: snapshot.submissions }), expect.any(Number), false);
      await vi.advanceTimersByTimeAsync(1010);
      expect(host.textContent).toContain("项目已过期");
      expect(host.querySelector("[data-collab='submit']")).toBeNull();
      expect(host.querySelector("[data-collab='manage']")).not.toBeNull();
      host.querySelector<HTMLButtonElement>("[data-collab='backup']")!.click();
      expect(downloadCollaborationBackup).toHaveBeenLastCalledWith(expect.objectContaining({ submissions: snapshot.submissions }), expect.any(Number), true);
    } finally { panel.destroy(); vi.useRealTimers(); }
  });
});
