import type { SharedProjectSnapshot, SharedTask } from "../shared/collaboration-contract";
import {
  CLICKDECK_COLLABORATION_REQUEST,
  type CollaborationParticipation,
  type CollaborationRequest,
  type CollaborationResponse
} from "../shared/messages";
import {
  buildCollaborationReviewItems,
  reviewLocation,
  reviewChangeSummary,
  canScrollReviewTarget,
  getVisibleCollaborationReviewTarget,
  resolveCollaborationReviewTarget,
  reviewTasksConflict,
  selectedReviewSnapshot,
  type CollaborationReviewItem
} from "./collaboration-review";
import { getPanelLanguage } from "./i18n";
import { isParticipation, pageAssociationKey } from "../shared/collaboration-association";
import { startReviewPreview, type ReviewPreview } from "./collaboration-preview";
import { buildLocalDraftItems, isLocalAdjustment, proposalLocationKey } from "./collaboration-drafts";
import { downloadCollaborationBackup } from "./collaboration-backup";
import { CollaborationSharingSelection } from "./collaboration-sharing";

const STORAGE_PREFIX = "clickdeck:collaboration-page:v1:";

type CollaborationPanelOptions = {
  host: HTMLElement;
  pageFingerprint: Promise<string>;
  sourceVerification?: boolean;
  onSourceVerified?: (fingerprint: string) => void;
  getTasks: (participation: CollaborationParticipation) => { ok: true; tasks: SharedTask[] } | { ok: false; error: string };
  onTeamPrompt: (snapshot: SharedProjectSnapshot) => void;
  onEditIntent?: (id: string) => void;
  onAnnotationsChange?: (active: boolean) => void;
  request?: (request: CollaborationRequest) => Promise<CollaborationResponse>;
};

const errorMessages: Record<string, { zh: string; en: string }> = {
  'source-url-missing': { zh: '浏览器未提供当前标签页地址（核验步骤1）。请通过浏览器工具栏的ClickDeck图标重新打开。', en: 'The browser did not provide the tab URL. Reopen using the toolbar icon.' },
  'source-permission-check-failed': { zh: '无法查询本地文件访问权限（核验步骤2）。请重新加载扩展后刷新原页面。', en: 'Could not check file access permission.' },
  'source-fetch-failed': { zh: '浏览器未能读取原文件（核验步骤3）。请检查原文件仍在原位置，以及扩展的“允许访问文件网址”开关。', en: 'The browser could not fetch the source file. Check its location and extension file access.' },
  'source-stream-failed': { zh: '原文件读取中断（核验步骤4）。请重新核验。', en: 'Reading the source was interrupted. Verify again.' },
  'source-hash-failed': { zh: '原文件已读取，但校验码计算失败（核验步骤5）。请重新核验。', en: 'The source was read but fingerprint calculation failed.' },
  'source-file-permission': { zh: '浏览器未允许此扩展访问本地文件。请到扩展详情开启“允许访问文件网址”，刷新HTML后重新核验。', en: 'File access is disabled for this extension. Enable Allow access to file URLs, reload the HTML, and verify again.' },
  'source-too-large': { zh: '原始HTML超过当前64 MiB核验上限，无法创建或加入；这不是文件权限问题。', en: 'The source exceeds the current 64 MiB verification limit. This is not a file permission error.' },
  'source-invalid-encoding': { zh: '原文件不是有效UTF-8编码，暂无法核验。请保留原件，并使用UTF-8副本。', en: 'The source is not valid UTF-8. Keep the original and use a UTF-8 copy.' },
  'source-not-html': { zh: '未识别到完整HTML文档开头，可能是片段或文件开头较特殊；暂不能核验。', en: 'No HTML document start was recognized. A fragment or unusual header cannot currently be verified.' },
  'source-http-error': { zh: '原网页返回错误或空响应，无法核验。请检查页面是否需要登录或是否可正常访问。', en: 'The source request returned an error or empty response. Check page access.' },
  'source-timeout': { zh: '读取原文件超时，请稍后点击重新核验。', en: 'Source reading timed out. Verify again later.' },
  "service-disabled": { zh: "云端协作暂已关闭或访问被限制，离线编辑仍可使用。", en: "Cloud collaboration is disabled or access is restricted. Offline editing still works." },
  "source-unavailable": { zh: "原始HTML读取失败，原因尚未确定。请点击重新核验查看结果；本地编辑仍可用。", en: "The original HTML could not be read; the cause is not yet known. Verify again. Local editing remains available." },
  "source-changed": { zh: "原始HTML已变化，请刷新页面重新核验，不会自动关联旧项目。", en: "Original HTML changed. Reload to verify the new version." },
  "migration-required": { zh: "旧项目升级需要先部署文件识别迁移，原有建议仍保留。", en: "Deploy the source verification migration before upgrading. Suggestions are preserved." },
  "session-expired": { zh: "之前的协作连接已失效，本地修改仍保留。请打开创建/加入窗口，重试后按提示恢复使用，无需清除浏览器数据。", en: "Your previous session is unavailable. Local edits are preserved. Open the create/join window and retry to access recovery. Do not clear browser data." },
  "request-expired": { zh: "窗口已失效，请重新打开。", en: "The window expired. Open it again." },
  "not-configured": { zh: "此构建未配置私人协作服务。", en: "This build is not configured for private collaboration." },
  "invalid-invite": { zh: "邀请码无效，请重新复制完整邀请码。", en: "The invite code is invalid. Copy the complete code again." },
  "fingerprint-mismatch": { zh: "当前 HTML 与项目页面不一致，无法加入或提交。", en: "This HTML does not match the project page." },
  "project-expired": { zh: "项目已过期。请创建一个新项目。", en: "This project has expired. Create a new project." },
  "project-not-found": { zh: "当前身份读不到项目：可能已过期或没有访问权限。原项目关联已保留，请重试或在协作窗口核对身份。", en: "This identity cannot read the project. It may be expired or inaccessible. The saved association is preserved; retry or check your identity." },
  "member-not-found": { zh: "当前身份不是此项目成员，旧关联已保留。请核对身份或使用有效邀请码加入。", en: "This identity is not a member. The saved association is preserved. Check your identity or join with a valid invitation." },
  "member-limit": { zh: "项目已达到 6 人上限。", en: "This project has reached its 6-member limit." },
  "task-limit": { zh: "项目已达到 100 条任务上限。", en: "This project has reached its 100-task limit." },
  "empty": { zh: "当前没有可提交的修改或修改意见。", en: "There are no edits or suggestions to submit." },
  "required-fields": { zh: "请先填写所有必填项。", en: "Complete all required fields first." },
  "consent-required": { zh: "请先勾选同意项，再继续。", en: "Select the consent checkbox before continuing." },
  "invalid-input": { zh: "请求信息不完整，请重新填写。", en: "Incomplete request. Check your inputs." },
  "invalid-tasks": { zh: "建议数据格式异常，已停止读取或提交。", en: "Invalid suggestion data; reading or submission stopped." },
  "payload-limit": { zh: "本次建议内容过大，请减少后重试。", en: "Suggestion payload is too large." },
  "project-limit": { zh: "你已有 3 个有效项目，请等待旧项目到期。", en: "You already have 3 active projects." },
  "service-capacity": { zh: "当前协作项目名额已满，请稍后重试。本地编辑不受影响。", en: "Collaboration project slots are full. Try later; local editing is unaffected." },
  "rate-limit": { zh: "操作太频繁，请稍后重试。", en: "Too many requests. Try again shortly." },
  "network-error": { zh: "网络请求失败，请稍后重试。", en: "The network request failed. Try again later." }
};

type ReviewFilter = "all" | "viewport" | "conflict" | "mine";

function defaultRequest(request: CollaborationRequest): Promise<CollaborationResponse> {
  return chrome.runtime.sendMessage({ type: CLICKDECK_COLLABORATION_REQUEST, request });
}

function esc(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char);
}

function formatExpiry(value: number, locale: string): string {
  return value ? new Date(value).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
}

function shortFingerprint(value: string): string {
  return value ? `${value.slice(0, 6)}…${value.slice(-6)}` : "—";
}

export function createCollaborationPanel(options: CollaborationPanelOptions): { open: () => Promise<void>; refreshDrafts: () => void; destroy: () => void } {
  const zh = getPanelLanguage() === "zh";
  const locale = zh ? "zh-CN" : "en-US";
  const sendRequest = options.request ?? defaultRequest;
  let lastSourceDiagnostic = "";
  let sourceDiagnosticOpen = false;
  const request = async (input: CollaborationRequest): Promise<CollaborationResponse> => {
    const response = await sendRequest(input);
    if (!response.ok && typeof response.sourceDiagnostic === "string" && response.sourceDiagnostic.length > 0 && response.sourceDiagnostic.length <= 2000) {
      // Only the background's bounded, sanitized diagnostic is kept in this page closure.
      lastSourceDiagnostic = response.sourceDiagnostic;
    }
    return response;
  };
  let overlay: HTMLDivElement | null = null;
  let participation: CollaborationParticipation | null = null;
  let snapshot: SharedProjectSnapshot | null = null;
  let fingerprint = "";
  let sourceError = "";
  let checkingSource = false;
  let busy = false;
  let serviceConfigured = false;
  let message = "";
  let messageIsError = false;
  let reviewItems: CollaborationReviewItem[] = [];
  let activeReviewId = "";
  let expandedReviewId = "";
  let markerFrame = 0;
  let markerObserver: MutationObserver | null = null;
  let markerTracking = false;
  let markerLayout = "";
  let reviewFilter: ReviewFilter = "all";
  let visibleReviewIds = new Set<string>();
  let lastSyncedAt = 0;
  let snapshotStale = false;
  let collapsed = false;
  let dockLeft = false;
  let promptSuspended = false;
  let promptObserver: MutationObserver | null = null;
  let associatedFingerprint = "";
  let browsingHistory = false;
  let projectsView = false;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const projectExpired = (): boolean => Boolean(participation && participation.expiresAt <= Date.now());
  let unmatchedAddress: { fingerprint: string; participation: CollaborationParticipation } | null = null;
  let history: { fingerprint: string; participation: CollaborationParticipation }[] = [];
  const urlKey = pageAssociationKey(location.href);
  const fileMismatch = (): boolean => Boolean(participation && associatedFingerprint !== fingerprint);
  let selectionProject = "";
  let selectedReviews = new Set<string>();
  let preview: ReviewPreview | null = null;
  let previewId = "";
  let previewNote = "";
  let allMarkers = false;
  let detailsOpen = false;
  let scrollTop = 0;
  let floating: { x: number; y: number } | null = null;
  let reviewPlacement: { floating: { x: number; y: number } | null; left: boolean } | null = null;
  let stopDragging: (() => void) | null = null;
  let editing = false;
  let paused = false;
  let peekId = "";
  let draftFrame = 0;
  let reviewScope: "team" | "drafts" = "team";
  let draftItems: CollaborationReviewItem[] = [];
  let draftError = "";
  const sharing = new CollaborationSharingSelection();
  let localHintShown = false;
  let localHintTimer: ReturnType<typeof setTimeout> | undefined;
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  const currentCollaboration = (): boolean => Boolean(participation && !browsingHistory && !projectsView && !fileMismatch() && !projectExpired());
  const shownItems = (): CollaborationReviewItem[] => reviewScope === "drafts" && currentCollaboration() ? draftItems : reviewItems;
  const isDraft = (item: CollaborationReviewItem): boolean => item.id.startsWith("draft:");
  const typeLabel = (item: CollaborationReviewItem): string => isLocalAdjustment(item.task) ? t("页面调整", "Page adjustment") : t("修改意见", "Change request");
  const draftState = (): string => snapshotStale || !snapshot ? t("提交状态待核对", "Submission status unverified") : t("未提交团队", "Not submitted");

  function updateDraftItems(): void {
    draftItems = []; draftError = "";
    if (!currentCollaboration()) { sharing.sync("", []); return; }
    const prepared = options.getTasks(participation!);
    if (!prepared.ok) { if (prepared.error !== "empty") draftError = prepared.error; }
    else draftItems = buildLocalDraftItems(prepared.tasks, snapshot, participation!, fingerprint, zh ? "zh" : "en");
    sharing.sync(JSON.stringify([participation!.projectId, participation!.memberId, fingerprint]), draftItems);
  }

  function editIntent(item: CollaborationReviewItem): void {
    if (!isDraft(item) || isLocalAdjustment(item.task) || !options.onEditIntent) return;
    allMarkers = false;
    returnToEditing();
    options.onEditIntent(item.task.id);
  }

  function returnToEditing(): void {
    stopPreview(); previewNote = "";
    stopDragging?.();
    editing = true; peekId = ""; collapsed = false;
    if (browsingHistory || projectsView) {
      resetReview(); projectsView = false;
      void run(async () => { await loadParticipation(); await refresh(); });
    }
    if (overlay) overlay.hidden = !currentCollaboration();
    options.host.classList.remove("clickdeck-panel--reviewing", "clickdeck-panel--collapsed");
    render();
  }

  function renderLightweight(): void {
    overlay?.querySelector("[data-collab-session]")?.remove();
    if (!overlay || !editing || !currentCollaboration()) return;
    updateDraftItems();
    options.onAnnotationsChange?.(!paused);
    const count = draftError ? null : draftItems.length;
    const uncertain = snapshotStale || !snapshot;
    const item = paused ? undefined : shownItems().find(candidate => candidate.id === peekId);
    const session = document.createElement("div");
    session.dataset.collabSession = "true";
    session.className = `clickdeck-collab-session${paused ? " is-minimized" : ""}`;
    session.innerHTML = `${message ? `<p class="clickdeck-collab-session-status" role="status" data-tone="${messageIsError ? "error" : "info"}">${esc(message)}</p>` : ""}${item ? `<section class="clickdeck-collab-peek" aria-label="${t("团队建议详情", "Team suggestion")}">
      <div><strong>${isDraft(item) ? "D" : ""}${item.number}. ${esc(reviewChangeSummary(item))}</strong><span class="clickdeck-collab-author">${esc(item.contributor)}</span><button type="button" data-session="close-peek" aria-label="${t("关闭建议详情", "Close suggestion")}">×</button></div>
      <p>${typeLabel(item)} · ${isDraft(item) ? draftState() : t("已提交提案，未代表执行", "Submitted proposal, not proof of execution")}</p>
      <p title="${esc(item.description)}">${esc(reviewLocation(item, zh ? "zh" : "en", true))} · ${esc(item.task.locator?.textSnippet || item.targetLabel)}</p>
      <p>${isLocalAdjustment(item.task) ? `${t("记录原值", "Recorded before")}：${esc(item.task.before || t("未记录视觉原值", "Visual original not recorded"))} → ${esc(item.task.after ?? "")}` : `${t("仅记录意图，尚未执行", "Intent only, not executed")}：${esc(item.task.summary)}`}</p>
      <div>${!isDraft(item) ? `<button type="button" data-session="preview">${t("临时预览", "Temporary preview")}</button>` : !isLocalAdjustment(item.task) && options.onEditIntent ? `<button type="button" data-session="edit-intent">${t("编辑此意见", "Edit request")}</button>` : ""}${previewId ? `<button type="button" data-session="restore">${t("结束预览", "End preview")}</button>` : ""}<button type="button" data-session="open">${t("全部建议", "All suggestions")}</button></div>
      ${previewNote ? `<p role="status">${esc(item.contributor)} · ${esc(previewNote)}</p>` : ""}
    </section>` : ""}
      <div class="clickdeck-collab-capsule${paused ? " is-minimized" : ""}" role="group" aria-label="${t("本页协作", "Page collaboration")}">
        <button type="button" data-session="open" title="${esc(participation!.projectTitle)} · ${t("团队提案", "Team proposals")} ${reviewItems.length} · ${t("展开并刷新", "Open and refresh")}">${esc(participation!.projectTitle)}${uncertain ? " · !" : ""}</button>
        <button type="button" data-session="submit" ${busy ? "disabled" : ""}>${t("我的待提交", "My pending")} ${uncertain || count === null ? t("待核对", "Check") : count}</button>
        ${!paused ? `<button type="button" data-session="pins" aria-pressed="${allMarkers}" title="${reviewScope === "drafts" ? t("我的待提交位置（虚线）", "My pending locations (dashed)") : t("团队提案位置（实线）", "Team proposal locations (solid)")}">${reviewScope === "drafts" ? t("草稿标记", "Draft pins") : t("编号", "Pins")}</button>
        <button type="button" data-session="pause" aria-label="${t("收起为项目入口", "Minimize to project entry")}" title="${t("收起界面，不退出项目；修改仍先留在本机", "Minimize only; edits stay local until explicitly submitted")}">−</button>` : ""}
      </div>`;
    if (typeof count === "number" && count > 0 && !localHintShown) {
      localHintShown = true;
      const hint = document.createElement("p"); hint.dataset.collabLocalHint = "true";
      hint.className = "clickdeck-collab-session-status"; hint.setAttribute("role", "status");
      hint.textContent = t("仅保存在本机，选择并提交后团队可见。", "Local only. Select and submit changes to share them.");
      session.appendChild(hint);
      localHintTimer = setTimeout(() => hint.remove(), 6000);
    }
    // Keep page/editor capture handlers from treating these controls as edits.
    overlay.appendChild(session);
    session.querySelectorAll<HTMLElement>('[data-session="open"]').forEach(button => button.addEventListener("click", () => { void openPanel(); }));
    session.querySelector('[data-session="submit"]')?.addEventListener("click", () => { void openPanel("drafts"); });
    session.querySelector('[data-session="edit-intent"]')?.addEventListener("click", () => { if (item) editIntent(item); });
    session.querySelector('[data-session="pins"]')?.addEventListener("click", () => { allMarkers = !allMarkers; renderLightweight(); positionReviewMarkers(); });
    session.querySelector('[data-session="pause"]')?.addEventListener("click", () => {
      paused = true; peekId = ""; stopPreview(); stopMarkerTracking(); removeMarkerLayer();
      options.onAnnotationsChange?.(false);
      renderLightweight();
    });
    session.querySelector('[data-session="close-peek"]')?.addEventListener("click", () => { stopPreview(); previewNote = ""; peekId = ""; renderLightweight(); });
    session.querySelector('[data-session="preview"]')?.addEventListener("click", event => { if (event.isTrusted && item) showReviewPreview(item); });
    session.querySelector('[data-session="restore"]')?.addEventListener("click", () => { stopPreview(); previewNote = ""; renderLightweight(); });
  }

  function refreshDrafts(): void {
    cancelAnimationFrame(draftFrame);
    draftFrame = requestAnimationFrame(() => {
      if (editing) { renderLightweight(); positionReviewMarkers(); }
      else if (reviewScope === "drafts" && !promptSuspended) render();
    });
  }

  function placeBoard(): void {
    const board = overlay?.querySelector<HTMLElement>(".clickdeck-collab-modal");
    if (!board) return;
    if (floating) {
      const availableWidth = document.documentElement.clientWidth || window.innerWidth;
      floating.x = Math.max(0, Math.min(floating.x, availableWidth - board.offsetWidth));
      floating.y = Math.max(0, Math.min(floating.y, window.innerHeight - board.offsetHeight));
      board.style.position = "fixed";
      board.style.left = `${floating.x}px`; board.style.top = `${floating.y}px`;
    } else { board.style.position = ""; board.style.left = ""; board.style.top = ""; }
  }

  function bindDragging(): void {
    overlay?.querySelector<HTMLElement>(".clickdeck-collab-modal")?.addEventListener("pointerdown", event => {
      if (event.button !== 0 || !(event.target as Element).closest(".clickdeck-collab-modal__header, .clickdeck-prompt-modal__header") || (event.target as Element).closest("button, input, a")) return;
      const board = overlay!.querySelector<HTMLElement>(".clickdeck-collab-modal")!;
      const rect = board.getBoundingClientRect();
      const dx = event.clientX - rect.left, dy = event.clientY - rect.top;
      const move = (next: PointerEvent) => { floating = { x: next.clientX - dx, y: next.clientY - dy }; placeBoard(); };
      const finish = () => {
        stopDragging?.();
        if (floating && (floating.x < 32 || floating.x + board.offsetWidth > window.innerWidth - 32)) {
          dockLeft = floating.x < 32; floating = null;
          overlay?.classList.toggle("clickdeck-collab-overlay--left", dockLeft); placeBoard();
        }
      };
      stopDragging?.();
      stopDragging = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); stopDragging = null; };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", finish);
      event.preventDefault();
    });
  }

  function stopPreview(): void {
    preview?.restore(); preview = null; previewId = "";
    overlay?.querySelector("[data-collab-preview-note]")?.remove();
    document.removeEventListener("pointerdown", beforePageAction, true);
    document.removeEventListener("keydown", beforePageAction, true);
    document.removeEventListener("clickdeck:before-edit", beforePageAction);
    window.removeEventListener("pagehide", stopPreview);
  }
  function beforePageAction(event: Event): void {
    if (event.type === "pointerdown" && event.target instanceof Element && overlay?.contains(event.target)) return;
    stopPreview(); previewNote = ""; render();
  }

  function showReviewPreview(item: CollaborationReviewItem): void {
    if (isDraft(item)) return;
    stopPreview();
    activeReviewId = item.id;
    expandedReviewId = item.id;
    if (fileMismatch()) {
      previewNote = t("文件校验不同，仅显示建议说明，不修改页面。", "Different file fingerprint: explanation only.");
    } else {
      preview = startReviewPreview(item);
      previewNote = preview
        ? t("临时预览中：没有保存为修改。点击还原、关闭面板或操作网页时自动还原。", "Temporary preview, not a saved edit. Restore, close the panel, or interact with the page to revert.")
        : item.task.kind === "move" ? t("移动仅作 A → B 示意，不移动原网页；最终位置由原布局和目标说明共同确定。", "Move is an A → B diagram only; the original layout and target evidence determine placement.")
        : item.task.kind === "remove" ? t("删除仅作划除示意，不删除网页元素。", "Deletion is a strike-through diagram only; no element is deleted.")
        : item.task.kind === "attribute" ? t("图片替换只展示说明，不加载协作者提供的图片地址。", "Image replacement is explanation only; collaborator image URLs are not loaded.")
        : t("仅展示说明：此建议无法安全预览（可能定位不唯一、文字已变化、含复杂结构或样式不在支持范围）。", "Explanation only: this suggestion cannot be safely previewed (ambiguous target, changed text, complex content, or unsupported style).");
      if (preview) {
        previewId = item.id;
        document.addEventListener("pointerdown", beforePageAction, true);
        document.addEventListener("keydown", beforePageAction, true);
        document.addEventListener("clickdeck:before-edit", beforePageAction);
        window.addEventListener("pagehide", stopPreview);
      }
    }
    render();
  }

  const t = (cn: string, en: string): string => zh ? cn : en;
  const storageKey = (): string => `${STORAGE_PREFIX}${fingerprint}`;

  function renderMembers(): string {
    if (!snapshot) return "";
    return `<section class="clickdeck-collab-section">
      <div class="clickdeck-collab-section__title"><strong>${t("协作者", "Reviewers")}</strong><span>${snapshot.members.length}/6</span></div>
      <div class="clickdeck-collab-members">${snapshot.members.map((member) => `<span class="clickdeck-collab-member"><strong>${esc(member.displayName)}</strong><small>${member.role === "owner" ? t("创建者", "Owner") : t("成员", "Member")}</small></span>`).join("")}</div>
    </section>`;
  }

  function renderHistory(): string {
    return `<section data-collab-history-list aria-label="${t("本机项目记录", "Saved local projects")}"><div class="clickdeck-collab-section__title"><strong>${t("项目记录", "Saved projects")}</strong><span>${history.length}</span></div><div class="clickdeck-collab-entry-history">${history.map((entry, index) => `<div class="clickdeck-collab-history-row">
      <button class="clickdeck-button clickdeck-collab-history-open" data-collab-history="${index}" type="button" title="${esc(entry.participation.projectTitle)}"><span class="clickdeck-collab-history-name">${esc(entry.participation.projectTitle)}</span><span class="clickdeck-collab-history-match${entry.fingerprint === fingerprint ? " is-match" : ""}">${entry.fingerprint === fingerprint ? t("当前文件", "Current file") : t("版本未匹配", "Version differs")}</span><span aria-hidden="true">›</span></button>
      <div class="clickdeck-collab-history-meta"><span title="${t("本浏览器保存的角色与到期时间，查看时再核对线上状态。", "Saved local role and expiry; server state is checked when viewed.")}">${entry.participation.role === "owner" ? t("创建者", "Owner") : t("成员", "Member")} · ${entry.participation.expiresAt <= Date.now() ? t("已过期", "Expired") : `${t("到期", "Expires")} ${formatExpiry(entry.participation.expiresAt, locale)}`}</span><button class="clickdeck-button clickdeck-collab-history-remove" data-collab-remove-history="${index}" type="button" title="${t("仅移除本地记录，不删除云端项目", "Remove local reference only, not the cloud project")}" aria-label="${t("移除本地记录", "Remove local record")} ${esc(entry.participation.projectTitle)}">${t("移除", "Remove")}</button></div>
      </div>`).join("") || `<p>${t("暂无本机项目", "No saved projects")}</p>`}</div></section>`;
  }

  function updateReviewItems(): void {
    if (!snapshot) {
      reviewItems = [];
      activeReviewId = "";
      return;
    }
    const previous = new Map(reviewItems.map(item => [item.id, JSON.stringify(item.task)]));
    const result = buildCollaborationReviewItems(snapshot, zh ? "zh" : "en");
    reviewItems = result.ok ? result.items : [];
    if (selectionProject !== snapshot.project.id) {
      selectionProject = snapshot.project.id;
      selectedReviews = new Set(reviewItems.filter(item => !item.conflict).map(item => item.id));
    } else {
      selectedReviews = new Set(reviewItems.filter(item => selectedReviews.has(item.id) && previous.get(item.id) === JSON.stringify(item.task)).map(item => item.id));
    }
    if (reviewScope === "team" && !reviewItems.some((item) => item.id === activeReviewId)) activeReviewId = reviewItems[0]?.id ?? "";
  }

  function renderReviewBoard(): string {
    const items = shownItems();
    const drafts = reviewScope === "drafts" && currentCollaboration();
    const explained = items.find(item => item.id === activeReviewId)?.task;
    const groups = new Map<string, CollaborationReviewItem[]>();
    items.forEach(item => { const key = proposalLocationKey(item); groups.set(key, [...(groups.get(key) ?? []), item]); });
    const content = items.length === 0
      ? `<p class="clickdeck-collab-empty">${drafts ? draftError ? t("本地记录暂时无法整理，请返回编辑检查后重试。", "Unable to prepare local records. Check edits and retry.") : t("没有待提交的本地变化。已提交且未再变化的内容请在团队提案中查看。", "No pending local changes. Previously submitted unchanged proposals are in Team suggestions.") : t("尚未收到团队建议。提交后点击刷新即可查看。", "No team suggestions yet. Submit and refresh to view them.")}</p>`
      : [...groups.values()].map(group => `<div data-collab-location-group>${group.length > 1 ? `<p class="clickdeck-collab-location-heading">${esc(reviewLocation(group[0], zh ? "zh" : "en", !fileMismatch()))} · ${esc(group[0].targetLabel)} · ${group.length} ${t("项", "proposals")}</p>` : ""}${group.map((item) => {
        const locatable = Boolean(resolveCollaborationReviewTarget(item));
        const visible = Boolean(getVisibleCollaborationReviewTarget(item));
        const expanded = expandedReviewId === item.id;
        const locationLabel = reviewLocation(item, zh ? "zh" : "en", !fileMismatch());
        const targetText = item.task.locator?.textSnippet || item.task.source?.contents[0] || item.targetLabel;
        return `<div class="clickdeck-collab-review-card${item.id === activeReviewId ? " is-active" : ""}${drafts ? " is-draft" : ""}" data-collab-review="${esc(item.id)}" tabindex="0" aria-current="${item.id === activeReviewId ? "true" : "false"}">
          <span class="clickdeck-collab-review-card__number">${drafts ? "D" : ""}${item.number}</span>
          <span class="clickdeck-collab-review-card__body">
            <span class="clickdeck-collab-review-card__meta">
              <button class="clickdeck-collab-summary-button" data-collab-expand="${esc(item.id)}" aria-expanded="${expanded}" title="${esc(reviewChangeSummary(item))}" type="button">${esc(reviewChangeSummary(item))}<span aria-hidden="true"> ${expanded ? "▴" : "▾"}</span></button>
              <span class="clickdeck-collab-author" title="${esc(item.contributor)}">${esc(item.contributor)}</span>
              ${drafts ? `<label class="clickdeck-collab-choice" title="${t("分享给团队", "Share with team")}"><input type="checkbox" aria-label="${t("分享给团队", "Share with team")} ${item.number}" data-collab-share="${esc(item.id)}" ${sharing.has(item) ? "checked" : ""} ${draftError || snapshotStale || !snapshot || busy ? "disabled" : ""}></label>` : participation?.role === "owner" ? `<label class="clickdeck-collab-choice" title="${t("纳入执行 Prompt", "Include in execution prompt")}"><input type="checkbox" aria-label="${t("纳入执行 Prompt", "Include in execution prompt")} ${item.number}" data-collab-select="${esc(item.id)}" ${selectedReviews.has(item.id) ? "checked" : ""}></label>` : ""}
            </span>
            <span class="clickdeck-collab-review-context"><small class="clickdeck-collab-kind">${typeLabel(item)}</small>${item.conflict ? `<em class="clickdeck-collab-conflict">${t("可能冲突", "Possible conflict")}</em>` : ""}<small class="clickdeck-collab-location" title="${esc(locationLabel)} · ${esc(targetText)}">${esc(locationLabel)} · ${esc(targetText)}</small>${expanded && !drafts ? `<button class="clickdeck-button clickdeck-collab-inline-preview" data-collab-preview="${esc(item.id)}" type="button">${["style", "content"].includes(item.task.kind) ? t("预览 / 说明", "Preview / Explain") : t("查看说明", "Explain")}</button>` : ""}</span>
            <span data-collab-item-detail="${esc(item.id)}" ${expanded ? "" : "hidden"}>
            <span class="clickdeck-collab-target-short">${esc(targetText)}</span>
            <span class="clickdeck-collab-review-card__description">${esc(item.description)}</span>
            <small class="clickdeck-collab-state">${drafts ? `${draftState()} · ${isLocalAdjustment(item.task) ? t("本地编辑记录，未写回源码", "Local edit record, not saved to source") : t("仅记录意图，尚未执行", "Intent only, not executed")}` : t("已提交提案；纳入导出不等于已经执行", "Submitted proposal; export selection is not execution")}</small>
            ${drafts && isLocalAdjustment(item.task) ? `<small>${t("记录原值", "Recorded before")}：${esc(item.task.before || t("未记录视觉原值", "Visual original not recorded"))} → ${esc(item.task.after ?? "")}</small>` : ""}
            ${drafts && !isLocalAdjustment(item.task) && options.onEditIntent ? `<button class="clickdeck-button" data-collab-edit-intent="${esc(item.id)}" type="button">${t("编辑此意见", "Edit request")}</button>` : ""}
            <small data-collab-review-status class="${visible ? "is-locatable" : "is-unlocatable"}">${visible ? t("当前视野可见", "Visible in current view") : locatable ? t("不在当前视野或 deck", "Outside the current view or deck") : t("当前页面无法定位", "Cannot locate on this page")}</small>
            <small data-collab-navigation-note ${locatable && !fileMismatch() && !canScrollReviewTarget(resolveCollaborationReviewTarget(item)!) ? "" : "hidden"}>${t("目标所在页被隐藏，请使用原网页的翻页按钮切换。", "Target page is hidden. Use the webpage's navigation to switch pages.")}</small>
            </span>
          </span>
        </div>`;
      }).join("")}</div>`).join("");
    return `<section class="clickdeck-collab-section clickdeck-collab-review-board">
      <div class="clickdeck-collab-list-toolbar">
      <div class="clickdeck-collab-section__title">${currentCollaboration() ? `<div class="clickdeck-collab-scopes" role="group" aria-label="${t("查看范围", "View scope")}"><button type="button" data-collab-scope="team" aria-pressed="${!drafts}" title="${reviewItems.length} ${t("条最终建议", "final suggestions")}">${t("团队提案", "Team proposals")} ${reviewItems.length}</button><button type="button" data-collab-scope="drafts" aria-pressed="${drafts}">${t("我的待提交", "My pending")} ${draftItems.length}</button></div>` : `<strong>${t("团队建议", "Team suggestions")} ${items.length}</strong>`}<label class="clickdeck-collab-choice" title="${drafts ? t("显示草稿位置", "Show draft pins") : t("显示团队提案位置", "Show team pins")}"><input type="checkbox" data-collab-markers ${allMarkers ? "checked" : ""}>${t("标记", "Pins")}</label></div>
      ${drafts ? `<p class="clickdeck-collab-draft-note" data-collab-sharing-count>${t("分享给团队", "Share with team")} · ${t("已选", "Selected")} ${sharing.selected(draftItems).length} / ${draftItems.length} <button type="button" class="clickdeck-button" data-collab="share-all" ${!draftItems.length || draftError || snapshotStale || !snapshot || busy ? "disabled" : ""}>${sharing.selected(draftItems).length === draftItems.length && draftItems.length ? t("取消全选", "Deselect all") : t("全选", "Select all")}</button></p><p class="clickdeck-collab-draft-note">${t("未选项仅留本机；取消选择不撤回已提交提案。", "Unselected changes stay local. Deselecting does not withdraw earlier proposals.")}</p>` : `<div class="clickdeck-collab-review-filters" role="group" aria-label="${t("筛选团队建议", "Filter team suggestions")}">
        ${(["all", "viewport", "conflict", "mine"] as ReviewFilter[]).map((filter) => `<button class="clickdeck-button${reviewFilter === filter ? " clickdeck-button--active" : ""}" data-collab-review-filter="${filter}" type="button">${filter === "all" ? t("全部", "All") : filter === "viewport" ? t("当前视野", "Current view") : filter === "conflict" ? t("可能冲突", "Conflicts") : t("我已提交", "My submitted")}</button>`).join("")}
      </div>`}
      </div>
      <div class="clickdeck-collab-review-list">${content}</div>
      ${previewNote ? `<div class="clickdeck-collab-note" data-collab-preview-note role="status">${esc(previewNote)}
        <p>${esc(explained?.summary ?? "")}</p>
        ${explained?.before !== undefined || explained?.after !== undefined ? `<p>${esc(explained?.before || t("默认 / 未记录", "Default / not recorded"))} → ${esc(explained?.after ?? "")}</p>` : ""}
        ${reviewItems.find(item => item.id === activeReviewId)?.task.kind === "move" ? `<div class="clickdeck-collab-diagram"><span>A · ${t("原位置", "Source")}</span> → <span>B · ${t("目标位置", "Target")}</span></div>` : ""}
        ${reviewItems.find(item => item.id === activeReviewId)?.task.kind === "remove" ? `<div class="clickdeck-collab-diagram"><s>A · ${t("拟删除区域", "Proposed removal")}</s></div>` : ""}
        <p>${esc(reviewItems.find(item => item.id === activeReviewId)?.task.source?.userIntent ?? "")}</p>
        <p>${esc(reviewItems.find(item => item.id === activeReviewId)?.task.target?.userIntent ?? "")}</p>
        ${explained?.source ? `<p>A: ${esc(explained.source.anchor.label || explained.source.contents.join(" / "))}</p>` : ""}
        ${explained?.target ? `<p>B: ${esc(explained.target.anchor.label || explained.target.contents.join(" / "))}</p>` : ""}
        ${previewId ? `<button class="clickdeck-button" data-collab="restore-preview" type="button">${t("结束预览", "End preview")}</button>` : ""}</div>` : ""}
      <p class="clickdeck-collab-filter-empty" data-collab-filter-empty hidden>${t("当前筛选下没有建议。", "No suggestions match this filter.")}</p>
    </section>`;
  }

  function removeMarkerLayer(): void {
    if (!overlay) return;
    overlay.querySelector(".clickdeck-collab-marker-layer")?.remove();
    markerLayout = "";
  }

  function applyReviewFilter(): void {
    if (!overlay) return;
    let visibleCards = 0;
    overlay.querySelectorAll<HTMLElement>("[data-collab-review]").forEach((card) => {
      const item = shownItems().find((candidate) => candidate.id === card.dataset.collabReview);
      if (!item) return;
      const targetExists = Boolean(resolveCollaborationReviewTarget(item));
      const navigationNote = card.querySelector<HTMLElement>("[data-collab-navigation-note]");
      if (navigationNote) navigationNote.hidden = !targetExists || fileMismatch() || canScrollReviewTarget(resolveCollaborationReviewTarget(item)!);
      const inView = visibleReviewIds.has(item.id);
      const show = reviewScope === "drafts" || reviewFilter === "all"
        || (reviewFilter === "viewport" && inView)
        || (reviewFilter === "conflict" && item.conflict)
        || (reviewFilter === "mine" && item.contributorId === participation?.memberId);
      card.hidden = !show;
      if (show) visibleCards += 1;
      const status = card.querySelector<HTMLElement>("[data-collab-review-status]");
      if (status) {
        status.classList.toggle("is-locatable", inView);
        status.classList.toggle("is-unlocatable", !inView);
        status.textContent = inView
          ? t("当前视野可见", "Visible in current view")
          : targetExists ? t("不在当前视野或 deck", "Outside the current view or deck") : t("当前页面无法定位", "Cannot locate on this page");
      }
    });
    const empty = overlay.querySelector<HTMLElement>("[data-collab-filter-empty]");
    if (empty) empty.hidden = shownItems().length === 0 || visibleCards > 0;
    overlay.querySelectorAll<HTMLElement>("[data-collab-location-group]").forEach(group => { group.hidden = !Array.from(group.querySelectorAll<HTMLElement>("[data-collab-review]")).some(card => !card.hidden); });
  }

  function positionReviewMarkers(): void {
    if (!overlay || overlay.hidden || !participation || paused || promptSuspended || collapsed || fileMismatch() || projectsView || projectExpired() || browsingHistory) return;
    placeBoard();
    if (editing && !allMarkers) { removeMarkerLayer(); return; }
    const layer = document.createElement("div");
    layer.className = "clickdeck-collab-marker-layer";
    layer.dataset.clickdeck = "true";
    // The review overlay lives inside the main panel. Raising its z-index also
    // raises page annotations above that panel, so exclude the panel's bounds.
    const panelRect = (editing ? options.host : overlay.querySelector<HTMLElement>(".clickdeck-collab-modal") ?? options.host).getBoundingClientRect();
    const { innerWidth: viewportWidth, innerHeight: viewportHeight } = window;
    const left = Math.max(0, panelRect.left - 2);
    const top = Math.max(0, panelRect.top - 2);
    const right = Math.min(viewportWidth, panelRect.right + 2);
    const bottom = Math.min(viewportHeight, panelRect.bottom + 2);
    if (right > left && bottom > top) {
      layer.style.clipPath = `polygon(evenodd, 0px 0px, ${viewportWidth}px 0px, ${viewportWidth}px ${viewportHeight}px, 0px ${viewportHeight}px, 0px 0px, ${left}px ${top}px, ${left}px ${bottom}px, ${right}px ${bottom}px, ${right}px ${top}px, ${left}px ${top}px, 0px 0px)`;
    }
    const groups = new Map<string, { rect: DOMRect; items: CollaborationReviewItem[] }>();
    visibleReviewIds = new Set<string>();
    shownItems().forEach((item) => {
      const visibleTarget = getVisibleCollaborationReviewTarget(item);
      if (!visibleTarget) return;
      visibleReviewIds.add(item.id);
      if (!allMarkers && item.id !== activeReviewId) return;
      const key = proposalLocationKey(item);
      const group = groups.get(key) ?? { rect: visibleTarget.rect, items: [] };
      group.items.push(item);
      groups.set(key, group);
    });
    const nextLayout = JSON.stringify([reviewScope, editing, allMarkers, activeReviewId, left, top, right, bottom, viewportWidth, viewportHeight,
      [...groups.values()].map(({ rect, items }) => [rect.x, rect.y, rect.width, rect.height, items.map(item => [item.id, item.number, item.contributor, item.description, item.conflict])])]);
    if (nextLayout === markerLayout && overlay.querySelector(".clickdeck-collab-marker-layer")) { applyReviewFilter(); return; }
    removeMarkerLayer(); markerLayout = nextLayout;
    const occupiedPins: Array<{ x: number; y: number }> = [];
    groups.forEach(({ rect, items }) => {
      const activeItem = items.find((item) => item.id === activeReviewId);
      const primaryItem = activeItem ?? items[0];
      if (activeItem) {
        const highlight = document.createElement("div");
        highlight.className = `clickdeck-collab-page-highlight${isDraft(primaryItem) ? " is-draft" : ""}`;
        highlight.style.left = `${rect.left}px`;
        highlight.style.top = `${rect.top}px`;
        highlight.style.width = `${rect.width}px`;
        highlight.style.height = `${rect.height}px`;
        layer.appendChild(highlight);
      }
      const marker = document.createElement("button");
      marker.className = `clickdeck-collab-page-marker${activeItem ? " is-active" : ""}${isDraft(primaryItem) ? " is-draft" : ""}${items.some((item) => item.conflict) ? " has-conflict" : ""}`;
      marker.type = "button";
      marker.dataset.collabMarker = primaryItem.id;
      marker.dataset.collabMarkerGroup = items.map((item) => item.id).join("\n");
      const contributors = Array.from(new Set(items.map((item) => item.contributor)));
      marker.innerHTML = `<span class="clickdeck-collab-page-marker__number">${isDraft(primaryItem) ? "D" : ""}${items.length > 1 ? `+${items.length}` : primaryItem.number}</span><span class="clickdeck-collab-page-marker__label">${isDraft(primaryItem) ? `${draftState()} · ` : ""}${esc(contributors.join("、"))}</span>`;
      marker.title = items.map((item) => `${item.number}. ${item.contributor}: ${item.description}`).join("\n");
      let markerX = Math.min(window.innerWidth - 31, Math.max(4, rect.right - 13));
      let markerY = Math.min(window.innerHeight - 31, Math.max(4, rect.top - 13));
      // In editing mode the normal editor can cover the target's top-right corner.
      // Keep the pin reachable beside it instead of clipping away its hit area.
      if (markerX < right && markerX + 30 > left && markerY < bottom && markerY + 30 > top) {
        if (left >= 35) markerX = left - 31;
        else if (right + 31 <= viewportWidth) markerX = right + 4;
        else markerY = top >= 35 ? top - 31 : Math.min(viewportHeight - 31, bottom + 4);
      }
      // Independent regions may coincide. Offset their pins, never merge their data.
      const available = (x: number, y: number): boolean => x >= 4 && y >= 4 && x + 30 <= viewportWidth && y + 30 <= viewportHeight
        && !(x < right && x + 30 > left && y < bottom && y + 30 > top)
        && !occupiedPins.some(pin => Math.abs(pin.x - x) < 32 && Math.abs(pin.y - y) < 32);
      if (!available(markerX, markerY)) {
        const originX = markerX, originY = markerY;
        let placed = false;
        for (let radius = 1; radius <= 8 && !placed; radius++) {
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
            const x = originX + dx * radius * 34, y = originY + dy * radius * 34;
            if (available(x, y)) { markerX = x; markerY = y; placed = true; break; }
          }
        }
      }
      occupiedPins.push({ x: markerX, y: markerY });
      marker.style.left = `${markerX}px`;
      marker.style.top = `${markerY}px`;
      layer.appendChild(marker);
    });
    overlay.prepend(layer);
    applyReviewFilter();
    layer.querySelectorAll<HTMLButtonElement>("[data-collab-marker]").forEach((marker) => marker.addEventListener("click", () => {
      const ids = (marker.dataset.collabMarkerGroup ?? "").split("\n").filter(Boolean);
      const currentIndex = ids.indexOf(activeReviewId);
      selectReviewItem(ids[currentIndex >= 0 ? (currentIndex + 1) % ids.length : 0] ?? marker.dataset.collabMarker ?? "", false);
    }));
  }

  function scheduleMarkerPosition(): void {
    cancelAnimationFrame(markerFrame);
    markerFrame = requestAnimationFrame(positionReviewMarkers);
  }

  function selectReviewItem(id: string, locatePage: boolean): void {
    stopPreview(); previewNote = "";
    const item = shownItems().find((candidate) => candidate.id === id);
    if (!item) return;
    activeReviewId = id;
    expandedReviewId = id;
    if (editing) peekId = id;
    render();
    overlay?.querySelectorAll<HTMLElement>("[data-collab-review]").forEach((card) => {
      const active = card.dataset.collabReview === id;
      card.classList.toggle("is-active", active);
      card.setAttribute("aria-current", active ? "true" : "false");
    });
    if (locatePage) {
      const target = resolveCollaborationReviewTarget(item);
      if (target && canScrollReviewTarget(target)) target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    } else {
      Array.from(overlay?.querySelectorAll<HTMLElement>("[data-collab-review]") ?? [])
        .find((card) => card.dataset.collabReview === id)
        ?.scrollIntoView({ block: "nearest" });
    }
    scheduleMarkerPosition();
  }

  function stopMarkerTracking(): void {
    cancelAnimationFrame(markerFrame);
    markerObserver?.disconnect();
    markerObserver = null;
    markerTracking = false;
    window.removeEventListener("resize", scheduleMarkerPosition);
    window.removeEventListener("scroll", scheduleMarkerPosition, true);
    document.removeEventListener("clickdeck:presentationchange", scheduleMarkerPosition);
    document.removeEventListener("transitionend", schedulePageStatePosition, true);
    document.removeEventListener("animationend", schedulePageStatePosition, true);
    document.removeEventListener("click", schedulePageStatePosition, true);
    document.removeEventListener("keyup", schedulePageStatePosition, true);
  }

  function closePanel(): void {
    clearTimeout(expiryTimer);
    clearTimeout(localHintTimer);
    clearTimeout(feedbackTimer);
    cancelAnimationFrame(draftFrame);
    stopDragging?.();
    window.removeEventListener("resize", placeBoard);
    options.host.classList.remove("clickdeck-panel--reviewing");
    stopPreview(); previewNote = "";
    promptObserver?.disconnect();
    promptObserver = null;
    promptSuspended = false;
    stopMarkerTracking();
    chrome.runtime?.onMessage?.removeListener(onSecureUpdate);
    overlay?.remove();
    overlay = null;
    options.onAnnotationsChange?.(false);
  }

  function syncPromptVisibility(): void {
    if (!overlay) return;
    if (editing) {
      const promptOpen = Boolean(options.host.querySelector(".clickdeck-prompt-overlay"));
      overlay.hidden = promptOpen || !currentCollaboration();
      if (promptOpen) { stopPreview(); removeMarkerLayer(); }
      else scheduleMarkerPosition();
      return;
    }
    if (overlay.hidden) return;
    const prompt = options.host.querySelector<HTMLElement>(".clickdeck-prompt-overlay");
    const suspended = Boolean(prompt);
    if (suspended === promptSuspended) return;
    const board = overlay.querySelector<HTMLElement>(".clickdeck-collab-modal")!;
    if (suspended) {
      scrollTop = board.scrollTop;
      reviewPlacement = { floating: floating ? { ...floating } : null, left: dockLeft };
    }
    promptSuspended = suspended;
    overlay.classList.toggle("clickdeck-collab-overlay--prompt", suspended);
    if (suspended) {
      stopPreview(); previewNote = "";
      stopMarkerTracking();
      removeMarkerLayer();
      prompt!.classList.add("clickdeck-prompt-overlay--inline");
      board.appendChild(prompt!);
      prompt!.querySelector("[role='dialog']")?.setAttribute("aria-modal", "false");
      const close = prompt!.querySelector("[data-prompt-action='close']");
      if (close) close.textContent = t("返回建议", "Back to suggestions");
      board.scrollTop = 0; placeBoard();
      prompt!.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    } else {
      const saved = scrollTop;
      if (reviewPlacement) { floating = reviewPlacement.floating; dockLeft = reviewPlacement.left; reviewPlacement = null; }
      render(); scrollTop = saved;
      overlay.querySelector<HTMLElement>(".clickdeck-collab-modal")!.scrollTop = saved;
    }
  }

  function onSecureUpdate(value: { type?: string; action?: string }, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void): void {
    if (value?.type === "CLICKDECK_COLLABORATION_SOURCE_ALIVE" && sender.id === chrome.runtime.id && overlay) respond({ alive: true });
    if (value?.type === "CLICKDECK_COLLABORATION_UPDATED" && sender.id === chrome.runtime.id && overlay) {
      void run(async () => {
        if (browsingHistory) resetReview(); projectsView = false; await loadParticipation(); await refresh();
        if (value.action === "submit") message = snapshotStale
          ? t("提交已确认，但刷新失败，请重试刷新。", "Submission confirmed; refresh failed. Refresh again.")
          : t("已提交团队，其他成员刷新后可见。", "Shared with the team. Other members can refresh to view it.");
        if (value.action === "submit" && !snapshotStale) {
          clearTimeout(feedbackTimer);
          const delivered = message;
          feedbackTimer = setTimeout(() => {
            if (message !== delivered) return;
            message = "";
            overlay?.querySelector('.clickdeck-collab-session-status:not([data-collab-local-hint])')?.remove();
            overlay?.querySelector('.clickdeck-collab-modal__message[data-tone="info"]')?.remove();
          }, 5000);
        }
      });
    }
  }

  function schedulePageStatePosition(event: Event): void {
    if (event.target instanceof Element && event.target.closest("[data-clickdeck]")) return;
    scheduleMarkerPosition();
  }

  function startMarkerTracking(): void {
    if (markerTracking) return;
    markerTracking = true;
    window.addEventListener("resize", scheduleMarkerPosition);
    window.addEventListener("scroll", scheduleMarkerPosition, true);
    document.addEventListener("clickdeck:presentationchange", scheduleMarkerPosition);
    document.addEventListener("transitionend", schedulePageStatePosition, true);
    document.addEventListener("animationend", schedulePageStatePosition, true);
    document.addEventListener("click", schedulePageStatePosition, true);
    document.addEventListener("keyup", schedulePageStatePosition, true);
    markerObserver = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.target === options.host || (mutation.target instanceof Element && !mutation.target.closest("[data-clickdeck]")))) scheduleMarkerPosition();
    });
    markerObserver.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["class", "style", "hidden", "aria-hidden"] });
  }

  async function loadParticipation(): Promise<void> {
    unmatchedAddress = null;
    const all = await chrome.storage.local.get(null);
    history = Object.entries(all).filter(([key, p]) => key.startsWith(STORAGE_PREFIX) && isParticipation(p))
      .map(([key, p]) => ({ fingerprint: key.slice(STORAGE_PREFIX.length), participation: p as CollaborationParticipation }));
    if (!fingerprint) { participation = null; return; }
    const stored = await chrome.storage.local.get(storageKey());
    const value = stored[storageKey()];
    if (isParticipation(value)) {
      participation = value;
      associatedFingerprint = fingerprint;
      return;
    }
    const saved = (await chrome.storage.local.get(urlKey))[urlKey];
    if (saved && typeof saved.fingerprint === "string" && isParticipation(saved.participation)) {
      if (saved.fingerprint === fingerprint) {
        participation = saved.participation;
        associatedFingerprint = saved.fingerprint;
        return;
      }
      unmatchedAddress = saved;
    }
    participation = null;
    if (unmatchedAddress && !history.some(entry => entry.fingerprint === unmatchedAddress!.fingerprint && entry.participation.projectId === unmatchedAddress!.participation.projectId)) history.unshift(unmatchedAddress);
  }

  function resetReview(): void {
    stopPreview(); stopMarkerTracking(); removeMarkerLayer();
    browsingHistory = false; participation = null; snapshot = null; associatedFingerprint = "";
    reviewItems = []; activeReviewId = ""; selectionProject = ""; selectedReviews.clear();
    expandedReviewId = "";
    lastSyncedAt = 0; snapshotStale = false; collapsed = false; detailsOpen = false;
    reviewFilter = "all"; previewNote = ""; scrollTop = 0;
    reviewScope = "team"; draftItems = []; draftError = "";
  }

  async function saveParticipation(value: CollaborationParticipation): Promise<void> {
    participation = value;
    await chrome.storage.local.set({
      [STORAGE_PREFIX + associatedFingerprint]: value,
      [urlKey]: { fingerprint: associatedFingerprint, participation: value }
    });
  }

  function setError(code: string): void {
    if (code.startsWith('source-')) sourceError = code;
    messageIsError = true;
    const known = errorMessages[code] ?? errorMessages["network-error"];
    message = zh ? known.zh : known.en;
  }

  async function ensureSource(force = false): Promise<boolean> {
    if (!options.sourceVerification || (fingerprint && !sourceError && !force)) return true;
    checkingSource = true; render();
    try {
      const result = await request({ action: 'verify-source' });
      if (!result.ok || !('fingerprint' in result.data)) { setError(result.ok ? 'source-unavailable' : result.error); return false; }
      if (fingerprint && fingerprint !== result.data.fingerprint) { setError('source-changed'); return false; }
      fingerprint = result.data.fingerprint;
      sourceError = ''; message = ''; messageIsError = false;
      options.onSourceVerified?.(fingerprint);
      return true;
    } catch { setError('source-unavailable'); return false; }
    finally { checkingSource = false; }
  }

  async function refresh(): Promise<void> {
    if (!participation) return;
    let response: CollaborationResponse;
    try {
      response = await request({ action: "read", projectId: participation.projectId });
    } catch (error) {
      if (snapshot) snapshotStale = true;
      throw error;
    }
    if (!response.ok) {
      if (snapshot) snapshotStale = true;
      setError(response.error);
      // Empty RLS results do not prove deletion. Never erase recovery evidence.
      return;
    }
    if ("snapshot" in response.data) {
      snapshot = response.data.snapshot ?? null;
      if (snapshot) associatedFingerprint = snapshot.project.pageFingerprint;
      lastSyncedAt = Date.now();
      snapshotStale = false;
      participation = { ...response.data.participation, inviteCode: participation.inviteCode };
      if (!browsingHistory) await saveParticipation(participation);
    }
  }

  function render(): void {
    if (!overlay) return;
    if (promptSuspended) return;
    clearTimeout(expiryTimer);
    if (participation && !projectExpired()) {
      const remaining = participation.expiresAt - Date.now();
      // Re-render only at the reminder threshold and expiry, not every minute
      // while someone is reading, typing or temporarily previewing a proposal.
      const nextBoundary = remaining > 6 * 3600_000 ? remaining - 6 * 3600_000 + 10 : remaining + 10;
      expiryTimer = setTimeout(() => {
        if (projectExpired()) { stopPreview(); removeMarkerLayer(); }
        render();
      }, Math.min(2147483647, nextBoundary));
    }
    const oldBoard = overlay.querySelector<HTMLElement>(".clickdeck-collab-modal");
    if (oldBoard) scrollTop = oldBoard.scrollTop;
    const oldDetails = overlay.querySelector<HTMLDetailsElement>("[data-collab-details]");
    if (oldDetails) detailsOpen = oldDetails.open;
    const oldDiagnostic = overlay.querySelector<HTMLDetailsElement>("[data-collab-source-diagnostic]");
    if (oldDiagnostic) sourceDiagnosticOpen = oldDiagnostic.open;
    updateReviewItems();
    updateDraftItems();
    if (!shownItems().some(item => item.id === activeReviewId)) activeReviewId = shownItems()[0]?.id ?? "";
    options.onAnnotationsChange?.(currentCollaboration() && !paused);
    if (editing) {
      overlay.classList.add("clickdeck-collab-overlay--editing");
      overlay.hidden = !currentCollaboration();
      renderLightweight();
      if (!overlay.hidden && !paused) startMarkerTracking();
      else stopMarkerTracking();
      removeMarkerLayer(); positionReviewMarkers();
      return;
    }
    overlay.classList.remove("clickdeck-collab-overlay--editing");
    const taskCount = snapshot?.rawTaskCount ?? snapshot?.submissions.reduce((sum, item) => sum + item.tasks.length, 0) ?? 0;
    const capacityNotice = taskCount >= 100
      ? t("项目已保存100条记录。可更新已有建议；新增建议需有剩余额度。", "100 records saved. Existing suggestions may be updated; new suggestions require free capacity.")
      : taskCount >= 80
        ? t(`项目已保存 ${taskCount}/100 条记录，接近上限。`, `${taskCount}/100 records saved; nearing capacity.`)
        : "";
    const sourceNeedsAttention = !fingerprint || !!sourceError || checkingSource || fileMismatch();
    const sourceUnresolved = options.sourceVerification && !fingerprint;
    const sourceStatus = options.sourceVerification ? `<div class="clickdeck-collab-form-hint" data-collab-source title="${esc(fingerprint)}">${checkingSource ? t('正在自动检查原始文件…', 'Checking the original file…') : sourceError || !fingerprint ? t("原始文件检查未完成", "Source check incomplete") : fileMismatch() ? t("原始版本未匹配；仅供查看", "Original version differs; read-only") : t("原始版本已核验；本地修改单独记录", "Original version verified; local edits tracked separately")} ${sourceNeedsAttention && !checkingSource ? `<button class="clickdeck-button" data-collab="verify-source" type="button">${t("重试文件检查", "Retry file check")}</button>` : ''}</div>` : "";
    overlay.classList.add("clickdeck-collab-overlay--board");
    overlay.classList.toggle("clickdeck-collab-overlay--entry", !participation || projectsView || projectExpired());
    overlay.classList.toggle("clickdeck-collab-overlay--left", dockLeft);
    overlay.classList.toggle("clickdeck-collab-overlay--projects", projectsView);
    overlay.classList.toggle("clickdeck-collab-overlay--collapsed", collapsed);
    // Async file checks rerender the board. Keep keyboard focus inside its controls.
    const activeElement = (overlay.getRootNode() as Document | ShadowRoot).activeElement;
    const hadFocusInside = activeElement instanceof HTMLElement && overlay.contains(activeElement);
    const focusedAction = hadFocusInside ? activeElement.dataset.collab : undefined;
    overlay.innerHTML = `
      <div class="clickdeck-collab-modal clickdeck-collab-modal--board" role="dialog" aria-modal="false" aria-label="${t("协作审阅 Beta", "Collaborative review Beta")}">
        <div class="clickdeck-collab-modal__header">
          <div title="${t("拖动标题可移动面板", "Drag the header to move")}"><strong>${t("团队审阅", "Team review")}</strong></div>
          <div class="clickdeck-collab-header-tools">
          ${participation && !projectsView ? `<button class="clickdeck-button" data-collab="refresh" aria-label="${t("刷新团队状态", "Refresh status")}" title="${t("刷新团队状态", "Refresh status")}" type="button">↻</button><button class="clickdeck-button" data-collab="dock" aria-label="${dockLeft ? t("移到右侧", "Dock right") : t("移到左侧", "Dock left")}" title="${dockLeft ? t("移到右侧", "Dock right") : t("移到左侧", "Dock left")}" type="button">${dockLeft ? "⇥" : "⇤"}</button><button class="clickdeck-button" data-collab="collapse" aria-label="${collapsed ? t("展开建议", "Expand") : t("收起建议", "Collapse")}" title="${collapsed ? t("展开建议", "Expand") : t("收起建议", "Collapse")}" type="button" aria-expanded="${!collapsed}">${collapsed ? "+" : "−"}</button>` : ""}
          <button class="clickdeck-button" data-collab="close" title="${t("展开编辑器；如需浏览翻页，请再收起编辑器。", "Opens the editor. Collapse it to browse and use page navigation.")}" type="button">${t("返回编辑", "Back to editing")}</button>
          </div>
        </div>
        <nav class="clickdeck-collab-navigation" aria-label="${t("协作导航", "Review navigation")}"><button class="clickdeck-button" data-collab="current-page" type="button" aria-pressed="${!projectsView && !browsingHistory}">${t("当前页面", "Current page")}</button><button class="clickdeck-button" data-collab="projects" type="button" aria-pressed="${projectsView}">${t("本机项目", "Local projects")}</button></nav>
        ${participation && !projectsView ? `<div class="clickdeck-collab-window-controls">
          ${browsingHistory ? `<button class="clickdeck-button" data-collab="back-projects" type="button">${t("返回当前页面", "Back to current page")}</button>` : fileMismatch() ? `<button class="clickdeck-button" data-collab="unlink" type="button">${t("解除当前页面关联", "Unlink this page")}</button>` : ""}
        </div>` : ""}
        <div class="clickdeck-collab-body" ${collapsed && participation ? "hidden" : ""}>
        ${sourceNeedsAttention ? sourceStatus : ""}
        ${options.sourceVerification && fingerprint && snapshot && snapshot.project.fingerprintVersion !== "source-v2" && participation?.role === "owner" ? `<div class="clickdeck-collab-stale-note">${t("此项目使用旧页面校验。请确认当前原始HTML就是创建项目时的版本；升级保留建议，但不保证旧建议都能定位。", "Legacy DOM verification. Confirm this is the original project HTML; upgrading preserves suggestions but cannot guarantee their locations.")}<button class="clickdeck-button" data-collab="upgrade-source" type="button">${t("核验并升级旧项目", "Verify and upgrade legacy project")}</button></div>` : ""}
        ${message ? `<div class="clickdeck-collab-modal__message" data-tone="${messageIsError ? "error" : "info"}">${esc(message)}</div>` : ""}
        ${lastSourceDiagnostic ? `<details data-collab-source-diagnostic ${sourceDiagnosticOpen ? "open" : ""}><summary>${t("上次文件核验诊断（仅本地）", "Last source-check diagnostic (local only)")}</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto">${esc(lastSourceDiagnostic)}</pre><button class="clickdeck-button" data-collab="copy-source-diagnostic" type="button">${t("复制诊断", "Copy diagnostic")}</button></details>` : ""}
        ${browsingHistory && options.sourceVerification && snapshot?.project.fingerprintVersion === "source-v2" && !fileMismatch() ? `<button class="clickdeck-button" data-collab="link-verified" type="button">${t("原始版本匹配，继续此项目", "Source matches. Continue this project")}</button>` : ""}
        ${browsingHistory && !projectsView ? `<div class="clickdeck-collab-stale-note">${t("正在查看历史项目，不会关联到当前页面。", "Viewing history without linking it to this page.")}</div>` : ""}
        ${fileMismatch() && !projectsView ? `<div class="clickdeck-collab-stale-note">${t("此项目与当前文件校验不同，仅供查看，不定位或提交。", "This project differs from the current file. Read-only; no markers or submission.")}${!browsingHistory ? t("若是误关联，可解除当前页面关联；原项目仍保留。", "Unlink an incorrect page association without deleting the project.") : ""}</div>` : ""}
        ${projectsView ? `<div class="clickdeck-collab-entry-status"><strong>${t("本机项目", "Local projects")}</strong><p>${t("查看历史不会关联当前HTML。记录仅保存在本浏览器。", "History browsing does not link this HTML. Records are stored in this browser.")}</p></div>${renderHistory()}` : participation && projectExpired() ? `<div class="clickdeck-collab-summary"><strong>${esc(participation.projectTitle)}</strong><span>${t("项目已过期", "Project expired")}</span></div><p>${t("此项目已停止提交和邀请。云端按计划清理，本机记录可在本机项目中移除。", "Submissions and invitations have ended. Cloud data is scheduled for cleanup; local records can be removed in Local projects.")}</p>${!browsingHistory && !fileMismatch() ? `<button class="clickdeck-button clickdeck-button--primary" data-collab="manage" type="button">${t("为当前HTML重新创建 / 加入", "Start again for this HTML")}</button>` : ""}` : participation ? `
          <div class="clickdeck-collab-summary">
            <div class="clickdeck-collab-project-line"><strong title="${esc(participation.projectTitle)}">${t("项目：", "Project: ")}${esc(participation.projectTitle)}</strong><span>${t("你的角色：", "Your role: ")}${participation.role === "owner" ? t("创建者", "Owner") : t("成员", "Member")}</span>
            ${participation.role === "owner" && !browsingHistory && !fileMismatch() ? `<button class="clickdeck-button" data-collab="manage" type="button">${t("邀请协作者", "Invite reviewers")}</button>` : ""}
            </div>
            <span class="${participation.expiresAt-Date.now() < 6*3600_000 ? "is-expiring" : ""}">${t("共 ", "Total: ")}${snapshot?.members.length ?? "—"} ${t("人（含创建者）", "people (including owner)")} · ${t("剩余约", "About")} ${Math.max(0, Math.ceil((participation.expiresAt-Date.now())/3600000))} ${t("小时", "hours left")}</span>
          </div>
          ${snapshotStale && snapshot ? `<div class="clickdeck-collab-stale-note">${t("网络刷新失败，以下为上次成功同步的内容", "Refresh failed; showing the last successfully synced content")}${lastSyncedAt ? ` · ${formatExpiry(lastSyncedAt, locale)}` : ""}</div>` : ""}
          ${participation.expiresAt - Date.now() < 6 * 3600_000 ? `<p class="clickdeck-collab-stale-note" role="status">${t("项目即将到期，请及时提交并备份团队建议。加入或提交不会延长截止时间。", "This project expires soon. Submit and back up team suggestions before the deadline; joining or submitting will not extend it.")}</p>` : ""}
          ${capacityNotice ? `<div class="clickdeck-collab-capacity-note${taskCount >= 100 ? " is-full" : ""}">${esc(capacityNotice)}</div>` : ""}
          ${snapshot?.invalidTaskCount ? `<div class="clickdeck-collab-stale-note">${t("已隔离", "Quarantined")} ${snapshot.invalidTaskCount} ${t("条异常建议；当前列表及 Team Prompt 不完整，异常记录仍占用容量。", "invalid suggestions; this list and Team Prompt are incomplete. Invalid records still count toward capacity.")}</div>` : ""}
          ${renderReviewBoard()}
          <div class="clickdeck-collab-actions" ${reviewScope === "drafts" && currentCollaboration() ? "hidden" : ""}>
            <button class="clickdeck-button${participation.role !== "owner" && !fileMismatch() && !browsingHistory ? " clickdeck-button--primary" : ""}" data-collab="submit" type="button" ${fileMismatch() || browsingHistory ? "disabled" : ""}>${t("选择要分享的修改", "Choose changes to share")}</button>
            ${participation.role === "owner" ? `<button class="clickdeck-button${!fileMismatch() && !browsingHistory ? " clickdeck-button--primary" : ""}" data-collab="team-prompt" type="button" ${snapshot && selectedReviews.size > 0 ? "" : "disabled"}>${t("生成执行 Prompt", "Generate execution prompt")} (${selectedReviews.size})</button>` : ""}
          </div>
          ${reviewScope === "drafts" && currentCollaboration() ? `<div class="clickdeck-collab-actions"><button class="clickdeck-button clickdeck-button--primary" type="button" data-collab="submit-pending" ${!sharing.selected(draftItems).length || draftError || snapshotStale || !snapshot ? "disabled" : ""}>${t("核对并提交", "Review and submit")} ${sharing.selected(draftItems).length} ${t("项", "changes")}</button></div>` : ""}
          <details data-collab-details ${detailsOpen ? "open" : ""}><summary>${t("项目资料与使用说明", "Project information & help")}</summary>
            ${snapshot ? `<button class="clickdeck-button" data-collab="backup" type="button">${t("备份全部已读取建议", "Back up all downloaded suggestions")}</button><p>${t("备份包括未选中和冲突项，不是执行Prompt，不包含未提交草稿。到期前请保存；刷新失败时仅备份上次快照。", "The backup includes unselected and conflicting proposals, not an execution prompt or local drafts. Save before expiry; failed refreshes leave only the last snapshot.")}</p>` : ""}
            ${!sourceNeedsAttention ? sourceStatus : ""}
            <p>${t("当前文件校验码", "Current file check")}：${shortFingerprint(fingerprint)}</p>
            <p>${snapshot ? `${snapshot.members.length}/6 ${t("人", "members")} · ${taskCount}/100 ${t("条原始任务", "source tasks")}` : ""}</p>
            <p>${t("新项目自创建起固定48小时，加入、提交、刷新均不续期。旧项目保留原截止时间。每个浏览器身份同时最多创建3个有效项目；加入不占创建名额。", "New projects last 48 hours from creation; joining, submitting and refreshing never extend the deadline. Existing projects keep their original deadline. Each browser identity may own 3 active projects; joining does not use an owner slot.")}</p>
            <p>${t("到期", "Expires")}：${formatExpiry(participation.expiresAt, locale)} · ${t("上次刷新", "Last refreshed")}：${formatExpiry(lastSyncedAt, locale)}</p>
            ${renderMembers()}
            ${participation.role === "member" && !browsingHistory && !fileMismatch() ? `<button class="clickdeck-button" data-collab="manage" type="button">${t("连接状态", "Connection status")}</button>` : ""}
            <p>${t("点击编号定位，点击摘要展开详情。勾选只影响本次导出，不删除原建议；冲突默认不选。刷新后变化的建议需重新勾选；隐藏页请用原网页导航。", "Pins locate targets; summaries expand details. Selection affects export only, not stored suggestions. Conflicts start unchecked; changed suggestions need reselection. Use original navigation for hidden slides.")}</p>
            <p class="clickdeck-collab-fineprint">${t("普通编辑可离线使用。协作需联网；只上传主动提交的修改意见，不上传完整HTML或图片。", "Editing works offline. Collaboration uploads only explicitly submitted suggestions, not full HTML or images.")}</p>
          </details>
        ` : `
          <div class="clickdeck-collab-entry-status"><strong>${sourceUnresolved ? t("暂时无法确认关联项目", "Project association not yet checked") : t("当前页面尚未关联项目", "No project linked to this page")}</strong><p>${sourceUnresolved ? t("文件检查完成后会自动查找已有项目；本机记录没有删除。", "Existing projects will be checked once the file is verified. Local records have not been removed.") : t("共享修改建议，不自动同步网页。", "Share review suggestions, not live webpage changes.")}</p></div>
          ${unmatchedAddress ? `<div class="clickdeck-collab-stale-note">${t("发现此地址的旧项目，但与当前文件不同，未自动打开。可在本地历史中查看。", "An older project at this address differs from this file and was not opened. View it in local history.")}<button class="clickdeck-button" data-collab="unlink" type="button">${t("解除旧地址关联", "Unlink old address record")}</button></div>` : ""}
          ${!serviceConfigured ? `<div class="clickdeck-collab-disabled-note">${t("当前构建没有协作连接配置，无法创建或加入项目。请使用已配置的测试包或正式发布包。", "This build has no collaboration connection configured. Use a configured test or release build to create or join a project.")}</div>` : ""}
          <button class="clickdeck-button clickdeck-button--primary clickdeck-collab-entry-primary" data-collab="manage" type="button" ${serviceConfigured ? "" : "disabled"}>${t("创建 / 加入项目", "Create / Join project")}</button>
          <div class="clickdeck-collab-entry-refresh"><span>${t("已有项目？", "Already joined?")}</span><button class="clickdeck-button" data-collab="refresh" type="button">${t("刷新状态", "Refresh status")}</button></div>
          <p class="clickdeck-collab-form-hint">${t("原始 HTML 需另行发送给协作者。", "Send the original HTML to collaborators separately.")}</p>
          <details data-collab-help><summary>${t("使用说明与有效期", "How it works & expiry")}</summary>${!sourceNeedsAttention ? sourceStatus : ""}<p>${t("创建、加入和邀请码在独立扩展窗口操作。返回后可刷新团队状态。", "Create, join and manage invitations in a separate extension window. Refresh status when you return.")}</p><p>${t("协作项目不托管网页。请将原始 HTML 与邀请说明一起发送给协作者。", "The project does not host the webpage. Send the original HTML with the invitation.")}</p><p>${t("新项目自创建起固定48小时，加入、提交、刷新均不续期。每个浏览器身份同时最多创建3个有效项目；加入不占创建名额。", "New projects last 48 hours from creation; joining, submitting and refreshing never extend expiry. Each browser identity may own 3 active projects; joining does not use an owner slot.")}</p></details>
        `}
        ${projectExpired() && snapshot && !projectsView ? `<p>${t("只能备份此前已读取的内容，可能缺少后续提交。", "Only the previously downloaded snapshot is available; later submissions may be missing.")}</p><button class="clickdeck-button" data-collab="backup" type="button">${t("备份上次已读取建议", "Back up last downloaded suggestions")}</button>` : ""}
        </div>
        ${busy ? `<div class="clickdeck-collab-modal__busy">${t("处理中…", "Working…")}</div>` : ""}
      </div>`;
    if (participation && !projectsView && !projectExpired() && !overlay.hidden && !promptSuspended && !collapsed) startMarkerTracking();
    else stopMarkerTracking();
    bind();
    bindDragging(); placeBoard();
    if (hadFocusInside) {
      const control = focusedAction ? Array.from(overlay.querySelectorAll<HTMLElement>('[data-collab]')).find(element => element.dataset.collab === focusedAction) : undefined;
      const target = control ?? overlay.querySelector<HTMLElement>('.clickdeck-collab-modal')!;
      if (!control) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
    overlay.querySelector<HTMLElement>(".clickdeck-collab-modal")!.scrollTop = scrollTop;
    positionReviewMarkers();
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    stopPreview(); previewNote = "";
    busy = true; message = ""; messageIsError = false;
    if (sourceError) setError(sourceError);
    render();
    try { await action(); } catch { setError("network-error"); }
    busy = false; render();
  }

  function bind(): void {
    if (!overlay) return;
    const copyDiagnostic = overlay.querySelector<HTMLButtonElement>('[data-collab="copy-source-diagnostic"]');
    copyDiagnostic?.addEventListener("click", async event => {
      if (!event.isTrusted || !lastSourceDiagnostic) return;
      try {
        // Never copy from page-editable DOM, even when its visible text has changed.
        await navigator.clipboard.writeText(lastSourceDiagnostic);
        copyDiagnostic.textContent = t("已复制诊断", "Diagnostic copied");
      } catch {
        copyDiagnostic.textContent = t("复制失败，请手动选取诊断", "Copy failed; select the diagnostic manually");
      }
    });
    overlay.querySelectorAll<HTMLButtonElement>("[data-collab-scope]").forEach(button => button.addEventListener("click", () => {
      if (busy || !currentCollaboration()) return;
      stopPreview(); previewNote = ""; peekId = ""; expandedReviewId = ""; activeReviewId = ""; scrollTop = 0;
      reviewScope = button.dataset.collabScope === "drafts" ? "drafts" : "team";
      if (reviewScope === "drafts") allMarkers = true;
      render();
    }));
    overlay.querySelectorAll<HTMLButtonElement>("[data-collab-edit-intent]").forEach(button => button.addEventListener("click", () => {
      const item = draftItems.find(candidate => candidate.id === button.dataset.collabEditIntent);
      if (item) editIntent(item);
    }));
    overlay.querySelectorAll<HTMLInputElement>('[data-collab-share]').forEach(input => input.addEventListener("change", () => {
      if (busy || snapshotStale || !snapshot) return;
      const item = draftItems.find(candidate => candidate.id === input.dataset.collabShare);
      if (item) sharing.choose(item, input.checked);
      render();
    }));
    overlay.querySelector('[data-collab="share-all"]')?.addEventListener("click", () => {
      if (busy || draftError || snapshotStale || !snapshot) return;
      const chooseAll = sharing.selected(draftItems).length !== draftItems.length;
      draftItems.forEach(item => sharing.choose(item, chooseAll)); render();
    });
    overlay.querySelector('[data-collab="submit-pending"]')?.addEventListener("click", event => { if (event.isTrusted) void submitEdits(); });
    overlay.querySelector<HTMLElement>("[data-collab='link-verified']")?.addEventListener("click", event => {
      if (!event.isTrusted || !participation || fileMismatch() || snapshot?.project.fingerprintVersion !== "source-v2") return;
      void run(async () => { await saveParticipation(participation!); browsingHistory = false; });
    });
    overlay.querySelector<HTMLElement>("[data-collab='verify-source']")?.addEventListener("click", () => void run(async () => {
      if (!await ensureSource(true)) return;
      await loadParticipation(); await refresh();
    }));
    overlay.querySelector<HTMLElement>("[data-collab='upgrade-source']")?.addEventListener("click", event => {
      if (!event.isTrusted || !participation || !fingerprint) return;
      void run(async () => {
        const result = await request({ action: "secure-window", pageFingerprint: fingerprint, sourceVerified: true, upgradeProjectId: participation!.projectId });
        if (!result.ok) setError(result.error);
      });
    });
    overlay.querySelector<HTMLElement>("[data-collab='projects']")?.addEventListener("click", () => void run(async () => {
      const all = await chrome.storage.local.get(null);
      history = Object.entries(all).filter(([key, p]) => key.startsWith(STORAGE_PREFIX) && isParticipation(p)).map(([key, p]) => ({ fingerprint: key.slice(STORAGE_PREFIX.length), participation: p as CollaborationParticipation }));
      projectsView = true; collapsed = false; scrollTop = 0; removeMarkerLayer();
    }));
    overlay.querySelector<HTMLElement>("[data-collab='current-page']")?.addEventListener("click", () => void run(async () => { if (browsingHistory) resetReview(); projectsView = false; collapsed = false; if (!await ensureSource()) return; await loadParticipation(); await refresh(); }));
    overlay.querySelectorAll<HTMLElement>("[data-collab-expand]").forEach(button => button.addEventListener("click", () => {
      const id = button.dataset.collabExpand!;
      if (expandedReviewId === id) { stopPreview(); previewNote = ""; expandedReviewId = ""; render(); }
      else selectReviewItem(id, !fileMismatch());
    }));
    overlay.querySelectorAll<HTMLElement>("[data-collab-preview]").forEach(button => button.addEventListener("click", event => {
      if (!event.isTrusted) return;
      const item = reviewItems.find(item => item.id === button.dataset.collabPreview);
      if (item) showReviewPreview(item);
    }));
    overlay.querySelector<HTMLElement>("[data-collab='restore-preview']")?.addEventListener("click", () => { stopPreview(); previewNote = ""; render(); });
    overlay.querySelectorAll<HTMLElement>("[data-collab-history]").forEach(button => button.addEventListener("click", event => {
      if (!event.isTrusted) return;
      void run(async () => {
      const entry = history[Number(button.dataset.collabHistory)];
      if (!entry) return;
      resetReview();
      projectsView = false;
      browsingHistory = true;
      participation = entry.participation;
      associatedFingerprint = entry.fingerprint;
      await refresh();
      });
    }));
    overlay.querySelector<HTMLElement>("[data-collab='close']")?.addEventListener("click", returnToEditing);
    overlay.querySelector<HTMLInputElement>("[data-collab-markers]")?.addEventListener("change", event => { allMarkers = (event.target as HTMLInputElement).checked; positionReviewMarkers(); });
    overlay.querySelector<HTMLElement>("[data-collab='dock']")?.addEventListener("click", () => { dockLeft = !dockLeft; floating = null; render(); });
    overlay.querySelector<HTMLElement>("[data-collab='collapse']")?.addEventListener("click", returnToEditing);
    overlay.querySelectorAll<HTMLInputElement>("[data-collab-select]").forEach(input => input.addEventListener("change", () => {
      const id = input.dataset.collabSelect!;
      if (input.checked) selectedReviews.add(id); else selectedReviews.delete(id);
      render();
    }));
    overlay.querySelectorAll<HTMLElement>("[data-collab-review]").forEach((card) => card.addEventListener("click", event => {
      if ((event.target as Element).closest("label, input, button")) return;
      selectReviewItem(card.dataset.collabReview ?? "", !fileMismatch());
    }));
    overlay.querySelectorAll<HTMLElement>("[data-collab-review]").forEach(card => card.addEventListener("keydown", event => {
      if (event.target === card && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault(); selectReviewItem(card.dataset.collabReview ?? "", !fileMismatch());
      }
    }));
    overlay.querySelectorAll<HTMLButtonElement>("[data-collab-review-filter]").forEach((button) => button.addEventListener("click", () => {
      reviewFilter = (button.dataset.collabReviewFilter as ReviewFilter | undefined) ?? "all";
      overlay?.querySelectorAll<HTMLButtonElement>("[data-collab-review-filter]").forEach((candidate) => candidate.classList.toggle("clickdeck-button--active", candidate === button));
      applyReviewFilter();
    }));
    overlay.querySelector<HTMLElement>("[data-collab='manage']")?.addEventListener("click", event => {
      if (!event.isTrusted) return;
      void run(async () => {
        if (!await ensureSource()) return;
        await loadParticipation();
        const response = await request({ action: "secure-window", pageFingerprint: fingerprint, sourceVerified: options.sourceVerification });
        if (!response.ok) { setError(response.error); return; }
        message = t("请在独立窗口完成操作，返回后可刷新团队状态。", "Complete the action in the separate window, then refresh team status.");
      });
    });
    overlay.querySelector<HTMLElement>("[data-collab='back-projects']")?.addEventListener("click", () => { if (!busy) void run(async () => { resetReview(); if (!await ensureSource()) return; await loadParticipation(); await refresh(); }); });
    overlay.querySelector<HTMLElement>("[data-collab='unlink']")?.addEventListener("click", event => {
      if (!event.isTrusted || busy || (!unmatchedAddress && !fileMismatch()) || browsingHistory) return;
      void run(async () => {
        const saved = (await chrome.storage.local.get(urlKey))[urlKey];
        if (saved?.participation?.projectId === (unmatchedAddress?.participation.projectId ?? participation?.projectId)) await chrome.storage.local.remove(urlKey);
        resetReview(); projectsView = false; await loadParticipation(); await refresh();
      });
    });
    overlay.querySelectorAll<HTMLElement>("[data-collab-remove-history]").forEach(button => button.addEventListener("click", event => {
      if (!event.isTrusted || busy) return;
      const entry = history[Number(button.dataset.collabRemoveHistory)];
      if (!entry || !window.confirm(t("仅移除此浏览器的本地记录及其页面关联，不删除云端项目，不影响其他协作者。继续？", "Remove this browser's local record and its page links only? Cloud data and collaborators are unaffected."))) return;
      void run(async () => {
        const all = await chrome.storage.local.get(null);
        const keys = Object.entries(all).filter(([key, value]) =>
          (key === STORAGE_PREFIX + entry.fingerprint && value?.projectId === entry.participation.projectId) ||
          (key.startsWith("clickdeck:collaboration-url:v1:") && value?.fingerprint === entry.fingerprint && value?.participation?.projectId === entry.participation.projectId)
        ).map(([key]) => key);
        await chrome.storage.local.remove(keys);
        await loadParticipation();
      });
    }));
    overlay.querySelector<HTMLElement>("[data-collab='refresh']")?.addEventListener("click", () => void run(async () => {
      if (!browsingHistory) {
        if (!await ensureSource()) return;
        await loadParticipation();
      }
      await refresh();
    }));
    overlay.querySelector<HTMLElement>("[data-collab='submit']")?.addEventListener("click", event => { if (event.isTrusted && currentCollaboration()) void openPanel("drafts"); });
    overlay.querySelector<HTMLElement>("[data-collab='backup']")?.addEventListener("click", () => {
      if (snapshot) downloadCollaborationBackup(snapshot, lastSyncedAt || Date.now(), snapshotStale || projectExpired());
    });
    overlay.querySelector<HTMLElement>("[data-collab='team-prompt']")?.addEventListener("click", () => {
      stopPreview(); previewNote = "";
      const chosen = reviewItems.filter(item => selectedReviews.has(item.id));
      const conflict = chosen.find((item, index) => chosen.slice(index + 1).some(other => reviewTasksConflict(item.task, other.task)));
      if (conflict) {
        messageIsError = true;
        message = t(`第 ${conflict.number} 条与其他已选建议冲突，请取消其中一种后导出。`, `Suggestion ${conflict.number} conflicts with another selection. Choose one before exporting.`);
        render(); return;
      }
      if (snapshot && chosen.length) { options.onTeamPrompt(selectedReviewSnapshot(snapshot, reviewItems, selectedReviews)); syncPromptVisibility(); }
    });
  }

  async function submitEdits(): Promise<void> {
    await run(async () => {
      if (!currentCollaboration()) return;
      if (!snapshot || snapshotStale) { setError("network-error"); return; }
      updateDraftItems();
      if (draftError) { setError(draftError); return; }
      const tasks = sharing.selected(draftItems).map(item => item.task);
      if (!tasks.length) { setError("empty"); return; }
      const response = await request({ action: "secure-window", pageFingerprint: fingerprint, tasks, sourceVerified: options.sourceVerification });
      if (!response.ok) { setError(response.error); return; }
      message = t("尚未上传，请在独立窗口核对并确认提交。", "Not uploaded yet. Review and confirm in the separate window.");
    });
  }

  async function openPanel(scope: "team" | "drafts" = "team"): Promise<void> {
      if (busy) return;
      editing = false; paused = false; peekId = ""; collapsed = false;
      reviewScope = scope;
      if (scope === "drafts") allMarkers = true;
      if (overlay) {
        overlay.hidden = false;
        options.host.classList.add("clickdeck-panel--reviewing");
        await run(async () => { if (browsingHistory) resetReview(); reviewScope = scope; projectsView = false; if (!await ensureSource()) return; await loadParticipation(); await refresh(); });
        return;
      }
      fingerprint = await options.pageFingerprint;
      await loadParticipation();
      closePanel();
      overlay = document.createElement("div");
      overlay.className = "clickdeck-collab-overlay";
      overlay.dataset.clickdeck = "true";
      options.host.appendChild(overlay);
      options.host.classList.add("clickdeck-panel--reviewing");
      window.addEventListener("resize", placeBoard);
      promptObserver = new MutationObserver(syncPromptVisibility);
      promptObserver.observe(options.host, { childList: true, subtree: true });
      chrome.runtime?.onMessage?.addListener(onSecureUpdate);
      const status = await request({ action: "status" });
      serviceConfigured = status.ok && "configured" in status.data && status.data.configured;
      if (!serviceConfigured) setError(status.ok ? "not-configured" : status.error);
      await run(async () => { if (await ensureSource()) await loadParticipation(); });
      if (participation) await refresh();
      if (!serviceConfigured && !sourceError) setError(status.ok ? "not-configured" : status.error);
      render();
      syncPromptVisibility();
  }

  return {
    open: openPanel,
    refreshDrafts,
    destroy: closePanel
  };
}
