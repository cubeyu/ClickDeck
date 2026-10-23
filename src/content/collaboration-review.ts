import type { SharedProjectSnapshot, SharedTask } from "../shared/collaboration-contract";
import { collectCompactedTeamTasks } from "../export/team-prompt";

export type CollaborationReviewItem = {
  id: string;
  number: number;
  contributorId: string;
  contributor: string;
  task: SharedTask;
  sourceIds: string[];
  locator?: string;
  targetLabel: string;
  description: string;
  conflict: boolean;
};

export type CollaborationReviewResult =
  | { ok: true; items: CollaborationReviewItem[] }
  | { ok: false; reason: "empty" | "unsafe-task" };

function locatorFor(task: SharedTask): string | undefined {
  return task.locator?.cssPath || task.source?.anchor.locator?.cssPath || undefined;
}

function targetLabelFor(task: SharedTask, language: "zh" | "en"): string {
  return task.locator?.descriptor
    || task.source?.anchor.label
    || task.source?.contents[0]
    || task.summary
    || (language === "zh" ? "未命名区域" : "Unnamed region");
}

function propertyLabel(property: string, language: "zh" | "en"): string {
  const labels: Record<string, { zh: string; en: string }> = {
    fontSize: { zh: "字号", en: "Font size" },
    fontWeight: { zh: "字重", en: "Font weight" },
    color: { zh: "文字颜色", en: "Text color" },
    backgroundColor: { zh: "背景颜色", en: "Background color" },
    textAlign: { zh: "对齐", en: "Alignment" },
    lineHeight: { zh: "行高", en: "Line height" },
    letterSpacing: { zh: "字距", en: "Letter spacing" },
    opacity: { zh: "透明度", en: "Opacity" }
  };
  return labels[property]?.[language] ?? property;
}

function value(value: string | undefined, language: "zh" | "en"): string {
  return value === undefined || value === "" ? (language === "zh" ? "默认值" : "default") : value;
}

function descriptionFor(task: SharedTask, target: string, language: "zh" | "en"): string {
  if (task.kind === "style") return `${target} · ${propertyLabel(task.property ?? "style", language)} → ${value(task.after, language)}`;
  if (task.kind === "content") return `${target} · ${language === "zh" ? "文字" : "Text"} → ${value(task.after, language)}`;
  if (task.kind === "attribute") return `${target} · ${task.attribute ?? "attribute"} → ${value(task.after, language)}`;
  if (task.kind === "move") return `${language === "zh" ? "移动" : "Move"} · ${task.summary}`;
  if (task.kind === "remove") return `${language === "zh" ? "删除" : "Remove"} · ${task.summary}`;
  return task.summary;
}

function conflictKey(task: SharedTask): string | null {
  const locator = locatorFor(task);
  if (!locator) return null;
  if (task.kind === "style" && task.property) return `style\u0000${locator}\u0000${task.property}`;
  if (task.kind === "content") return `content\u0000${locator}`;
  if (task.kind === "attribute" && task.attribute) return `attribute\u0000${locator}\u0000${task.attribute}`;
  return null;
}

export function reviewTasksConflict(a: SharedTask, b: SharedTask): boolean {
  const locator = locatorFor(a);
  if (!locator || locator !== locatorFor(b)) return false;
  if ([a.kind, b.kind].some(kind => kind === "remove" || kind === "move")) return true;
  return Boolean(conflictKey(a) && conflictKey(a) === conflictKey(b) && a.after !== b.after);
}

export function selectedReviewSnapshot(snapshot: SharedProjectSnapshot, items: CollaborationReviewItem[], selected: Set<string>): SharedProjectSnapshot {
  const sources = new Set(items.filter(item => selected.has(item.id)).flatMap(item => item.sourceIds));
  return { ...snapshot, submissions: snapshot.submissions.map(submission => ({
    ...submission, tasks: submission.tasks.filter(task => sources.has(`${submission.id}/${task.id}`))
  })).filter(submission => submission.tasks.length > 0) };
}

export function buildCollaborationReviewItems(snapshot: SharedProjectSnapshot, language: "zh" | "en"): CollaborationReviewResult {
  const collected = collectCompactedTeamTasks(snapshot);
  if (!collected.ok) return { ok: false, reason: collected.reason };
  const conflictGroups = new Map<string, { values: Set<string>; contributors: Set<string> }>();
  collected.tasks.forEach(({ submission, task }) => {
    const key = conflictKey(task);
    if (!key) return;
    const group = conflictGroups.get(key) ?? { values: new Set<string>(), contributors: new Set<string>() };
    group.values.add(JSON.stringify(task.after));
    group.contributors.add(submission.memberId || submission.memberDisplayName);
    conflictGroups.set(key, group);
  });
  return {
    ok: true,
    items: collected.tasks.map(({ submission, task, sourceIds }, index) => {
      const targetLabel = targetLabelFor(task, language);
      const key = conflictKey(task);
      const conflictGroup = key ? conflictGroups.get(key) : undefined;
      return {
        id: `${submission.memberId || submission.memberDisplayName}:${sourceIds.join("|")}`,
        number: index + 1,
        contributorId: submission.memberId,
        contributor: submission.memberDisplayName,
        task,
        sourceIds,
        locator: locatorFor(task),
        targetLabel,
        description: descriptionFor(task, targetLabel, language),
        conflict: Boolean(conflictGroup && conflictGroup.contributors.size > 1 && conflictGroup.values.size > 1)
          || collected.tasks.some(other => other.task !== task && reviewTasksConflict(task, other.task))
      };
    })
  };
}

export function resolveCollaborationReviewTarget(item: CollaborationReviewItem, root: Document = document): Element | null {
  if (!item.locator) return null;
  try {
    const matches = root.querySelectorAll(item.locator);
    if (matches.length !== 1) return null;
    const element = matches[0];
    return element instanceof Element && !element.closest("[data-clickdeck]") ? element : null;
  } catch {
    return null;
  }
}

export type VisibleCollaborationReviewTarget = {
  element: Element;
  rect: DOMRect;
};

export function reviewLocation(item: CollaborationReviewItem, language: "zh" | "en", allowLocal = true): string {
  const zh = language === "zh";
  const target = allowLocal ? resolveCollaborationReviewTarget(item) : null;
  if (target) {
    // Only explicit slide structures qualify as page numbers; never count arbitrary sections.
    for (const selector of [".slide", "[data-slide]", '[aria-roledescription="slide"]', ".deck > section"]) {
      const slides = Array.from(target.ownerDocument.querySelectorAll(selector)).filter(el => !el.closest("[data-clickdeck]"));
      const index = slides.findIndex(el => el.contains(target));
      if (slides.length > 1 && index >= 0) {
        const title = slides[index].querySelector("h1,h2,h3")?.textContent?.trim().slice(0, 60);
        return `${zh ? `第 ${index + 1} 页（结构顺序）` : `Page ${index + 1} (document order)`}${title ? ` · ${title}` : ""}`;
      }
    }
    const section = target.closest("section,article,[role='region']");
    const title = section?.getAttribute("aria-label") || section?.querySelector("h1,h2,h3")?.textContent?.trim();
    if (title) return `${zh ? "区域" : "Section"} · ${title.slice(0, 80)}`;
    return zh ? "当前文档 · 无明确分页" : "Current document · no explicit pages";
  }
  const recorded = item.task.source?.anchor.label || item.task.locator?.semanticAncestor || item.task.locator?.parentDescriptor;
  return recorded ? `${zh ? "提交时区域" : "Recorded region"} · ${recorded}` : zh ? "页码／位置未能确认" : "Page / location unconfirmed";
}

export function reviewChangeSummary(item: CollaborationReviewItem): string {
  const prefix = `${item.targetLabel} · `;
  return item.description.startsWith(prefix) ? item.description.slice(prefix.length) : item.description;
}

export function canScrollReviewTarget(target: Element): boolean {
  for (let ancestor: Element | null = target; ancestor; ancestor = ancestor.parentElement) {
    const style = target.ownerDocument.defaultView?.getComputedStyle(ancestor);
    if (ancestor.hasAttribute("hidden") || ancestor.getAttribute("aria-hidden") === "true"
      || ancestor.classList.contains("clickdeck-presentation-hidden-slide") || style?.display === "none"
      || style?.visibility === "hidden" || style?.opacity === "0") return false;
  }
  return true;
}

export function getVisibleCollaborationReviewTarget(
  item: CollaborationReviewItem,
  root: Document = document
): VisibleCollaborationReviewTarget | null {
  const element = resolveCollaborationReviewTarget(item, root);
  if (!element || !element.isConnected) return null;
  const view = root.defaultView;
  if (!view) return null;
  let ancestor: Element | null = element;
  while (ancestor) {
    if (ancestor.hasAttribute("hidden") || ancestor.getAttribute("aria-hidden") === "true" || ancestor.classList.contains("clickdeck-presentation-hidden-slide")) return null;
    const style = view.getComputedStyle(ancestor);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number.parseFloat(style.opacity || "1") === 0) return null;
    ancestor = ancestor.parentElement;
  }
  let rect = element.getBoundingClientRect();
  const region = !item.task.locator && item.task.source?.anchor.kind !== "document" ? item.task.source?.relativeBox : undefined;
  if (region) {
    if (![region.left, region.top, region.width, region.height].every(Number.isFinite)
      || region.left < 0 || region.top < 0 || region.width <= 0 || region.height <= 0
      || region.left + region.width > 100.01 || region.top + region.height > 100.01) return null;
    rect = new DOMRect(rect.left + rect.width * region.left / 100, rect.top + rect.height * region.top / 100,
      rect.width * region.width / 100, rect.height * region.height / 100);
  }
  if (rect.width <= 0 || rect.height <= 0) return null;
  const viewportWidth = view.innerWidth || root.documentElement.clientWidth;
  const viewportHeight = view.innerHeight || root.documentElement.clientHeight;
  if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= viewportHeight || rect.left >= viewportWidth) return null;
  return { element, rect };
}
