import type { CollaborationReviewItem } from "./collaboration-review";

const properties: Record<string, string> = {
  fontSize: "font-size", fontWeight: "font-weight", color: "color",
  backgroundColor: "background-color", textAlign: "text-align",
  lineHeight: "line-height", letterSpacing: "letter-spacing", opacity: "opacity"
};

export type ReviewPreview = { restore: () => void };

// Never execute collaborator HTML, load a replacement image, or apply layout
// coordinates. The caller restores previews before any editor action/export.
export function startReviewPreview(item: CollaborationReviewItem, root: Document = document): ReviewPreview | null {
  const task = item.task;
  if (!item.locator || /[{};]/.test(item.locator)) return null;
  let matches: NodeListOf<Element>;
  try { matches = root.querySelectorAll(item.locator); } catch { return null; }
  const target = matches[0];
  if (matches.length !== 1 || !(target instanceof HTMLElement) || target.closest("[data-clickdeck], [contenteditable]")) return null;
  if (task.locator?.tagName && task.locator.tagName.toLowerCase() !== target.tagName.toLowerCase()) return null;
  if (!/^(H[1-6]|P|SPAN|DIV|A|BUTTON|LI|STRONG|EM|SMALL|LABEL|TD|TH|SECTION|ARTICLE)$/.test(target.tagName)) return null;
  const current = (target.textContent ?? "").trim();
  const hint = task.locator?.textSnippet?.trim();
  // nth-of-type alone is not sufficient evidence for modifying a live target.
  const anchored = Boolean(task.locator?.idHint && target.id === task.locator.idHint)
    || Boolean(hint && current.includes(hint))
    || Boolean(task.kind === "content" && task.before !== undefined && current === task.before.trim());
  if (!anchored) return null;
  if (task.kind === "content") {
    if (target.children.length || task.after === undefined || task.before === undefined || current !== task.before.trim()) return null;
    const before = target.textContent;
    target.textContent = task.after;
    return { restore: () => { if (target.textContent === task.after) target.textContent = before; } };
  }
  if (task.kind !== "style" || !task.property || !properties[task.property] || !task.after) return null;
  const value = task.after.trim();
  if (!/^[a-zA-Z0-9#.,%() +\-]+$/.test(value) || /url|var|env|expression|calc/i.test(value)) return null;
  if (task.property === "fontSize" && (!/^\d+(\.\d+)?px$/.test(value) || Number.parseFloat(value) < 4 || Number.parseFloat(value) > 256)) return null;
  if (task.property === "opacity" && (!/^\d*(\.\d+)?$/.test(value) || Number(value) < 0.1 || Number(value) > 1)) return null;
  const property = properties[task.property];
  if (target.style.getPropertyPriority(property) === "important") return null;
  if (task.property === "letterSpacing" && (!/^-?\d+(\.\d+)?px$/.test(value) || Number.parseFloat(value) < -5 || Number.parseFloat(value) > 20)) return null;
  if (task.property === "lineHeight" && value !== "normal" && (!/^\d+(\.\d+)?(px)?$/.test(value) || Number.parseFloat(value) <= 0 || Number.parseFloat(value) > (value.endsWith("px") ? 256 : 6))) return null;
  if (!root.defaultView?.CSS?.supports(property, value)) return null;
  const style = root.createElement("style");
  style.dataset.clickdeck = "true";
  style.textContent = `${item.locator} { ${property}: ${value} !important; transition: none !important; }`;
  root.head.appendChild(style);
  return { restore: () => style.remove() };
}
