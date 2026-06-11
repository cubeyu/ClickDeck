import { findFirstEditableDescendant, isClickDeckUiElement } from "./dom-utils";

export type TabDirection = "forward" | "backward";

export function isSelectableElement(element: HTMLElement): boolean {
  if (isClickDeckUiElement(element)) {
    return false;
  }

  if (element === document.documentElement || element === document.body) {
    return false;
  }

  return true;
}

export function getTabSwitchTarget(
  current: HTMLElement,
  direction: TabDirection
): HTMLElement | null {
  const parent = current.parentElement;
  const child = findFirstEditableDescendant(current);

  const parentEligible = parent ? isSelectableElement(parent) : false;
  const childEligible = child ? isSelectableElement(child) : false;

  // Deterministic + easy-to-test rule:
  // - Tab: prefer parent, otherwise first eligible descendant.
  // - Shift+Tab: prefer first eligible descendant, otherwise parent.
  if (direction === "forward") {
    if (parentEligible) return parent;
    if (childEligible) return child;
    return null;
  }

  if (childEligible) return child;
  if (parentEligible) return parent;
  return null;
}

export function isLargeContainer(element: HTMLElement): boolean {
  const tagName = element.tagName.toLowerCase();
  
  if (tagName === "img" || tagName === "video" || tagName === "svg" || tagName === "canvas") {
    return false;
  }
  
  if (["button", "input", "select", "textarea", "a"].includes(tagName)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const viewportArea = window.innerWidth * window.innerHeight;
  const elementArea = rect.width * rect.height;

  return elementArea > viewportArea * 0.4;
}

export function getEditableTarget(
  target: EventTarget | null,
  currentSelected?: HTMLElement | null
): HTMLElement | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  if (!isSelectableElement(target)) {
    return null;
  }

  if (isLargeContainer(target)) {
    if (currentSelected === target) {
      return target;
    }

    const child = findFirstEditableDescendant(target);
    if (child && isSelectableElement(child)) {
      return child;
    }
  }

  return target;
}
