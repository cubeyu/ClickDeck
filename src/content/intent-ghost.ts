import { getPanelLabels } from "./i18n";
import { RectLike } from "./visual-units";

export type GhostPreview = {
  element: HTMLDivElement;
  destroy: () => void;
};

const STYLE_ID = "clickdeck-ghost-preview-style";

export function createGhostPreview(
  initialRect: RectLike,
  color: string,
  label: string,
  anchorRect: RectLike | undefined,
  onConfirm: (finalRect: RectLike) => void,
  onCancel: () => void
): GhostPreview {
  injectBaseStyles();
  const labels = getPanelLabels();

  const element = document.createElement("div");
  element.className = "clickdeck-ghost-preview";
  element.dataset.clickdeck = "true";
  element.style.setProperty("--ghost-color", color);
  element.style.setProperty("--ghost-bg", `color-mix(in srgb, ${color} 15%, transparent)`);
  
  // Set initial position
  let currentLeft = initialRect.left;
  let currentTop = initialRect.top;
  const width = initialRect.width;
  const height = initialRect.height;

  // Scroll lock
  document.documentElement.classList.add("clickdeck-target-box-active");

  // Guide lines
  const guideLines: HTMLDivElement[] = [];
  function clearGuideLines() {
    guideLines.forEach(l => l.remove());
    guideLines.length = 0;
  }
  function drawGuideLine(isVertical: boolean, position: number) {
    const line = document.createElement("div");
    line.className = "clickdeck-ghost-guide-line";
    line.dataset.clickdeck = "true";
    if (isVertical) {
      line.style.left = `${position}px`;
      line.style.top = "0";
      line.style.width = "1px";
      line.style.height = "100vh";
    } else {
      line.style.left = "0";
      line.style.top = `${position}px`;
      line.style.width = "100vw";
      line.style.height = "1px";
    }
    document.body.appendChild(line);
    guideLines.push(line);
  }

  function updatePosition() {
    element.style.left = `${currentLeft}px`;
    element.style.top = `${currentTop}px`;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
  }
  updatePosition();

  // Create UI overlay
  const uiContainer = document.createElement("div");
  uiContainer.className = "clickdeck-ghost-preview__ui";
  uiContainer.innerHTML = `
    <div class="clickdeck-ghost-preview__label" style="background: ${color};">${label}</div>
    <div class="clickdeck-ghost-preview__hint">${labels.intentDragGhostHint}</div>
    <div class="clickdeck-ghost-preview__actions">
      <button class="clickdeck-button clickdeck-button--outline" data-action="cancel" type="button">${labels.intentCancelPreview}</button>
      <button class="clickdeck-button clickdeck-button--primary" data-action="confirm" type="button" style="background: ${color}; border-color: ${color};">${labels.intentUsePosition}</button>
    </div>
  `;

  element.appendChild(uiContainer);

  const btnCancel = uiContainer.querySelector('[data-action="cancel"]') as HTMLButtonElement;
  const btnConfirm = uiContainer.querySelector('[data-action="confirm"]') as HTMLButtonElement;

  btnCancel.addEventListener("click", (e) => {
    e.stopPropagation();
    onCancel();
  });

  btnConfirm.addEventListener("click", (e) => {
    e.stopPropagation();
    onConfirm({
      left: currentLeft,
      top: currentTop,
      right: currentLeft + width,
      bottom: currentTop + height,
      width,
      height
    });
  });

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  function onMouseDown(e: MouseEvent) {
    // Don't drag if clicking buttons
    if ((e.target as HTMLElement).closest('.clickdeck-button')) return;
    
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    initialLeft = currentLeft;
    initialTop = currentTop;
    element.classList.add("clickdeck-ghost-preview--dragging");
    e.preventDefault(); // prevent text selection
  }

  function onMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    
    // We calculate based on viewport deltas since ghost uses absolute coords and we scroll.
    // Wait, initialRect is viewportBox, but if we scroll, the position on screen might change.
    // However, the ghost element is usually position: fixed or absolute?
    // Let's use absolute so it stays on the page when scrolling.
    
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    currentLeft = initialLeft + dx;
    currentTop = initialTop + dy;
    updatePosition();
    
    // Update guide lines
    clearGuideLines();
    if (anchorRect) {
      const threshold = 8;
      const boxCenterX = currentLeft + width / 2;
      const boxCenterY = currentTop + height / 2;
      const anchorCenterX = anchorRect.left + anchorRect.width / 2;
      const anchorCenterY = anchorRect.top + anchorRect.height / 2;
      
      const candidatesX = [
        { anchorPos: anchorRect.left, boxPos: currentLeft },
        { anchorPos: anchorRect.right, boxPos: currentLeft + width },
        { anchorPos: anchorCenterX, boxPos: boxCenterX }
      ];
      
      const candidatesY = [
        { anchorPos: anchorRect.top, boxPos: currentTop },
        { anchorPos: anchorRect.bottom, boxPos: currentTop + height },
        { anchorPos: anchorCenterY, boxPos: boxCenterY }
      ];
      
      let closestX = null;
      let minDx = Infinity;
      for (const cx of candidatesX) {
        const dist = Math.abs(cx.boxPos - cx.anchorPos);
        if (dist <= threshold && dist < minDx) {
          minDx = dist;
          closestX = cx.anchorPos;
        }
      }
      
      let closestY = null;
      let minDy = Infinity;
      for (const cy of candidatesY) {
        const dist = Math.abs(cy.boxPos - cy.anchorPos);
        if (dist <= threshold && dist < minDy) {
          minDy = dist;
          closestY = cy.anchorPos;
        }
      }
      
      if (closestX !== null) drawGuideLine(true, closestX);
      if (closestY !== null) drawGuideLine(false, closestY);
    }
  }

  function onMouseUp() {
    if (!isDragging) return;
    isDragging = false;
    element.classList.remove("clickdeck-ghost-preview--dragging");
    clearGuideLines();
  }

  element.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);

  document.body.appendChild(element);

  return {
    element,
    destroy: () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      element.remove();
      clearGuideLines();
      document.documentElement.classList.remove("clickdeck-target-box-active");
    }
  };
}

function injectBaseStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .clickdeck-ghost-preview {
      position: fixed; /* We use fixed to represent viewportBox */
      background: var(--ghost-bg);
      border: 2px dashed var(--ghost-color);
      border-radius: 8px;
      cursor: grab;
      z-index: 2147483647; /* high z-index */
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      backdrop-filter: blur(2px);
      user-select: none;
    }
    .clickdeck-ghost-preview--dragging {
      cursor: grabbing;
      opacity: 0.8;
      border: 2px solid var(--ghost-color);
    }
    .clickdeck-ghost-preview__label {
      position: absolute;
      top: 0;
      left: 0;
      transform: translateY(-100%);
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 4px 4px 0 0;
      pointer-events: none;
    }
    .clickdeck-ghost-preview__ui {
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      margin-top: 12px;
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      padding: 12px;
      width: max-content;
      max-width: 300px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      border: 1px solid rgba(0,0,0,0.08);
      cursor: default;
    }
    .clickdeck-ghost-preview__hint {
      font-size: 13px;
      color: #4b5563;
      line-height: 1.4;
      font-family: Inter, system-ui, sans-serif;
      white-space: pre-wrap;
    }
    .clickdeck-ghost-preview__actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    html.clickdeck-target-box-active,
    html.clickdeck-target-box-active body {
      overflow: hidden !important;
    }
    .clickdeck-ghost-guide-line {
      position: fixed;
      background-color: #3b82f688;
      pointer-events: none;
      z-index: 2147483646;
      box-shadow: 0 0 2px rgba(59, 130, 246, 0.5);
    }
  `;
  document.documentElement.appendChild(style);
}
