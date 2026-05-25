import type { ClickDeckLogger } from "../diagnostics/logger";
import type { StyleProperty } from "../state/style-token";
import { describeElement } from "./dom-utils";

export type StyleAction =
  | "font-smaller"
  | "font-larger"
  | "align-left"
  | "align-center"
  | "align-right"
  | "pick-bg-color"
  | "reset-color"
  | "weight-light"
  | "weight-normal"
  | "weight-bold"
  | "lineheight-compact"
  | "lineheight-normal"
  | "lineheight-loose"
  | "letterspacing-tight"
  | "letterspacing-normal"
  | "letterspacing-wide"
  | "margin-compact"
  | "margin-normal"
  | "margin-loose"
  | "padding-compact"
  | "padding-normal"
  | "padding-loose"
  | "bg-warm"
  | "bg-white"
  | "bg-transparent"
  | "bg-reset"
  | "radius-none"
  | "radius-sm"
  | "radius-md"
  | "radius-lg"
  | "image-width-smaller"
  | "image-width-larger"
  | "image-maxwidth-100"
  | "image-fit-contain"
  | "image-fit-cover"
  | "image-radius-none"
  | "image-radius-sm"
  | "image-radius-lg"
  | "image-radius-round";

export type AppliedStyleChange = {
  property: StyleProperty;
  before: string;
  after: string;
};

export function applyStyleAction(
  logger: ClickDeckLogger,
  element: HTMLElement,
  action: StyleAction
): AppliedStyleChange | null {
  const computed = window.getComputedStyle(element);
  let change: AppliedStyleChange | null = null;

  switch (action) {
    case "font-smaller":
      change = {
        property: "fontSize",
        before: element.style.fontSize,
        after: `${Math.max(10, parseFloat(computed.fontSize) - 2)}px`
      };
      break;
    case "font-larger":
      change = {
        property: "fontSize",
        before: element.style.fontSize,
        after: `${parseFloat(computed.fontSize) + 2}px`
      };
      break;
    case "align-left":
      change = {
        property: "textAlign",
        before: element.style.textAlign,
        after: "left"
      };
      break;
    case "align-center":
      change = {
        property: "textAlign",
        before: element.style.textAlign,
        after: "center"
      };
      break;
    case "align-right":
      change = {
        property: "textAlign",
        before: element.style.textAlign,
        after: "right"
      };
      break;
    case "pick-bg-color": {
      // Walk up the DOM tree to find the nearest ancestor with a non-transparent background
      let bg = "";
      let current: HTMLElement | null = element.parentElement;
      while (current) {
        const computedBg = window.getComputedStyle(current).backgroundColor;
        // "transparent" or "rgba(0, 0, 0, 0)" are both considered transparent
        if (computedBg && computedBg !== "transparent" && computedBg !== "rgba(0, 0, 0, 0)") {
          bg = computedBg;
          break;
        }
        current = current.parentElement;
      }
      if (!bg) {
        logger.info("No non-transparent background found in ancestors");
        return null;
      }
      change = {
        property: "color",
        before: element.style.color,
        after: bg
      };
      break;
    }
    case "reset-color":
      change = {
        property: "color",
        before: element.style.color,
        after: ""
      };
      break;
    case "weight-light":
      change = {
        property: "fontWeight",
        before: element.style.fontWeight,
        after: "300"
      };
      break;
    case "weight-normal":
      change = {
        property: "fontWeight",
        before: element.style.fontWeight,
        after: "normal"
      };
      break;
    case "weight-bold":
      change = {
        property: "fontWeight",
        before: element.style.fontWeight,
        after: "bold"
      };
      break;
    case "lineheight-compact":
      change = {
        property: "lineHeight",
        before: element.style.lineHeight,
        after: "1.2"
      };
      break;
    case "lineheight-normal":
      change = {
        property: "lineHeight",
        before: element.style.lineHeight,
        after: "1.5"
      };
      break;
    case "lineheight-loose":
      change = {
        property: "lineHeight",
        before: element.style.lineHeight,
        after: "1.8"
      };
      break;
    case "letterspacing-tight":
      change = {
        property: "letterSpacing",
        before: element.style.letterSpacing,
        after: "-0.02em"
      };
      break;
    case "letterspacing-normal":
      change = {
        property: "letterSpacing",
        before: element.style.letterSpacing,
        after: "0px"
      };
      break;
    case "letterspacing-wide":
      change = {
        property: "letterSpacing",
        before: element.style.letterSpacing,
        after: "0.04em"
      };
      break;
    case "margin-compact":
      change = {
        property: "margin",
        before: element.style.margin,
        after: "4px"
      };
      break;
    case "margin-normal":
      change = {
        property: "margin",
        before: element.style.margin,
        after: "8px"
      };
      break;
    case "margin-loose":
      change = {
        property: "margin",
        before: element.style.margin,
        after: "16px"
      };
      break;
    case "padding-compact":
      change = {
        property: "padding",
        before: element.style.padding,
        after: "6px"
      };
      break;
    case "padding-normal":
      change = {
        property: "padding",
        before: element.style.padding,
        after: "12px"
      };
      break;
    case "padding-loose":
      change = {
        property: "padding",
        before: element.style.padding,
        after: "20px"
      };
      break;
    case "bg-warm":
      change = {
        property: "backgroundColor",
        before: element.style.backgroundColor,
        after: "#f7f3ea"
      };
      break;
    case "bg-white":
      change = {
        property: "backgroundColor",
        before: element.style.backgroundColor,
        after: "#ffffff"
      };
      break;
    case "bg-transparent":
      change = {
        property: "backgroundColor",
        before: element.style.backgroundColor,
        after: "transparent"
      };
      break;
    case "bg-reset":
      change = {
        property: "backgroundColor",
        before: element.style.backgroundColor,
        after: ""
      };
      break;
    case "radius-none":
      change = {
        property: "borderRadius",
        before: element.style.borderRadius,
        after: "0"
      };
      break;
    case "radius-sm":
      change = {
        property: "borderRadius",
        before: element.style.borderRadius,
        after: "6px"
      };
      break;
    case "radius-md":
      change = {
        property: "borderRadius",
        before: element.style.borderRadius,
        after: "10px"
      };
      break;
    case "radius-lg":
      change = {
        property: "borderRadius",
        before: element.style.borderRadius,
        after: "16px"
      };
      break;
    case "image-width-smaller": {
      const current = element.style.width || computed.width;
      const next = stepSize(current, -1);
      change = {
        property: "width",
        before: element.style.width,
        after: next
      };
      break;
    }
    case "image-width-larger": {
      const current = element.style.width || computed.width;
      const next = stepSize(current, +1);
      change = {
        property: "width",
        before: element.style.width,
        after: next
      };
      break;
    }
    case "image-maxwidth-100":
      change = {
        property: "maxWidth",
        before: element.style.maxWidth,
        after: "100%"
      };
      break;
    case "image-fit-contain":
      change = {
        property: "objectFit",
        before: element.style.objectFit,
        after: "contain"
      };
      break;
    case "image-fit-cover":
      change = {
        property: "objectFit",
        before: element.style.objectFit,
        after: "cover"
      };
      break;
    case "image-radius-none":
      change = {
        property: "borderRadius",
        before: element.style.borderRadius,
        after: "0"
      };
      break;
    case "image-radius-sm":
      change = {
        property: "borderRadius",
        before: element.style.borderRadius,
        after: "8px"
      };
      break;
    case "image-radius-lg":
      change = {
        property: "borderRadius",
        before: element.style.borderRadius,
        after: "16px"
      };
      break;
    case "image-radius-round":
      change = {
        property: "borderRadius",
        before: element.style.borderRadius,
        after: "9999px"
      };
      break;
  }

  if (!change) {
    return null;
  }

  element.style[change.property] = change.after;
  logger.info("Style action applied", { action, target: describeElement(element) });
  return change;
}

function stepSize(value: string, direction: -1 | 1): string {
  const trimmed = (value || "").toString().trim();
  const percentMatch = trimmed.match(/^(-?\\d+(?:\\.\\d+)?)%$/);
  if (percentMatch) {
    const current = Number(percentMatch[1]);
    const delta = 5 * direction;
    const next = clamp(current + delta, 10, 200);
    return `${next}%`;
  }

  const pxMatch = trimmed.match(/^(-?\\d+(?:\\.\\d+)?)px$/);
  if (pxMatch) {
    const current = Number(pxMatch[1]);
    const delta = 20 * direction;
    const next = clamp(current + delta, 20, 2000);
    return `${next}px`;
  }

  // Fallback: try parse float and treat as px.
  const parsed = Number.parseFloat(trimmed);
  if (Number.isFinite(parsed)) {
    const next = clamp(parsed + 20 * direction, 20, 2000);
    return `${next}px`;
  }

  // Last resort: set a reasonable default.
  return direction > 0 ? "320px" : "160px";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
