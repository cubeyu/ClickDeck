import type { EditorPatch } from "../state/editor-state";

export type PromptBuildResult =
  | { ok: true; prompt: string }
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

  let index = 0;
  for (const patch of patches) {
    // Persist/restore may yield patches without locator in edge cases; skip them to keep prompt actionable.
    const locator = patch.targetLocator;
    if (!locator) continue;

    index += 1;
    const target = locator.descriptor || patch.targetDescriptor;
    const locatorText = locator.cssPath || locator.nthOfTypePath;

    lines.push(`${index}. Target: ${target}`);
    lines.push(`   Locator: ${locatorText}`);

    if (patch.kind === "content") {
      if (isZh) {
        lines.push(`   文本修改：从 ${quoteSnippet(patch.before)} 改为 ${quoteSnippet(patch.after)}。`);
      } else {
        lines.push(`   Text changed from ${quoteSnippet(patch.before)} to ${quoteSnippet(patch.after)}.`);
      }
      lines.push("");
      continue;
    }

    if (patch.kind === "style") {
      if (isZh) {
        lines.push(`   样式修改：${patch.property} 从 ${quoteSnippet(patch.before)} 改为 ${quoteSnippet(patch.after)}。`);
      } else {
        lines.push(`   Style: ${patch.property} changed from ${quoteSnippet(patch.before)} to ${quoteSnippet(patch.after)}.`);
      }
      lines.push("");
      continue;
    }

    if (patch.kind === "attribute") {
      const after = normalizeAttributeValue(patch.attribute, patch.after);
      const before = normalizeAttributeValue(patch.attribute, patch.before);
      lines.push(`   Attribute: ${patch.attribute} changed from ${quoteSnippet(before)} to ${quoteSnippet(after)}.`);
      lines.push("");
      continue;
    }
  }

  if (index === 0) {
    return { ok: false, reason: "empty", message: isZh ? EMPTY_MESSAGE_ZH : EMPTY_MESSAGE_EN };
  }

  lines.push(
    "If multiple elements match the description, use the CSS path or surrounding parent context to identify the target."
  );

  return { ok: true, prompt: lines.join("\n") };
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

