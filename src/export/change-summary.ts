import type { EditorPatch } from "../state/editor-state";
import { getSlideContext } from "../content/dom-utils";

export type PromptBuildResult =
  | { ok: true; prompt: string; hasImageReplacement: boolean }
  | { ok: false; reason: "empty"; message: string };

export type PromptLanguage = "en" | "zh";

export type PromptPageContext = {
  url: string;
  title: string;
};

export type PromptBuildOptions = {
  language: PromptLanguage;
  page: PromptPageContext;
};

const EMPTY_MESSAGE_EN = "No edits to summarize yet. Make some changes first.";
const EMPTY_MESSAGE_ZH = "当前没有可总结的修改，请先在页面上做一些调整。";

export type PromptChangeGroup = {
  key: string;
  target: string;
  locator: string;
  slideContext?: string;
  styleChanges: Map<string, { before: string; after: string }>;
  textChange?: { before: string; after: string };
  attributeChanges: Map<string, { before: string; after: string }>;
  firstSeenAt: number;
};

export function groupPromptChanges(patches: EditorPatch[]): PromptChangeGroup[] {
  const groups = new Map<string, PromptChangeGroup>();

  for (const patch of patches) {
    const locator = patch.targetLocator;
    if (!locator) continue;

    const key = locator.cssPath || locator.nthOfTypePath || patch.targetDescriptor;
    if (!key) continue;

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        target: locator.descriptor || patch.targetDescriptor,
        locator: locator.cssPath || locator.nthOfTypePath,
        slideContext: getSlideContext(patch.targetElement),
        styleChanges: new Map(),
        attributeChanges: new Map(),
        firstSeenAt: patch.createdAt || Date.now()
      };
      groups.set(key, group);
    }

    if (patch.kind === "style") {
      const existing = group.styleChanges.get(patch.property);
      if (existing) {
        existing.after = patch.after;
      } else {
        group.styleChanges.set(patch.property, { before: patch.before, after: patch.after });
      }
    } else if (patch.kind === "content") {
      if (group.textChange) {
        group.textChange.after = patch.after;
      } else {
        group.textChange = { before: patch.before, after: patch.after };
      }
    } else if (patch.kind === "attribute") {
      const existing = group.attributeChanges.get(patch.attribute);
      if (existing) {
        existing.after = patch.after;
      } else {
        group.attributeChanges.set(patch.attribute, { before: patch.before, after: patch.after });
      }
    }
  }

  const result: PromptChangeGroup[] = [];
  
  for (const group of Array.from(groups.values()).sort((a, b) => a.firstSeenAt - b.firstSeenAt)) {
    // Prune squashed out changes
    for (const [prop, change] of Array.from(group.styleChanges.entries())) {
      if (change.before === change.after) {
        group.styleChanges.delete(prop);
      }
    }
    
    if (group.textChange && group.textChange.before === group.textChange.after) {
      group.textChange = undefined;
    }
    
    for (const [attr, change] of Array.from(group.attributeChanges.entries())) {
      if (change.before === change.after) {
        group.attributeChanges.delete(attr);
      }
    }
    
    if (group.styleChanges.size > 0 || group.textChange || group.attributeChanges.size > 0) {
      result.push(group);
    }
  }

  return result;
}

export function buildAiEditPrompt(patches: EditorPatch[], options: PromptBuildOptions): PromptBuildResult {
  const isZh = options.language === "zh";

  if (!patches || patches.length === 0) {
    return { ok: false, reason: "empty", message: isZh ? EMPTY_MESSAGE_ZH : EMPTY_MESSAGE_EN };
  }

  const lines: string[] = [];
  lines.push("Please update the source HTML/CSS to match these visual edits.");
  lines.push("Keep all unrelated content, layout, and behavior unchanged.");
  lines.push("Apply the smallest possible code changes.");
  lines.push("");
  lines.push("Page:");
  lines.push(`- URL: ${options.page.url}`);
  lines.push(`- Title: ${options.page.title || "(untitled)"}`);
  lines.push("- Scope: Current active browser page only.");
  lines.push("");
  if (isZh) {
    lines.push("修改列表（Changes）：");
  } else {
    lines.push("Changes:");
  }
  lines.push("");

  const groups = groupPromptChanges(patches);

  if (groups.length === 0) {
    return { ok: false, reason: "empty", message: isZh ? EMPTY_MESSAGE_ZH : EMPTY_MESSAGE_EN };
  }

  let index = 0;
  let hasImageReplacement = false;
  
  for (const group of groups) {
    index += 1;
    lines.push(`${index}. Target: ${group.target}`);
    lines.push(`   Locator: ${group.locator}`);

    if (group.slideContext) {
      if (isZh) {
        lines.push(`   所属页面/Slide: ${group.slideContext}`);
      } else {
        lines.push(`   Slide/Page Context: ${group.slideContext}`);
      }
    }

    if (group.textChange) {
      if (isZh) {
        lines.push(`   文本修改：从 ${quoteSnippet(group.textChange.before)} 改为 ${quoteSnippet(group.textChange.after)}。`);
      } else {
        lines.push(`   Text changed from ${quoteSnippet(group.textChange.before)} to ${quoteSnippet(group.textChange.after)}.`);
      }
    }

    for (const [prop, change] of Array.from(group.styleChanges.entries())) {
      if (isZh) {
        lines.push(`   样式修改：${prop} 从 ${quoteSnippet(change.before)} 改为 ${quoteSnippet(change.after)}。`);
      } else {
        lines.push(`   Style: ${prop} changed from ${quoteSnippet(change.before)} to ${quoteSnippet(change.after)}.`);
      }
    }

    for (const [attr, change] of Array.from(group.attributeChanges.entries())) {
      const after = normalizeAttributeValue(attr, change.after);
      
      if (isZh) {
        lines.push(`   属性修改：${attr} 需要替换为 ${quoteSnippet(after)}。`);
      } else {
        lines.push(`   Attribute: ${attr} should be replaced with ${quoteSnippet(after)}.`);
      }
      
      if (attr === "src") {
        hasImageReplacement = true;
        if (isZh) {
          lines.push(`   如果这份 prompt 没有同时提供图片文件或资源路径，请先向用户索要替换图片，再修改这个 src。`);
        } else {
          lines.push(`   If this prompt does not include an image file or asset path, please ask the user for the replacement image before changing this src.`);
        }
      }
    }
    
    lines.push("");
  }

  lines.push(
    "If multiple elements match the description, use the CSS path or surrounding parent context to identify the target."
  );

  return { ok: true, prompt: lines.join("\n"), hasImageReplacement };
}

function quoteSnippet(value: string): string {
  const raw = (value ?? "").toString().replace(/\s+/g, " ").trim();
  if (!raw) {
    return "\"\"";
  }
  const max = 80;
  const clipped = raw.length > max ? `${raw.slice(0, max - 3)}...` : raw;
  return JSON.stringify(clipped);
}

function normalizeAttributeValue(attribute: string, value: string): string {
  if (attribute !== "src") {
    return value;
  }
  const raw = (value ?? "").toString();
  if (raw.startsWith("data:")) {
    return "[data URL image]";
  }
  return raw;
}

