import type { SharedTask } from "./shared/collaboration-contract";

const properties: Record<string, string> = {
  fontSize: "字号", fontWeight: "字重", color: "文字颜色", backgroundColor: "背景颜色",
  textAlign: "对齐", lineHeight: "行高", letterSpacing: "字距", opacity: "透明度",
  fontFamily: "字体", width: "宽度", height: "高度", borderColor: "边框颜色", borderRadius: "圆角",
  padding: "内边距", margin: "外边距", transform: "变换", textDecoration: "文字装饰", boxShadow: "阴影"
};
const clip = (text: string, limit = 100): string => text.length > limit ? text.slice(0, limit) + "…" : text;

export function confirmationSourceLabel(raw: string): string {
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname.split("/").filter(Boolean).slice(-2).map(part => {
      try { return decodeURIComponent(part); } catch { return part; }
    }).join("/");
    if (parsed.protocol === "file:") return `本地文件 · ${path}`;
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return `${parsed.origin} · ${path}`;
  } catch { /* Display only: never navigate or fetch a supplied address. */ }
  return raw;
}

// This is a view of the approved payload, never a transformed submission.
// Collaborator strings are always text, including URLs and HTML-looking values.
export function createSubmissionPreview(tasks: readonly SharedTask[], doc: Document = document): HTMLElement {
  const section = doc.createElement("section"); section.className = "submission-preview";
  section.setAttribute("aria-label", "待提交修改清单");
  const list = doc.createElement("ol"); list.className = "submission-list";
  for (const task of tasks) {
    const item = doc.createElement("li"); item.className = "submission-item";
    const title = doc.createElement("span"); title.className = "submission-kind";
    const property = task.property || "样式修改";
    title.textContent = task.kind === "style" ? (Object.hasOwn(properties, property) ? properties[property] : property)
      : ({ content: "文字修改", attribute: "图片替换", move: "移动建议", remove: "删除建议", intent: "修改意见" } as const)[task.kind];
    const target = doc.createElement("span"); target.className = "submission-target";
    const targetText = task.locator?.textSnippet || task.locator?.descriptor || task.locator?.tagName || task.source?.contents[0] || task.summary;
    target.textContent = clip(targetText);
    const region = task.source?.anchor.label || task.locator?.semanticAncestor || task.locator?.parentDescriptor;
    if (region) target.textContent = clip(region, 70) + " · " + target.textContent;
    target.title = (region ? region + " · " : "") + targetText;
    const change = doc.createElement("span"); change.className = "submission-change";
    let fullText: string;
    if (task.kind === "style" || task.kind === "content" || task.kind === "attribute") {
      const before = task.before === undefined || task.before === "" ? "原值未记录" : task.before;
      const after = task.after === undefined ? "新值未记录" : task.after === "" ? (task.kind === "style" ? "清除此项内联样式" : task.kind === "attribute" ? "空地址" : "空内容") : task.after;
      change.textContent = clip(before) + " → " + clip(after);
      fullText = "修改前：" + before + "\n修改后：" + after;
    } else {
      const intent = task.source?.userIntent || task.summary;
      change.textContent = clip(intent, 160);
      fullText = intent;
      if (task.kind === "move") {
        const destination = task.target?.anchor.label || task.target?.contents[0];
        const note = doc.createElement("p"); note.className = "submission-note";
        note.textContent = destination ? "目标区域：" + clip(destination) : "目标位置未明确记录，请核对原页面。";
        item.append(note);
        fullText += "\n目标区域：" + (destination ?? "未记录");
      }
    }
    const full = doc.createElement("details"); full.className = "submission-full";
    const summary = doc.createElement("summary"); summary.className = "submission-row";
    summary.setAttribute("aria-label", title.textContent + "：" + change.textContent + "；" + target.textContent + "；展开完整修改内容");
    const headline = doc.createElement("span"); headline.className = "submission-headline";
    change.title = change.textContent;
    headline.append(title, change); summary.append(headline, target);
    const text = doc.createElement("p"); text.textContent = "目标：" + target.title + "\n" + fullText;
    full.append(summary, text);
    if (task.kind === "attribute" || task.kind === "move" || task.kind === "remove") {
      const note = doc.createElement("p"); note.className = "submission-note";
      note.textContent = task.kind === "attribute" ? "图片替换仅显示说明，此窗口不加载图片。" : "这是修改建议，不代表网页已被移动或删除。";
      item.append(note);
    }
    // Extra notes belong to the expanded detail, not a third default row.
    for (const note of Array.from(item.querySelectorAll(".submission-note"))) full.append(note);
    item.replaceChildren(full); list.append(item);
  }
  const raw = doc.createElement("details"); raw.className = "submission-raw";
  const rawTitle = doc.createElement("summary"); rawTitle.textContent = "查看原始数据（JSON）";
  const pre = doc.createElement("pre"); pre.textContent = JSON.stringify(tasks, null, 2);
  raw.append(rawTitle, pre); section.append(list, raw);
  return section;
}
