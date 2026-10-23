// This entry is an extension-origin document, never a web-accessible resource.
import type { CollaborationParticipation, CollaborationResponse } from "./shared/messages";
import type { SharedTask } from "./shared/collaboration-contract";
import { createSubmissionPreview, confirmationSourceLabel } from "./collaboration-submission-preview";
const ticket = location.hash.slice(1);
const content = document.querySelector<HTMLElement>("#content")!;
const status = document.querySelector<HTMLElement>("#status")!;
function showStatus(text: string, tone: "info" | "error" | "success" = "info") {
  if (!status.isConnected) content.before(status);
  status.textContent = text;
  status.dataset.tone = tone;
}
const messages: Record<string, string> = {
  'source-url-missing': '浏览器未提供来源地址，请从工具栏ClickDeck图标重新打开。',
  'source-permission-check-failed': '文件访问权限查询失败，请重新加载扩展并刷新原页面。',
  'source-fetch-failed': '浏览器无法读取原文件，请检查文件位置及扩展的本地文件访问权限。',
  'source-stream-failed': '原文件读取中断，请返回原页面重新核验。',
  'source-hash-failed': '原文件已读取，但校验码计算失败，请返回原页面重新核验。',
  'source-file-permission': '此扩展未获本地文件访问权限，请在扩展详情开启“允许访问文件网址”，刷新HTML后重新打开。',
  'source-too-large': '原始HTML超过当前64 MiB核验上限，这不是权限或Google登录错误。',
  'source-invalid-encoding': '原始文件不是有效UTF-8编码，无法核验。',
  'source-not-html': '未识别到完整HTML文档开头，无法核验。',
  'source-http-error': '原网页读取返回错误或空响应，请检查页面访问状态。',
  'source-timeout': '读取原文件超时，请重新打开窗口后重试。',
  'identity-link-disabled': '服务端尚未启用身份关联。请在Supabase认证设置启用 Allow manual linking 后重试；旧身份和项目记录已保留。',
  'identity-link-conflict': '该Google账号已属于其他协作身份，未覆盖当前身份或转移旧项目。请换一个尚未绑定的Google账号，或等待明确的账户合并处理。',
  'identity-link-failed': '当前身份关联Google未完成，旧身份已保留，请核对服务配置后重试。',
  'google-login-required': '创建项目需要先使用Google登录。若提示已有旧协作身份，请保留数据，等待身份关联升级；加入他人项目不要求Google登录。',
  'oauth-permission-required': '此扩展尚未获得Google登录所需的identity权限。请到扩展管理页确认加载的是新版目录，并检查是否有待确认的新增权限；无需卸载或清除数据。',
  'identity-link-required': '当前浏览器已有协作身份。为保留旧项目权限，暂不能直接切换Google账号，请等待身份关联升级；本地记录已保留。',
  'identity-changed': '协作身份已变化，请关闭窗口后重新核对。',
  'oauth-cancelled': '已取消Google登录。',
  'oauth-failed': 'Google登录未完成，请核对网络及登录回调配置后重试。',
  'oauth-exchange-failed': '登录验证未完成，请核对Supabase回调配置后重试。',
  "service-disabled": "云端协作暂已关闭或访问被限制。离线编辑仍可使用，请勿反复提交。",
  "not-configured": "当前构建未配置协作服务。请使用已配置构建；已填写的内容会保留。",
  "request-expired": "窗口已失效或来源页面已变化，请关闭后重新打开。",
  "network-error": "连接失败，身份已保留。如果已点击确认，请先返回刷新团队状态，核实是否已成功，避免重复提交。",
  "identity-storage-failed": "浏览器未能保存协作身份，已停止后续操作。请保留当前窗口并重试，不要清除扩展数据。",
  "guest-registration-uncertain": "上次加入的身份凭据未能确认，已暂停重复注册；服务器可能已占用一个成员名额。此情况不能保证自动恢复，请通过下方入口联系维护者协助核对。请勿清除扩展数据或反复尝试；本地编辑和导出仍可用。",
  "session-expired": "之前的协作连接已失效，本地修改仍保留。可点击下方按钮恢复使用。",
  "rate-limit": "操作太频繁，请稍后重试。",
  "invalid-input": "请完整填写名称等信息。", "invalid-invite": "邀请码无效，请检查。",
  "fingerprint-mismatch": "当前文件与项目不一致，请打开同一份原始 HTML。",
  "project-limit": "此浏览器身份已有 3 个有效创建项目，请等待其中一个到期；加入他人项目不占创建名额。", "service-capacity": "当前协作项目名额已满，请稍后重试。本地编辑不受影响。",
  "payload-limit": "项目建议内容超过容量。", "task-limit": "项目已达到 100 条任务上限。",
  "invalid-tasks": "建议数据异常，已阻止提交。", "member-limit": "项目已满 6 人。",
  "project-expired": "项目已过期，原关联记录仍保留。", "project-not-found": "当前身份暂时读不到项目，可能无权访问或已经过期；原关联记录仍保留。",
  "member-not-found": "当前身份不是此项目成员。旧记录仍保留；请核对身份或使用有效邀请码加入。",
  "project-already-linked": "当前HTML已有关联项目，请返回页面继续审阅。",
  "source-unavailable": "无法读取原始HTML，请核对文件访问权限后重试。",
  "source-changed": "原始HTML已改变，请返回原页面刷新并重新核验。",
  "migration-required": "服务尚未部署所需协作升级；原有项目和建议仍保留。",
};
const send = (command: string, data: Record<string, unknown> = {}) => chrome.runtime.sendMessage({ type: "CLICKDECK_SECURE_COLLABORATION", ticket, command, ...data });
function showError(error: string) {
  showStatus(messages[error] ?? "暂时无法完成，请重试。", "error");
  document.querySelector('#guest-support')?.remove();
  if (error === 'guest-registration-uncertain') {
    const help = document.createElement('p'); help.id = 'guest-support';
    const link = document.createElement('a');
    link.href = 'https://github.com/ningsiii/ClickDeck/issues';
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = '联系维护者 / Get help';
    help.append(link, '（公开反馈）：只提供扩展版本、浏览器版本、发生时间和错误码 guest-registration-uncertain。不要公开邀请码、登录令牌、原始 HTML 或含隐私的截图。人工核对不保证恢复原身份或立即释放名额。');
    status.after(help);
  }
  if (error !== "session-expired" || document.querySelector("#recover-identity")) return;
  const recovery = document.createElement("section"); recovery.id = "recover-identity";
  const label = document.createElement("label");
  const check = document.createElement("input"); check.type = "checkbox";
  label.append(check, "我了解：会先尝试恢复原身份；若已无法恢复，将建立新身份。本地修改和旧项目记录不删除，但旧项目权限不会自动继承，加入旧项目需有效邀请码；旧创建者权限不能据此恢复。");
  const button = document.createElement("button"); button.textContent = "恢复协作使用 / Recover";
  button.addEventListener("click", async event => {
    if (!event.isTrusted || pending) return;
    if (!check.checked) { showStatus("请先阅读并勾选恢复说明。", "error"); return; }
    pending = true; button.disabled = true;
    const draft = content.querySelector("form") ? new FormData(content.querySelector("form")!) : null;
    try {
      const result = await send("recover", { consent: true });
      if (!result.ok) { showError(result.error); return; }
      content.replaceChildren();
      const ready = await start();
      for (const name of ["title", "name", "invite"]) {
        const input = content.querySelector<HTMLInputElement>(`[name="${name}"]`);
        if (input && draft) input.value = String(draft.get(name) ?? "");
      }
      if (ready && content.querySelector("form")) showStatus("现在可以创建或加入项目。本地修改未删除；如需继续旧项目，请使用有效邀请码加入。", "success");
    } catch { showError("network-error"); }
    finally { pending = false; button.disabled = false; }
  });
  recovery.append(label, button); content.append(recovery);
}
function invitation(p: CollaborationParticipation, code: string) {
  content.replaceChildren();
  const title = document.createElement("h2"); title.textContent = p.projectTitle;
  const text = document.createElement("textarea"); text.readOnly = true; text.rows = 7;
  text.value = `请审阅「${p.projectTitle}」：\n先打开我发来的原始 HTML，使用 ClickDeck 协作窗口加入项目。\n邀请码：${code}\n完成编辑后在独立窗口确认提交。\n截止时间：${new Date(p.expiresAt).toLocaleString()}。加入、提交、刷新均不续期；请在到期前提交并导出团队建议。`;
  const copy = document.createElement("button"); copy.textContent = "复制邀请说明 / Copy invitation";
  copy.addEventListener("click", async event => { if (!event.isTrusted) return; await navigator.clipboard.writeText(text.value); showStatus("已复制，请连同原始 HTML 一起发给协作者。", "success"); });
  content.append(title, text, copy);
}
let pending = false;
let creatorReady = false;
function syncCreateButton() {
  const button = content.querySelector<HTMLButtonElement>('button[value="create"]');
  if (button) { button.disabled = pending || !creatorReady; button.hidden = !creatorReady || content.querySelector('[data-mode="join"]')?.getAttribute('aria-pressed') === 'true'; }
}
async function execute(command: string, data: Record<string, unknown>) {
  if (pending) return; pending = true;
  content.querySelectorAll<HTMLButtonElement>("button").forEach(b => b.disabled = true);
  try {
    const result: CollaborationResponse = await send(command, { ...data, consent: true });
    if (!result.ok) { showError(result.error); return; }
    showStatus(command === "submit" ? "已完成：已提交团队。其他成员刷新后可见。" : "已完成。可关闭此窗口，回到原页面查看团队状态。", "success");
    content.replaceChildren();
    content.before(status);
    if ("participation" in result.data && result.data.participation.inviteCode) invitation(result.data.participation, result.data.participation.inviteCode);
  } catch { showError("network-error"); }
  finally { pending = false; content.querySelectorAll<HTMLButtonElement>("button").forEach(b => b.disabled = false); syncCreateButton(); }
}
async function start() {
  let result = await send("view");
  // windows.create may finish registering its tab after the document starts.
  if (!result.ok && result.error === "request-expired") { await new Promise(resolve => setTimeout(resolve, 150)); result = await send("view"); }
  if (!result.ok) { showError(result.error); return; }
  const data = result.data as { url: string; tasks?: SharedTask[]; participation?: CollaborationParticipation; invite?: string; connectionError?: string; creatorReady?: boolean; upgradeProjectId?: string };
  creatorReady = data.creatorReady === true && !data.connectionError;
  document.querySelector("#page")!.textContent = data.url;
  const sourceLabel = document.querySelector<HTMLElement>("#source-label")!;
  sourceLabel.title = data.url;
  sourceLabel.textContent = confirmationSourceLabel(data.url);
  showStatus("");
  if (data.upgradeProjectId) {
    const title = document.createElement("h2"); title.textContent = `升级旧项目：${data.participation?.projectTitle ?? ""}`;
    const label = document.createElement("label"); const check = document.createElement("input"); check.type = "checkbox";
    label.append(check, "我确认：当前原始HTML是该项目的审阅基准。升级保留所有成员和建议；旧建议可能无法在此版本定位。此操作不把当前预览或ClickDeck修改保存为原始版本。");
    const button = document.createElement("button"); button.textContent = "确认升级文件识别";
    button.addEventListener("click", event => { if (event.isTrusted && check.checked) void execute("upgrade-source", {}); });
    content.replaceChildren(title,label,button);
    if (data.connectionError) { showError(data.connectionError); button.disabled = true; }
    return !data.connectionError;
  }
  if (data.tasks) {
    const heading = document.createElement("h2"); heading.textContent = `分享给「${data.participation?.projectTitle}」：已选 ${data.tasks.length} 项修改`;
    const preview = createSubmissionPreview(data.tasks);
    const consent = document.createElement("label");
    const check = document.createElement("input"); check.type = "checkbox";
    consent.append(check, `我已核对，将这些结构化修改发送到协作服务。项目截止：${new Date(data.participation?.expiresAt ?? 0).toLocaleString()}；提交不续期，请在到期前备份。`);
    const submit = document.createElement("button"); submit.className = "primary"; submit.textContent = "确认提交 / Submit";
    submit.addEventListener("click", event => { if (event.isTrusted && check.checked) void execute("submit", {}); else showStatus("请先核对并勾选同意。", "error"); });
    content.append(heading, preview, consent, submit);
    if (data.connectionError) { showError(data.connectionError); submit.disabled = true; }
    return !data.connectionError;
  }
  if (data.participation) {
    if (data.connectionError) { showError(data.connectionError); return false; }
    if (data.participation.role === "owner" && data.invite) { invitation(data.participation, data.invite); return true; }
    const heading = document.createElement("h2"); heading.textContent = data.participation.projectTitle;
    const note = document.createElement("p"); note.textContent = "你已加入此项目。请返回原HTML编辑并提交修改；无需重复创建或加入。";
    content.replaceChildren(heading, note); return true;
  }
  content.innerHTML = `<form><label>项目名称（创建时填写）<input name="title" maxlength="120"></label><label>你的显示名称<input name="name" maxlength="60" required></label><label>邀请码（加入时填写）<input name="invite" autocomplete="off" maxlength="160"></label><label><input name="consent" type="checkbox" required>我同意发送项目名称、匿名身份、页面指纹及主动提交的修改意见；不会上传完整 HTML。新项目自创建起固定 48 小时，加入、提交、刷新不续期；旧项目保留原截止时间。每个浏览器身份同时最多创建 3 个有效项目，加入不占创建名额。</label><p id="join-deadline" role="status"></p><button class="primary" type="submit" value="create">创建项目 / Create</button><button type="submit" value="join">核对截止时间 / Join</button></form>`;
  let checkedInvite = "";
  content.querySelector("form")!.addEventListener("input", () => {
    checkedInvite = "";
    content.querySelector("#join-deadline")!.textContent = "";
    content.querySelector('button[value="join"]')!.textContent = "核对截止时间 / Join";
  });
  content.querySelector("form")!.addEventListener("submit", async event => {
    event.preventDefault(); if (!event.isTrusted) return;
    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const command = (event.submitter as HTMLButtonElement)?.value;
    if (command === 'create' && !creatorReady) { showError('google-login-required'); return; }
    if (command === "join" && checkedInvite !== String(values.get("invite"))) {
      if (pending) return;
      pending = true;
      const button = event.submitter as HTMLButtonElement; button.disabled = true;
      try {
        const result: CollaborationResponse = await send("preview-join", { invite: values.get("invite"), consent: true });
        if (!result.ok) { showError(result.error); return; }
        if (!("inviteExpiresAt" in result.data)) { showError("migration-required"); return; }
        const expiry = result.data.inviteExpiresAt;
        if (expiry <= Date.now()) { showError("project-expired"); return; }
        // If the user edits while the read is in flight, require another preflight.
        if (form.querySelector<HTMLInputElement>('[name="invite"]')!.value !== values.get("invite")) return;
        checkedInvite = String(values.get("invite"));
        content.querySelector("#join-deadline")!.textContent = `项目截止：${new Date(expiry).toLocaleString()}；剩余约 ${Math.max(1, Math.ceil((expiry - Date.now()) / 60000))} 分钟。加入不会续期，请再次点击确认加入。`;
        button.textContent = "确认加入 / Join";
      } catch { showError("network-error"); }
      finally { pending = false; button.disabled = false; }
      return;
    }
    void execute(command, { title: values.get("title"), name: values.get("name"), invite: values.get("invite") });
  });
  if (data.connectionError) showError(data.connectionError);
  const form = content.querySelector("form")!;
  const modeBar = document.createElement("div");
  const setMode = (mode: "create" | "join") => {
    form.querySelector<HTMLInputElement>('[name="title"]')!.closest("label")!.hidden = mode !== "create";
    form.querySelector<HTMLInputElement>('[name="title"]')!.required = mode === "create";
    form.querySelector<HTMLInputElement>('[name="invite"]')!.closest("label")!.hidden = mode !== "join";
    form.querySelector<HTMLInputElement>('[name="invite"]')!.required = mode === "join";
    form.querySelectorAll<HTMLButtonElement>('button[type="submit"]').forEach(button => button.hidden = button.value !== mode);
    modeBar.querySelectorAll("button").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
    login.hidden = mode !== 'create' || creatorReady;
    loginHint.hidden = mode !== 'create';
    loginHint.textContent = creatorReady ? '✓ 已登录 Google' : '创建项目需要登录；登录成功后，再确认创建。';
    syncCreateButton();
  };
  for (const mode of ["create", "join"] as const) {
    const button = document.createElement("button"); button.type = "button"; button.dataset.mode = mode;
    button.textContent = mode === "create" ? "创建项目" : "加入项目";
    button.addEventListener("click", () => setMode(mode)); modeBar.append(button);
  }
  const login = document.createElement('button'); login.type = 'button';
  const loginHint = document.createElement('p');
  login.className = 'primary';
  login.textContent = '使用 Google 登录以继续';
  loginHint.textContent = '已有本机协作身份时，将关联Google并保留原身份；不会自动合并其他账户。';
  login.addEventListener('click', async event => {
    if (!event.isTrusted || pending) return;
    pending = true; login.disabled = true; login.textContent = '正在登录…'; showStatus('');
    try {
      const response = await send('login-google', { consent: true });
      if (!response.ok) showError(response.error);
      else { creatorReady = true; login.hidden = true; loginHint.textContent = '✓ 已登录 Google'; showStatus('请核对项目信息，再点击创建项目。', 'success'); }
    } catch { showError('network-error'); }
    finally { pending = false; login.disabled = false; login.textContent = '使用 Google 登录以继续'; syncCreateButton(); }
  });
  form.before(modeBar);
  form.querySelector('button[value="create"]')!.before(loginHint, status, login);
  setMode("create");
  return !data.connectionError;
}
document.querySelector("#close")!.addEventListener("click", () => window.close());
void start().catch(() => showError("network-error"));
