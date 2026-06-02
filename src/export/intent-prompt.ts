import { IntentOperation } from "../content/intent-region";
import { RegionContext, summarizeVisualUnit } from "../content/region-context";

export type IntentPromptOptions = {
  language: "en" | "zh";
  page: {
    url: string;
    title: string;
  };
};

export type IntentPromptInput = {
  operation: IntentOperation;
  sourceContext: RegionContext;
  targetContext?: RegionContext;
};

export type PromptBuildResult =
  | { ok: true; prompt: string; hasImageReplacement: boolean }
  | { ok: false; reason: "empty"; message: string };

function formatRect(rect: { left: number; top: number; width: number; height: number; right: number; bottom: number }): string {
  return `[x:${Math.round(rect.left)}, y:${Math.round(rect.top)}, w:${Math.round(rect.width)}, h:${Math.round(rect.height)}]`;
}

export function extractStyleFacts(context: RegionContext): string[] {
  const facts: string[] = [];
  if (context.empty || context.candidates.length === 0) return facts;

  const primaryCandidate = context.candidates[0].unit;
  if (!primaryCandidate.element) return facts;

  try {
    const style = window.getComputedStyle(primaryCandidate.element);
    const fontSize = style.getPropertyValue("font-size");
    const fontWeight = style.getPropertyValue("font-weight");
    const color = style.getPropertyValue("color");
    const bgColor = style.getPropertyValue("background-color");
    const borderRadius = style.getPropertyValue("border-radius");

    if (fontSize && fontSize !== "16px") facts.push(`font-size: ${fontSize}`);
    if (fontWeight && fontWeight !== "400" && fontWeight !== "normal") facts.push(`font-weight: ${fontWeight}`);
    
    // Only push color if it's not transparent or default black
    if (color && color !== "rgb(0, 0, 0)") facts.push(`color: ${color}`);
    if (bgColor && bgColor !== "rgba(0, 0, 0, 0)" && bgColor !== "transparent") facts.push(`background-color: ${bgColor}`);
    
    if (borderRadius && borderRadius !== "0px") facts.push(`border-radius: ${borderRadius}`);
  } catch (e) {
    // ignore
  }

  return facts.slice(0, 6);
}

export function buildIntentPrompt(
  inputs: IntentPromptInput[],
  options: IntentPromptOptions
): PromptBuildResult {
  if (inputs.length === 0) {
    return { ok: false, reason: "empty", message: options.language === "zh" ? "没有提供任何操作指令。" : "No operations provided." };
  }

  const lines: string[] = [];
  let hasImageReplacement = false;

  lines.push("ClickDeck edit instruction");
  lines.push("");
  lines.push("Page:");
  lines.push(`- URL: ${options.page.url || "unknown"}`);
  lines.push(`- Title: ${options.page.title || "unknown"}`);
  lines.push("- Scope: Current active browser page only.");
  lines.push("");
  
  lines.push("Global rules:");
  lines.push("1. Use the original HTML structure as the source of truth.");
  lines.push("2. Preserve the user's wording and intent.");
  lines.push("3. Keep changes limited to the selected region and directly related surrounding layout.");
  lines.push("4. Match the existing visual style unless the user explicitly asks for another style.");
  lines.push("5. If the intent or placement is ambiguous, ask the user a clarifying question before editing.");
  lines.push("");
  
  lines.push("Operations:");

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const { operation, sourceContext } = input;
    const region = sourceContext.region;

    if (operation.action === "move" && !input.targetContext) {
      return { ok: false, reason: "empty", message: options.language === "zh" ? "移动操作缺少目标区域。" : "Move operation is missing target region." };
    }

    lines.push(`${i + 1}. Action: ${operation.action}`);
    lines.push(`   User intent: "${region.userIntent}"`);

    if (operation.action === "move") {
      lines.push("   Target region A (Source):");
      lines.push(`   - Page mode: ${region.pageMode}`);
      lines.push(`   - Anchor: ${region.anchor.kind}${region.anchor.locator?.descriptor ? ` (${region.anchor.locator.descriptor})` : ""}`);
      if (region.relativeBox) {
        lines.push(`   - Box: ${formatRect(region.relativeBox)} (relative to anchor, %)`);
      } else {
        lines.push(`   - Box: ${formatRect(region.viewportBox)} (viewport px)`);
      }
      lines.push("");

      lines.push("   Region contents A (Source):");
      if (sourceContext.empty) {
        lines.push("   - The selected region is an empty visual area. Treat it as the intended placement area, not as an existing element to edit.");
      } else {
        sourceContext.candidates.slice(0, 3).forEach(c => {
          lines.push(`   - ${summarizeVisualUnit(c.unit)}`);
          if (c.unit.kind === "image") hasImageReplacement = true;
        });
      }
      lines.push("");

      const targetRegion = input.targetContext!.region;
      lines.push("   Target region B (Destination):");
      lines.push(`   - Page mode: ${targetRegion.pageMode}`);
      lines.push(`   - Anchor: ${targetRegion.anchor.kind}${targetRegion.anchor.locator?.descriptor ? ` (${targetRegion.anchor.locator.descriptor})` : ""}`);
      if (targetRegion.relativeBox) {
        lines.push(`   - Box: ${formatRect(targetRegion.relativeBox)} (relative to anchor, %)`);
      } else {
        lines.push(`   - Box: ${formatRect(targetRegion.viewportBox)} (viewport px)`);
      }
      lines.push("");

      lines.push("   Region contents B / Nearby references (Destination):");
      if (input.targetContext!.empty) {
        lines.push("   - The selected region is an empty visual area. Treat it as the intended placement area, not as an existing element to edit.");
      } else {
        input.targetContext!.candidates.slice(0, 3).forEach(c => {
          lines.push(`   - ${summarizeVisualUnit(c.unit)}`);
        });
      }
      input.targetContext!.nearby.slice(0, 4).forEach(n => {
        lines.push(`   - ${n.direction}: ${n.summary}`);
      });
      lines.push("");

    } else {
      lines.push("   Target region:");
      lines.push(`   - Page mode: ${region.pageMode}`);
      lines.push(`   - Anchor: ${region.anchor.kind}${region.anchor.locator?.descriptor ? ` (${region.anchor.locator.descriptor})` : ""}`);
      
      if (region.relativeBox) {
        lines.push(`   - Box: ${formatRect(region.relativeBox)} (relative to anchor, %)`);
      } else {
        lines.push(`   - Box: ${formatRect(region.viewportBox)} (viewport px)`);
      }
      lines.push("");

      lines.push("   Region contents:");
      if (sourceContext.empty) {
        lines.push("   - The selected region is an empty visual area. Treat it as the intended placement area, not as an existing element to edit.");
      } else {
        sourceContext.candidates.slice(0, 3).forEach(c => {
          lines.push(`   - ${summarizeVisualUnit(c.unit)}`);
          if (c.unit.kind === "image") hasImageReplacement = true;
        });
      }
      lines.push("");

      lines.push("   Nearby references:");
      if (sourceContext.nearby.length === 0) {
        lines.push("   - None found.");
      } else {
        sourceContext.nearby.slice(0, 4).forEach(n => {
          lines.push(`   - ${n.direction}: ${n.summary}`);
        });
      }
      lines.push("");

      lines.push("   Style reference:");
      const styleFacts = extractStyleFacts(sourceContext);
      if (styleFacts.length === 0) {
        lines.push("   - Use surrounding context to match style.");
      } else {
        styleFacts.forEach(fact => {
          lines.push(`   - ${fact}`);
        });
      }
      lines.push("");
    }

    // Action specific instructions
    lines.push("   To do:");
    if (operation.action === "add") {
      lines.push("   - Add new content near or inside the target region. Match the surrounding style.");
    } else if (operation.action === "delete") {
      lines.push("   - Delete only the contents inside the source region. You may close the gap layout if necessary.");
    } else if (operation.action === "replace") {
      lines.push("   - Replace the contents inside the source region exactly according to user intent.");
    } else if (operation.action === "restyle") {
      lines.push("   - Modify the CSS styles of the target region or its immediate contents.");
    } else if (operation.action === "move") {
      lines.push("   - Move the contents of Target region A to Target region B. You may adjust minor local spacing to fit the target area.");
    }
    lines.push("");

    lines.push("   Do not:");
    if (operation.action === "delete") {
      lines.push("   - Do not redesign the whole slide/page or modify unrelated content.");
    } else if (operation.action === "move") {
      lines.push("   - Do not convert this into a full redesign. Do not move unrelated content unless it's strictly necessary to make room. Do not modify other slides/pages.");
    } else {
      lines.push("   - Do not modify unrelated content or layout outside the target region.");
    }
    lines.push("");
  }

  return {
    ok: true,
    prompt: lines.join("\n").trim(),
    hasImageReplacement
  };
}
