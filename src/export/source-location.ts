import type {
  ResolveSourceLocationsResponse,
  SourceLocationEvidence,
  SourceLocationTarget
} from "../shared/messages";

type StartTag = {
  tagName: string;
  start: number;
  end: number;
  raw: string;
};

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"
]);

export function resolveSourceLocations(
  html: string,
  sourceUrl: string,
  targets: SourceLocationTarget[]
): ResolveSourceLocationsResponse {
  if (!looksLikeHtml(html)) {
    return { sourceUrl, locations: {}, unavailableReason: "resource-is-not-html" };
  }

  const startTags = scanStartTags(html);
  const locations: Record<string, SourceLocationEvidence> = {};

  for (const target of targets) {
    const match = findUniqueTarget(html, startTags, target);
    if (!match) continue;
    const point = indexToLineColumn(html, match.tag.start);
    locations[target.key] = {
      key: target.key,
      sourceUrl,
      line: point.line,
      column: point.column,
      confidence: "high",
      matchMethod: match.method
    };
  }

  return {
    sourceUrl,
    locations,
    unavailableReason: Object.keys(locations).length === 0 ? "no-unique-source-match" : undefined
  };
}

export async function fetchAndResolveSourceLocations(
  sourceUrl: string,
  targets: SourceLocationTarget[],
  fetcher: typeof fetch = fetch
): Promise<ResolveSourceLocationsResponse> {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return { locations: {}, unavailableReason: "invalid-source-url" };
  }

  if (!new Set(["http:", "https:", "file:"]).has(parsed.protocol)) {
    return { sourceUrl, locations: {}, unavailableReason: "unsupported-source-url" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetcher(sourceUrl, {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal
    });
    if (!response.ok) {
      return { sourceUrl, locations: {}, unavailableReason: `source-fetch-${response.status}` };
    }
    const html = await response.text();
    return resolveSourceLocations(html, sourceUrl, targets);
  } catch {
    return { sourceUrl, locations: {}, unavailableReason: "source-fetch-failed" };
  } finally {
    clearTimeout(timeout);
  }
}

function looksLikeHtml(value: string): boolean {
  const sample = value.slice(0, 4096).toLowerCase();
  return sample.includes("<!doctype html") || sample.includes("<html") || sample.includes("<body");
}

function findUniqueTarget(
  html: string,
  startTags: StartTag[],
  target: SourceLocationTarget
): { tag: StartTag; method: SourceLocationEvidence["matchMethod"] } | null {
  const candidates = startTags.filter((tag) => tag.tagName === target.tagName.toLowerCase());
  if (candidates.length === 0) return null;

  const id = target.idHint?.replace(/^#/, "").trim();
  if (id) {
    const matches = candidates.filter((tag) => getAttribute(tag.raw, "id") === id);
    if (matches.length === 1) return { tag: matches[0], method: "unique-id" };
    return null;
  }

  const className = target.classHint?.replace(/^\./, "").trim();
  if (className && target.selectorStability !== "low") {
    const matches = candidates.filter((tag) => {
      const classes = (getAttribute(tag.raw, "class") ?? "").split(/\s+/).filter(Boolean);
      return classes.includes(className);
    });
    if (matches.length === 1) return { tag: matches[0], method: "unique-class" };
  }

  if (target.tagName.toLowerCase() === "img" && target.imageHint) {
    const hint = target.imageHint.trim();
    const matches = candidates.filter((tag) => {
      const alt = getAttribute(tag.raw, "alt")?.trim();
      const src = getAttribute(tag.raw, "src")?.split(/[?#]/)[0] ?? "";
      return alt === hint || src.endsWith(`/${hint}`) || src === hint;
    });
    if (matches.length === 1) return { tag: matches[0], method: "unique-image" };
  }

  const text = normalizeTargetText(target.textSnippet);
  if (text) {
    const matches = candidates.filter((tag) => elementContainsUniqueText(html, tag, text));
    if (matches.length === 1) return { tag: matches[0], method: "unique-text" };
  }

  return null;
}

function normalizeTargetText(value?: string): string {
  const normalized = (value ?? "").replace(/\.\.\.$/, "").replace(/\s+/g, " ").trim();
  if (normalized.length < 4) return "";
  return normalized.slice(0, 60);
}

function elementContainsUniqueText(html: string, tag: StartTag, text: string): boolean {
  if (VOID_TAGS.has(tag.tagName)) return false;
  const closing = `</${tag.tagName}`;
  const closeIndex = html.toLowerCase().indexOf(closing, tag.end);
  if (closeIndex < 0) return false;
  const fragment = html.slice(tag.end, closeIndex);
  const plain = fragment.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!plain.includes(text)) return false;

  const escaped = escapeRegExp(text).replace(/ /g, "\\s+");
  const sourceMatches = html.match(new RegExp(escaped, "g"));
  return sourceMatches?.length === 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getAttribute(startTag: string, name: string): string | undefined {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(startTag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function scanStartTags(html: string): StartTag[] {
  const result: StartTag[] = [];
  const lowerHtml = html.toLowerCase();
  let index = 0;
  while (index < html.length) {
    const start = html.indexOf("<", index);
    if (start < 0) break;

    if (html.startsWith("<!--", start)) {
      const commentEnd = html.indexOf("-->", start + 4);
      index = commentEnd < 0 ? html.length : commentEnd + 3;
      continue;
    }

    const next = html[start + 1];
    if (!next || next === "/" || next === "!" || next === "?") {
      index = start + 1;
      continue;
    }

    const nameMatch = /^[A-Za-z][\w:-]*/.exec(html.slice(start + 1));
    if (!nameMatch) {
      index = start + 1;
      continue;
    }

    let quote: '"' | "'" | null = null;
    let end = start + 1 + nameMatch[0].length;
    for (; end < html.length; end += 1) {
      const char = html[end];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        break;
      }
    }
    if (end >= html.length) break;

    result.push({
      tagName: nameMatch[0].toLowerCase(),
      start,
      end: end + 1,
      raw: html.slice(start, end + 1)
    });

    const tagName = nameMatch[0].toLowerCase();
    if (tagName === "script" || tagName === "style") {
      const rawTextEnd = lowerHtml.indexOf(`</${tagName}`, end + 1);
      if (rawTextEnd >= 0) {
        index = rawTextEnd;
        continue;
      }
    }
    index = end + 1;
  }
  return result;
}

function indexToLineColumn(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let lastLineStart = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) {
      line += 1;
      lastLineStart = cursor + 1;
    }
  }
  return { line, column: index - lastLineStart + 1 };
}
