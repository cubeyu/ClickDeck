import type { ClickDeckLogger } from "../diagnostics/logger";
import {
  createEditorState,
  recordStylePatch,
  setEditorActive,
  setSelectedElement
} from "../state/editor-state";
import { describeElement } from "./dom-utils";
import { createOverlay, type ClickDeckOverlay } from "./overlay";
import { createPanel, type ClickDeckPanel } from "./panel";
import { getEditableTarget } from "./selection";
import { applyStyleAction, type StyleAction } from "./style-actions";

export type ClickDeckController = {
  toggle: () => void;
  isActive: () => boolean;
};

export function createController(logger: ClickDeckLogger, rootId: string): ClickDeckController {
  const state = createEditorState();
  let active = false;
  let hoveredElement: HTMLElement | null = null;
  let selectedElement: HTMLElement | null = null;
  let overlay: ClickDeckOverlay | null = null;
  let panel: ClickDeckPanel | null = null;

  function updateOutline(): void {
    if (!overlay) {
      return;
    }

    overlay.updateOutline(selectedElement ?? hoveredElement);
  }

  function handleMouseMove(event: MouseEvent): void {
    if (!active) {
      return;
    }

    const target = getEditableTarget(event.target);
    if (target === hoveredElement) {
      return;
    }

    hoveredElement = target;
    if (!selectedElement) {
      updateOutline();
    }
  }

  function handleClick(event: MouseEvent): void {
    if (!active) {
      return;
    }

    const target = getEditableTarget(event.target);
    if (!target) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    selectedElement = target;
    const descriptor = describeElement(target);
    setSelectedElement(state, { element: target, descriptor });
    panel?.setHint(descriptor);
    updateOutline();
    logger.info("Element selected", descriptor);
  }

  function handleStyleAction(action: StyleAction): void {
    if (!selectedElement) {
      return;
    }

    const change = applyStyleAction(logger, selectedElement, action);
    if (!change) {
      return;
    }

    const patch = {
      id: `${Date.now()}-${state.patches.length + 1}`,
      targetElement: selectedElement,
      targetDescriptor: describeElement(selectedElement),
      property: change.property,
      before: change.before,
      after: change.after,
      createdAt: Date.now()
    };
    recordStylePatch(state, patch);
    logger.info("Style patch recorded", {
      patchId: patch.id,
      property: patch.property,
      target: patch.targetDescriptor
    });
    updateOutline();
  }

  function activate(): void {
    active = true;
    setEditorActive(state, true);
    overlay = createOverlay(rootId);
    panel = createPanel(handleStyleAction);
    overlay.root.append(panel.element);

    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("click", handleClick, true);
    window.addEventListener("scroll", updateOutline, true);
    window.addEventListener("resize", updateOutline, true);
    logger.info("ClickDeck activated");
  }

  function deactivate(): void {
    active = false;
    setEditorActive(state, false);
    hoveredElement = null;
    selectedElement = null;
    setSelectedElement(state, null);

    window.removeEventListener("mousemove", handleMouseMove, true);
    window.removeEventListener("click", handleClick, true);
    window.removeEventListener("scroll", updateOutline, true);
    window.removeEventListener("resize", updateOutline, true);

    panel?.destroy();
    panel = null;
    overlay?.destroy();
    overlay = null;

    logger.info("ClickDeck deactivated");
  }

  return {
    toggle: () => {
      if (active) {
        deactivate();
      } else {
        activate();
      }
    },
    isActive: () => active
  };
}
