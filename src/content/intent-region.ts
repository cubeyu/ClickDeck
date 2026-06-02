import { ElementLocator } from "../state/editor-state";
import { createElementLocator } from "./dom-utils";
import { RectLike, calculateOverlap } from "./visual-units";

export type IntentAction = "add" | "delete" | "replace" | "restyle" | "move";
export type PageMode = "slide" | "long" | "unknown";

export type RegionAnchor = {
  kind: "slide" | "section" | "container" | "document";
  label?: string;
  locator?: ElementLocator;
  rect?: RectLike;
  confidence: "high" | "medium" | "low";
};

export type IntentRegion = {
  id: string;
  action: IntentAction;
  userIntent: string;
  pageMode: PageMode;
  viewportBox: RectLike;
  documentBox: RectLike;
  relativeBox?: RectLike;
  anchor: RegionAnchor;
  createdAt: number;
};

export type IntentOperation = {
  id: string;
  action: IntentAction;
  source: IntentRegion;
  target?: IntentRegion;
  createdAt: number;
};

let nextRegionId = 1;
let nextOperationId = 1;

export function normalizeRect(input: Partial<RectLike>): RectLike {
  const left = input.left ?? 0;
  const top = input.top ?? 0;
  const width = input.width ?? 0;
  const height = input.height ?? 0;
  return {
    left,
    top,
    width,
    height,
    right: input.right ?? (left + width),
    bottom: input.bottom ?? (top + height)
  };
}

export function toDocumentRect(viewportBox: RectLike, scrollX?: number, scrollY?: number): RectLike {
  const sx = scrollX ?? (typeof window !== "undefined" ? window.scrollX : 0);
  const sy = scrollY ?? (typeof window !== "undefined" ? window.scrollY : 0);
  return {
    left: viewportBox.left + sx,
    top: viewportBox.top + sy,
    width: viewportBox.width,
    height: viewportBox.height,
    right: viewportBox.right + sx,
    bottom: viewportBox.bottom + sy
  };
}

export function toRelativeRect(box: RectLike, anchorRect: RectLike): RectLike {
  if (anchorRect.width === 0 || anchorRect.height === 0) {
    return { ...box };
  }
  const leftPct = ((box.left - anchorRect.left) / anchorRect.width) * 100;
  const topPct = ((box.top - anchorRect.top) / anchorRect.height) * 100;
  const widthPct = (box.width / anchorRect.width) * 100;
  const heightPct = (box.height / anchorRect.height) * 100;

  return {
    left: leftPct,
    top: topPct,
    width: widthPct,
    height: heightPct,
    right: leftPct + widthPct,
    bottom: topPct + heightPct
  };
}

export function detectPageMode(root: ParentNode = document.body): PageMode {
  if (typeof document === "undefined") return "unknown";
  
  const slideElements = root.querySelectorAll('[aria-roledescription="slide"], .slide, [data-slide], section');
  if (slideElements.length > 0) {
    return "slide";
  }

  const height = document.body.scrollHeight;
  const viewportHeight = window.innerHeight;
  if (height > viewportHeight * 1.5) {
    return "long";
  }

  return "unknown";
}

export function findRegionAnchor(box: RectLike, root: ParentNode = document.body): RegionAnchor {
  const mode = detectPageMode(root);
  
  if (mode === "slide") {
    const slides = Array.from(root.querySelectorAll('[aria-roledescription="slide"], .slide, [data-slide], section')) as HTMLElement[];
    let bestSlide: HTMLElement | null = null;
    let maxOverlap = 0;
    
    for (const slide of slides) {
      const rect = slide.getBoundingClientRect();
      const { overlapArea } = calculateOverlap(rect, box);
      if (overlapArea > maxOverlap) {
        maxOverlap = overlapArea;
        bestSlide = slide;
      }
    }

    if (bestSlide) {
      const rect = bestSlide.getBoundingClientRect();
      return {
        kind: "slide",
        locator: createElementLocator(bestSlide),
        rect: {
          left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom
        },
        confidence: "high"
      };
    }
  }

  const containers = Array.from(root.querySelectorAll('section, article, main, [class*="container"], [class*="wrapper"]')) as HTMLElement[];
  let bestContainer: HTMLElement | null = null;
  let minArea = Infinity;

  for (const container of containers) {
    const rect = container.getBoundingClientRect();
    const { overlapArea } = calculateOverlap(rect, box);
    
    if (overlapArea > 0 && overlapArea / (box.width * box.height) > 0.8) {
      const area = rect.width * rect.height;
      if (area > 0 && area < minArea) {
        minArea = area;
        bestContainer = container;
      }
    }
  }

  if (bestContainer) {
    const rect = bestContainer.getBoundingClientRect();
    return {
      kind: bestContainer.tagName.toLowerCase() === 'section' ? "section" : "container",
      locator: createElementLocator(bestContainer),
      rect: {
        left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom
      },
      confidence: "medium"
    };
  }

  return {
    kind: "document",
    confidence: "low"
  };
}

export function createIntentRegion(input: {
  action: IntentAction;
  userIntent: string;
  viewportBox: RectLike;
  root?: ParentNode;
}): IntentRegion {
  const root = input.root ?? document.body;
  const pageMode = detectPageMode(root);
  const documentBox = toDocumentRect(input.viewportBox);
  const anchor = findRegionAnchor(input.viewportBox, root);
  
  let relativeBox: RectLike | undefined;
  if (anchor.rect) {
    relativeBox = toRelativeRect(input.viewportBox, anchor.rect);
  }

  return {
    id: `ir-${nextRegionId++}`,
    action: input.action,
    userIntent: input.userIntent,
    pageMode,
    viewportBox: input.viewportBox,
    documentBox,
    relativeBox,
    anchor,
    createdAt: Date.now()
  };
}

export function createIntentOperation(source: IntentRegion, target?: IntentRegion): IntentOperation {
  return {
    id: `iop-${nextOperationId++}`,
    action: source.action,
    source,
    target,
    createdAt: Date.now()
  };
}
