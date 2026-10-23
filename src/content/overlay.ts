const STYLE_ID = "clickdeck-style";

export type ClickDeckOverlay = {
  root: HTMLDivElement;
  outline: HTMLDivElement;
  destroy: () => void;
  updateOutline: (target: Element | null) => void;
};

export function createOverlay(rootId: string): ClickDeckOverlay {
  injectBaseStyles(rootId);

  const root = document.createElement("div");
  root.id = rootId;
  root.dataset.clickdeck = "true";
  // Controls keep their native behavior, without bubbling navigation to the host page.
  root.addEventListener("keydown", event => event.stopPropagation());
  root.addEventListener("wheel", event => event.stopPropagation(), { passive: true });
  root.addEventListener("touchstart", event => event.stopPropagation(), { passive: true });
  root.addEventListener("touchend", event => event.stopPropagation(), { passive: true });

  const outline = document.createElement("div");
  outline.className = "clickdeck-outline";
  outline.dataset.clickdeck = "true";

  root.append(outline);
  document.documentElement.append(root);

  return {
    root,
    outline,
    destroy: () => {
      root.remove();
    },
    updateOutline: (target) => updateOutline(outline, target)
  };
}

function updateOutline(outline: HTMLDivElement, target: Element | null): void {
  if (!target) {
    outline.style.display = "none";
    return;
  }

  const rect = target.getBoundingClientRect();
  outline.style.display = "block";
  outline.style.left = `${rect.left}px`;
  outline.style.top = `${rect.top}px`;
  outline.style.width = `${rect.width}px`;
  outline.style.height = `${rect.height}px`;
}

function injectBaseStyles(rootId: string): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${rootId}, #${rootId} * {
      box-sizing: border-box;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    #${rootId} {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      pointer-events: none;
    }

    .clickdeck-outline {
      position: fixed;
      display: none;
      border: 2px solid #f97316;
      border-radius: 8px;
      box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.16);
      pointer-events: none;
    }

    .clickdeck-panel {
      position: fixed;
      top: 16px;
      right: 16px;
      width: 248px;
      padding: 14px;
      color: #2f261f;
      background: #fffaf2;
      border: 1px solid rgba(120, 84, 53, 0.22);
      border-radius: 14px;
      box-shadow: 0 18px 44px rgba(84, 58, 36, 0.18);
      max-height: calc(100vh - 32px);
      overflow-y: auto;
      pointer-events: auto;
      transition: opacity 0.2s ease, width 0.2s ease, height 0.2s ease, padding 0.2s ease, border-radius 0.2s ease;
    }

    .clickdeck-panel--collapsed {
      width: 126px;
      height: 48px;
      padding: 0;
      border-radius: 24px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
    }

    .clickdeck-panel--collapsed:active {
      cursor: grabbing;
    }

    .clickdeck-panel--collapsed .clickdeck-panel__content-wrapper,
    .clickdeck-panel--collapsed .clickdeck-notice {
      display: none !important;
    }

    .clickdeck-panel__floating-button {
      display: none;
    }

    .clickdeck-panel--collapsed .clickdeck-panel__floating-button {
      display: flex;
      width: 100%;
      height: 100%;
      align-items: center;
      justify-content: center;
      cursor: inherit;
    }

    .clickdeck-panel__floating-button img {
      width: 38px;
      height: 38px;
      border-radius: 999px;
      pointer-events: none;
    }

    .clickdeck-panel__floating-button span { font-size: 12px; font-weight: 600; margin: 0 8px 0 4px; white-space: nowrap; }

    .clickdeck-panel--opacity-70 {
      opacity: 0.7;
    }

    .clickdeck-panel--opacity-40 {
      opacity: 0.4;
    }

    .clickdeck-panel__header {
      display: flex;
      flex-wrap: nowrap;
      gap: 4px;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
      cursor: grab;
    }

    .clickdeck-panel__header:active {
      cursor: grabbing;
    }

    .clickdeck-panel__header-actions {
      display: flex;
      flex-shrink: 0;
      gap: 4px;
      margin-left: auto;
    }

    .clickdeck-panel__title {
      min-width: 0;
      font-size: 14px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .clickdeck-panel__logo {
      width: 28px;
      height: 28px;
      border-radius: 999px;
      object-fit: cover;
      box-shadow: 0 2px 8px rgba(84, 58, 36, 0.16);
    }

    .clickdeck-panel__status {
      font-size: 10px;
      white-space: nowrap;
      font-weight: 500;
      color: #4f7a1f;
      background: #eef8d4;
      padding: 2px 6px;
      border-radius: 9999px;
    }

    .clickdeck-panel__brand-meta { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; white-space: nowrap; }

    .clickdeck-panel__hint {
      min-height: 18px;
      color: #6f5f52;
      font-size: 12px;
      line-height: 1.4;
    }

    .clickdeck-panel__complex-notice {
      margin-top: 8px;
      padding: 8px 10px;
      border: 1px solid rgba(120, 84, 53, 0.18);
      border-radius: 8px;
      background: #fff8ed;
      color: #5b4635;
    }

    .clickdeck-panel__complex-notice[hidden] {
      display: none;
    }

    .clickdeck-panel__complex-title {
      font-size: 12px;
      font-weight: 700;
      margin-bottom: 4px;
    }

    .clickdeck-panel__complex-body {
      font-size: 11px;
      line-height: 1.45;
      color: #7a6554;
    }

    .clickdeck-panel__section {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid rgba(120, 84, 53, 0.14);
    }

    .clickdeck-panel__module-title {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid rgba(120, 84, 53, 0.18);
      font-size: 12px;
      font-weight: 700;
      color: #4f3828;
      letter-spacing: 0.03em;
    }

    .clickdeck-panel__section-title {
      font-size: 11px;
      font-weight: 600;
      color: #8a6a4e;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }

    .clickdeck-panel__group {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }

    .clickdeck-panel__group--spacing {
      grid-template-columns: 1fr minmax(0, 1fr) minmax(0, 1fr);
      align-items: center;
      margin-bottom: 6px;
    }

    .clickdeck-panel__group--spacing:last-child {
      margin-bottom: 0;
    }

    .clickdeck-panel__group--ask-gemini {
      grid-template-columns: minmax(0, 1fr);
      align-items: stretch;
    }

    .clickdeck-panel__group--ask-gemini > .clickdeck-button {
      min-height: 34px;
      white-space: nowrap;
    }

    .clickdeck-panel__ask-gemini-interaction {
      min-width: 0;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }

    .clickdeck-panel__ask-gemini-interaction .clickdeck-button {
      min-width: 0;
      min-height: 34px;
      padding: 4px;
      font-size: 11px;
      line-height: 1.25;
      white-space: normal;
      overflow-wrap: anywhere;
    }

    .clickdeck-panel__group--media-actions {
      grid-template-columns: minmax(0, 1fr) 44px 44px;
      align-items: stretch;
    }

    .clickdeck-panel__group--media-size {
      grid-template-columns: 44px 44px minmax(0, 1fr);
      align-items: stretch;
    }

    .clickdeck-panel__spacing-label {
      font-size: 11px;
      color: #8a6a4e;
    }

    .clickdeck-panel__sub-section {
      margin-bottom: 8px;
    }

    .clickdeck-panel__sub-section:last-child {
      margin-bottom: 0;
    }

    .clickdeck-panel__sub-title {
      font-size: 10px;
      color: #a48c77;
      margin-bottom: 4px;
    }

    .clickdeck-panel__sub-hint {
      margin-top: 6px;
      font-size: 11px;
      line-height: 1.45;
      color: #7a6554;
    }

    .clickdeck-panel__advanced {
      margin-top: 12px;
      border-top: 1px solid rgba(120, 84, 53, 0.14);
      padding-top: 12px;
    }

    .clickdeck-panel__advanced-summary {
      font-size: 11px;
      font-weight: 600;
      color: #8a6a4e;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      cursor: pointer;
      user-select: none;
      outline: none;
    }

    .clickdeck-panel__advanced[hidden] {
      display: none;
    }

    .clickdeck-button {
      min-height: 32px;
      padding: 0 8px;
      color: #3d2f24;
      background: #fffdf8;
      border: 1px solid #decbb7;
      border-radius: 8px;
      font-size: 12px;
      line-height: 1;
      cursor: pointer;
    }

    .clickdeck-button--media-source {
      min-height: 34px;
      white-space: nowrap;
      padding: 0 12px;
    }

    .clickdeck-button--media-size {
      min-width: 44px;
      padding: 0;
      font-size: 16px;
      font-weight: 600;
    }

    .clickdeck-button:hover {
      background: #fff3df;
      border-color: #f2ad63;
    }

    .clickdeck-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      background: #f4ece2;
      border-color: #e8dccd;
    }

    .clickdeck-color-picker {
      min-height: 32px;
      width: 100%;
      padding: 2px;
      border: 1px solid #decbb7;
      border-radius: 8px;
      cursor: pointer;
      background: transparent;
    }

    .clickdeck-button--action-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }

    .clickdeck-button--action-icon svg {
      width: 16px;
      height: 16px;
      stroke: currentColor;
    }

    .clickdeck-button--icon {
      min-height: 24px;
      width: 24px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: transparent;
      color: #8a6a4e;
    }

    .clickdeck-button--icon:hover {
      background: #fff3df;
      color: #3d2f24;
      border-color: transparent;
    }

    .clickdeck-button--primary {
      background: #8a6a4e;
      color: #fff;
      border-color: #8a6a4e;
    }

    .clickdeck-button--primary:hover {
      background: #6b4e35;
      border-color: #6b4e35;
    }

    .clickdeck-button--active {
      background: #fff3df;
      border-color: #c8a47a;
      font-weight: 600;
    }

    .clickdeck-prompt-overlay {
      position: fixed;
      inset: 0;
      background: rgba(62, 45, 32, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 12000;
    }

    .clickdeck-prompt-modal {
      background: #fffaf3;
      border: 1px solid #e8d5b0;
      border-radius: 10px;
      padding: 14px;
      width: min(760px, calc(100vw - 32px));
      max-height: min(760px, calc(100vh - 32px));
      display: flex;
      flex-direction: column;
      gap: 10px;
      box-shadow: 0 4px 16px rgba(62, 45, 32, 0.18);
    }

    .clickdeck-prompt-modal__header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
    }

    .clickdeck-prompt-modal__title {
      font-size: 12px;
      font-weight: 700;
      color: #3d2f24;
    }

    .clickdeck-prompt-modal__lang {
      display: grid;
      grid-template-columns: repeat(2, minmax(72px, 1fr));
      gap: 4px;
    }

    .clickdeck-prompt-modal__textarea {
      width: 100%;
      min-height: 320px;
      max-height: calc(100vh - 220px);
      padding: 8px;
      border: 1px solid #e8d5b0;
      border-radius: 6px;
      background: #fff;
      color: #3d2f24;
      font-size: 13px;
      font-family: "Menlo", "Consolas", monospace;
      line-height: 1.5;
      resize: vertical;
      box-sizing: border-box;
    }

    .clickdeck-prompt-modal__warning {
      padding: 10px;
      background: #fff1f0;
      border-left: 4px solid #ff4d4f;
      color: #cf1322;
      font-size: 13px;
      line-height: 1.4;
      border-radius: 4px;
    }

    .clickdeck-prompt-modal__textarea:focus {
      outline: 2px solid #c8a47a;
      outline-offset: -1px;
    }

    .clickdeck-prompt-modal__footer {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
    }

    .clickdeck-button--secondary { background: #fffaf3; color: #6b4e35; border-style: dashed; }
    .clickdeck-collab-overlay { position: fixed; inset: 0; z-index: 10001; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(62, 45, 32, 0.48); box-sizing: border-box; }
    .clickdeck-collab-modal { --review-ink: #26352e; --review-muted: #64736a; --review-line: #e1e8e3; --review-accent: #35654d; position: relative; width: min(640px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; padding: 16px; border: 1px solid var(--review-line); border-radius: 12px; background: #fff; color: var(--review-ink); box-shadow: 0 12px 40px rgba(30, 46, 36, 0.16); box-sizing: border-box; }
    .clickdeck-collab-overlay--board { align-items: flex-start; justify-content: flex-end; padding: 12px; background: transparent; pointer-events: none; }
    .clickdeck-collab-modal--board { z-index: 10003; width: min(390px, calc(100vw - 24px)); height: auto; max-height: calc(100vh - 24px); border-radius: 14px; pointer-events: auto; }
    .clickdeck-collab-overlay--board.clickdeck-collab-overlay--left { justify-content: flex-start; }
    .clickdeck-collab-overlay--board.clickdeck-collab-overlay--collapsed { align-items: flex-start; }
    .clickdeck-collab-overlay--collapsed .clickdeck-collab-modal--board { height: auto; max-height: calc(100vh - 24px); }
    .clickdeck-collab-body[hidden] { display: none; }
    #${rootId} .clickdeck-collab-modal { font-family: system-ui, sans-serif; font-size: 13px; font-weight: 400; line-height: 1.5; text-align: left; letter-spacing: normal; }
    #${rootId} .clickdeck-collab-modal .clickdeck-button { font-family: inherit; font-size: 13px; font-weight: 400; min-height: 30px; border-color: var(--review-line); background: #fff; color: var(--review-ink); }
    #${rootId} .clickdeck-collab-modal .clickdeck-button--primary { background: var(--review-accent); border-color: var(--review-accent); color: #fff; font-weight: 600; }
    #${rootId} .clickdeck-collab-modal p { font-size: 12px; line-height: 1.5; margin: 6px 0; }
    #${rootId} .clickdeck-collab-modal details { font-size: 12px; line-height: 1.5; }
    #${rootId} .clickdeck-collab-modal summary { font-size: 12px; line-height: 1.5; }
    .clickdeck-collab-navigation { display: flex; gap: 16px; margin-bottom: 10px; border-bottom: 1px solid var(--review-line); }
    #${rootId} .clickdeck-collab-navigation .clickdeck-button { border: 0; border-bottom: 2px solid transparent; border-radius: 0; padding: 5px 0; color: var(--review-muted); background: transparent; }
    #${rootId} .clickdeck-collab-navigation [aria-pressed="true"] { color: var(--review-accent); border-bottom-color: var(--review-accent); font-weight: 600; }
    .clickdeck-collab-overlay--projects .clickdeck-collab-entry-status > strong { display: none; }
    .clickdeck-collab-history-row { padding: 10px 0; border-bottom: 1px solid var(--review-line); }
    #${rootId} .clickdeck-collab-history-open { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; padding: 2px 0; border: 0; background: transparent; text-align: left; }
    #${rootId} .clickdeck-collab-history-open:hover { background: #f1f7f3; }
    .clickdeck-collab-history-name { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .clickdeck-collab-history-match { flex-shrink: 0; border-radius: 999px; padding: 1px 6px; background: #f0f2f1; color: var(--review-muted); font-size: 11px; }
    .clickdeck-collab-history-match.is-match { background: #eaf3ed; color: var(--review-accent); }
    .clickdeck-collab-history-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--review-muted); font-size: 12px; }
    .clickdeck-collab-history-meta > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${rootId} .clickdeck-collab-modal .clickdeck-collab-history-remove { flex-shrink: 0; border: 0; padding: 2px 4px; background: transparent; color: var(--review-muted); font-size: 12px; }
    .clickdeck-panel--reviewing { width: 0; height: 0; padding: 0; border: 0; background: transparent; box-shadow: none; overflow: visible; opacity: 1; pointer-events: none; transition: none; }
    .clickdeck-panel--reviewing > :not(.clickdeck-collab-overlay) { display: none !important; }
    .clickdeck-collab-overlay[hidden] { display: none; }
    .clickdeck-collab-overlay--editing > .clickdeck-collab-modal { display: none; }
    .clickdeck-collab-session { position: fixed; z-index: 10004; left: 12px; bottom: 12px; width: min(370px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto; pointer-events: auto; color: #26352e; font: 400 12px/1.5 system-ui, sans-serif; text-align: left; letter-spacing: normal; }
    .clickdeck-collab-capsule { display: flex; align-items: center; padding: 4px; gap: 2px; border: 1px solid #cbdcd1; border-radius: 999px; background: #f1f7f3; box-shadow: 0 3px 16px #23302720; }
    .clickdeck-collab-session.is-minimized { width: min(260px, calc(100vw - 24px)); }
    .clickdeck-collab-session { pointer-events: none; }
    .clickdeck-collab-capsule, .clickdeck-collab-peek { pointer-events: auto; }
    #${rootId} .clickdeck-collab-draft-note [data-collab="share-all"] { margin-left: 6px; padding: 0 4px; border: 0; min-height: 24px; background: transparent; color: #35654d; font: inherit; text-decoration: underline; }
    #${rootId} .clickdeck-collab-session button { min-height: 30px; padding: 4px 8px; border: 0; border-radius: 999px; background: transparent; color: #35654d; font: inherit; white-space: nowrap; cursor: pointer; }
    #${rootId} .clickdeck-collab-session button:hover { background: #e1ece5; }
    #${rootId} .clickdeck-collab-session button:focus-visible { outline: 2px solid #35654d; outline-offset: -2px; }
    #${rootId} .clickdeck-collab-session button:disabled { color: #64736a; opacity: .65; cursor: default; }
    .clickdeck-collab-capsule [data-session="open"] { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .clickdeck-collab-capsule [aria-pressed="true"] { background: #e1ece5 !important; }
    .clickdeck-collab-peek { padding: 12px; margin-bottom: 8px; border: 1px solid #d7e3dc; border-radius: 12px; background: #fff; box-shadow: 0 5px 18px #23302722; overflow-wrap: anywhere; }
    .clickdeck-collab-peek > div { display: flex; align-items: center; gap: 6px; }
    .clickdeck-collab-peek strong { flex: 1; min-width: 0; font-size: 13px; }
    #${rootId} .clickdeck-collab-peek p, #${rootId} .clickdeck-collab-session-status { margin: 6px 0; color: #64736a; font: inherit; overflow-wrap: anywhere; }
    #${rootId} .clickdeck-collab-session-status { padding: 8px 12px; background: #f1f7f3; border: 1px solid #d7e3dc; border-radius: 8px; }
    #${rootId} .clickdeck-collab-session-status[data-tone="error"] { color: #a44528; background: #fff2eb; }
    .clickdeck-collab-modal__header { cursor: move; touch-action: none; position: sticky; top: -1px; z-index: 3; min-height: 36px; background: #fff; }
    .clickdeck-collab-header-tools { display: flex; gap: 2px; align-items: center; }
    #${rootId} .clickdeck-collab-header-tools .clickdeck-button { border: 0; background: transparent; padding: 4px 6px; min-width: 28px; color: var(--review-muted); }
    #${rootId} .clickdeck-collab-header-tools .clickdeck-button:hover { background: #eef4f0; color: var(--review-accent); }
    .clickdeck-prompt-overlay--inline .clickdeck-prompt-modal__header { cursor: move; touch-action: none; }
    .clickdeck-collab-modal__header button { cursor: pointer; }
    .clickdeck-collab-modal details { margin: 12px 0 0; padding: 10px 0; border: 0; border-top: 1px solid var(--review-line); border-radius: 0; color: var(--review-muted); }
    .clickdeck-collab-modal summary { cursor: pointer; }
    .clickdeck-collab-modal--board { max-height: calc(100vh - 24px); }
    .clickdeck-collab-overlay--prompt .clickdeck-collab-modal--board { width: min(760px, calc(100vw - 24px)); }
    .clickdeck-collab-overlay--prompt .clickdeck-collab-modal > :not(.clickdeck-prompt-overlay) { display: none; }
    .clickdeck-prompt-overlay--inline { position: static; display: block; padding: 0; background: transparent; }
    .clickdeck-prompt-overlay--inline .clickdeck-prompt-modal { width: 100%; max-height: none; padding: 0; border: 0; box-shadow: none; }
    .clickdeck-prompt-overlay--inline textarea { height: min(55vh, 500px); }
    .clickdeck-collab-overlay[inert] { pointer-events: none; }
    .clickdeck-collab-overlay--entry { align-items: flex-start; }
    .clickdeck-collab-overlay--entry .clickdeck-collab-modal--board { height: auto; }
    .clickdeck-collab-overlay--entry .clickdeck-collab-body { display: grid; gap: 14px; font-size: 12px; line-height: 1.55; }
    .clickdeck-collab-entry-status strong { font-size: 14px; }
    .clickdeck-collab-entry-status p { margin: 4px 0 0; color: var(--review-muted); font-size: 12px; line-height: 1.55; }
    .clickdeck-collab-entry-primary { width: 100%; min-height: 42px; }
    .clickdeck-collab-entry-refresh { display: flex; align-items: center; justify-content: space-between; color: var(--review-muted); }
    .clickdeck-collab-entry-refresh .clickdeck-button { border-color: transparent; background: transparent; text-decoration: underline; }
    .clickdeck-collab-overlay--entry details { margin: 0; padding: 10px 12px; }
    .clickdeck-collab-overlay--entry details p { margin: 10px 0 0; }
    .clickdeck-collab-entry-history { display: grid; gap: 0; }
    .clickdeck-collab-overlay[inert] * { pointer-events: none !important; }
    .clickdeck-collab-choice { flex-direction: row !important; align-items: center; cursor: pointer; }
    .clickdeck-collab-diagram { display: flex; gap: 12px; align-items: center; padding: 12px; margin-top: 8px; background: #e7eee8; border-radius: 8px; color: #315b44; }
    .clickdeck-collab-window-controls { display: flex; flex-wrap: wrap; gap: 8px; }
    .clickdeck-collab-window-controls:empty { display: none; }
    .clickdeck-collab-modal__header, .clickdeck-collab-copy, .clickdeck-collab-actions, .clickdeck-collab-tabs { display: flex; gap: 8px; }
    .clickdeck-collab-modal__header { justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .clickdeck-collab-modal__header strong { display: block; font-size: 18px; font-weight: 600; }
    .clickdeck-collab-modal__header small { display: block; margin-top: 3px; color: var(--review-muted); }
    .clickdeck-collab-tabs { margin-bottom: 14px; }
    .clickdeck-collab-tabs .clickdeck-button { flex: 1; }
    .clickdeck-collab-modal form { display: flex; flex-direction: column; gap: 12px; }
    .clickdeck-collab-modal form[hidden] { display: none; }
    .clickdeck-collab-modal label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 400; }
    .clickdeck-collab-modal input:not([type="checkbox"]) { width: 100%; min-height: 36px; padding: 7px 9px; border: 1px solid var(--review-line); border-radius: 6px; background: #fff; color: var(--review-ink); box-sizing: border-box; }
    .clickdeck-collab-consent { flex-direction: row !important; align-items: flex-start; font-weight: 400 !important; line-height: 1.5; color: var(--review-muted); }
    .clickdeck-collab-consent input { margin-top: 3px; }
    .clickdeck-collab-summary { display: grid; gap: 3px; padding: 0; margin-bottom: 14px; background: transparent; }
    .clickdeck-collab-summary span { color: var(--review-muted); font-size: 12px; }
    .clickdeck-collab-project-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .clickdeck-collab-project-line > strong { font-size: 14px; font-weight: 600; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .clickdeck-collab-project-line > span { flex-shrink: 0; }
    #${rootId} .clickdeck-collab-project-line .clickdeck-button { margin-left: auto; flex-shrink: 0; padding: 2px 0; min-height: 26px; border: 0; color: var(--review-accent); background: transparent; font-size: 12px; }
    .clickdeck-collab-summary .is-expiring { color: #a54b24; }
    .clickdeck-collab-note { padding: 10px 11px; margin-bottom: 12px; border: 1px solid var(--review-line); border-radius: 8px; background: #f1f7f3; color: var(--review-muted); font-size: 12px; line-height: 1.55; }
    .clickdeck-collab-disabled-note { padding: 10px 11px; margin-bottom: 12px; border: 1px solid #e3b993; border-radius: 8px; background: #fff0e3; color: #7a3f1d; font-size: 12px; font-weight: 600; line-height: 1.55; }
    .clickdeck-collab-form-hint { margin: 0; color: var(--review-muted); font-size: 12px; line-height: 1.55; }
    .clickdeck-collab-section { padding: 12px; margin-bottom: 12px; border: 1px solid var(--review-line); border-radius: 9px; background: #fff; }
    .clickdeck-collab-section__title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 9px; }
    .clickdeck-collab-section__title strong { font-size: 13px; }
    .clickdeck-collab-section__title span { color: var(--review-muted); font-size: 11px; }
    .clickdeck-collab-members { display: flex; flex-wrap: wrap; gap: 7px; }
    .clickdeck-collab-member { display: inline-flex; align-items: baseline; gap: 6px; padding: 6px 9px; border-radius: 999px; background: #eef2ef; }
    .clickdeck-collab-member strong { font-size: 12px; }
    .clickdeck-collab-member small { color: var(--review-muted); font-size: 12px; }
    .clickdeck-collab-invite > .clickdeck-button { width: 100%; }
    .clickdeck-collab-submissions { max-height: 240px; overflow: auto; }
    .clickdeck-collab-submission-group + .clickdeck-collab-submission-group { padding-top: 11px; margin-top: 11px; border-top: 1px solid #efe2ce; }
    .clickdeck-collab-submission { padding: 8px 9px; border-radius: 7px; background: #f8f1e6; }
    .clickdeck-collab-submission + .clickdeck-collab-submission { margin-top: 7px; }
    .clickdeck-collab-submission time { display: block; color: #8a6a4e; font-size: 10px; }
    .clickdeck-collab-submission ul { padding-left: 17px; margin: 5px 0 0; font-size: 12px; line-height: 1.5; }
    .clickdeck-collab-empty { margin: 0; color: var(--review-muted); font-size: 12px; }
    .clickdeck-collab-review-board { padding: 0; overflow: visible; border: 0; border-radius: 0; background: transparent; }
    .clickdeck-collab-list-toolbar { position: sticky; top: 35px; z-index: 2; background: #fff; padding-top: 6px; }
    .clickdeck-collab-list-toolbar .clickdeck-collab-section__title { margin: 0 0 5px; align-items: center; }
    .clickdeck-collab-list-toolbar .clickdeck-collab-section__title strong { font-size: 13px; font-weight: 600; }
    .clickdeck-collab-list-toolbar .clickdeck-collab-choice { color: var(--review-muted); font-size: 12px; }
    .clickdeck-collab-review-board__hint { margin: 0; padding: 0 12px 10px; color: #8a6a4e; font-size: 11px; line-height: 1.45; }
    .clickdeck-collab-review-filters { display: flex; gap: 4px; padding: 0 0 8px; overflow-x: auto; border-bottom: 1px solid var(--review-line); }
    #${rootId} .clickdeck-collab-review-filters .clickdeck-button { flex: 0 0 auto; border: 0; min-height: 28px; padding: 4px 8px; border-radius: 5px; font-size: 12px; color: var(--review-muted); background: transparent; }
    #${rootId} .clickdeck-collab-review-filters .clickdeck-button--active { color: var(--review-accent); background: #eaf3ed; font-weight: 600; }
    .clickdeck-collab-review-list { display: grid; gap: 0; padding: 0; }
    .clickdeck-collab-review-list > .clickdeck-collab-empty { padding: 5px 4px 8px; }
    .clickdeck-collab-review-card { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 8px; width: 100%; padding: 12px 8px; box-sizing: border-box; border: 0; border-bottom: 1px solid var(--review-line); border-left: 2px solid transparent; border-radius: 0; background: #fff; color: var(--review-ink); text-align: left; cursor: pointer; }
    .clickdeck-collab-review-card[hidden] { display: none; }
    .clickdeck-collab-review-card:hover { background: #f6f9f7; }
    .clickdeck-collab-review-card.is-active { border-left-color: var(--review-accent); background: #f1f7f3; }
    .clickdeck-collab-review-card__number { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 999px; background: #e3eee7; color: var(--review-accent); font-size: 12px; font-weight: 600; }
    .clickdeck-collab-review-card__body { display: grid; gap: 5px; min-width: 0; }
    .clickdeck-collab-review-context { display: flex; align-items: center; gap: 5px; min-width: 0; }
    .clickdeck-collab-location { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--review-muted); font-size: 12px; }
    .clickdeck-collab-review-context .clickdeck-collab-location { flex: 1; }
    #${rootId} .clickdeck-collab-modal .clickdeck-collab-inline-preview { flex-shrink: 0; padding: 0 3px; min-height: 22px; border: 0; color: var(--review-accent); font-size: 12px; }
    .clickdeck-collab-target-short { color: var(--review-muted); font-size: 12px; overflow-wrap: anywhere; }
    .clickdeck-collab-summary-button { flex: 1 1 160px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 0; padding: 0; background: transparent; color: var(--review-ink); font: inherit; font-size: 14px; font-weight: 600; line-height: 24px; text-align: left; cursor: pointer; }
    .clickdeck-collab-summary-button:focus-visible { outline: 2px solid var(--review-accent); outline-offset: 2px; }
    [data-collab-item-detail][hidden] { display: none; }
    [data-collab-item-detail]:not([hidden]) { display: grid; gap: 7px; padding-top: 8px; border-top: 1px solid #ead9bd; }
    [data-collab-item-detail] .clickdeck-button { justify-self: start; min-height: 28px; }
    .clickdeck-collab-review-card__meta .clickdeck-collab-choice { flex-shrink: 0; margin: 0; min-width: 20px; min-height: 24px; }
    .clickdeck-collab-modal .clickdeck-collab-list-help { margin: 4px 8px 10px; padding: 5px 8px; font-size: 11px; color: #80664d; }
    .clickdeck-collab-window-controls .clickdeck-button { min-height: 28px; padding: 4px 8px; font-size: 11px; }
    .clickdeck-collab-review-card__meta { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .clickdeck-collab-author { flex: 0 4 auto; min-width: 28px; max-width: 72px; padding: 1px 6px; border-radius: 999px; background: #e9eeeb; color: #53665a; font-size: 12px; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .clickdeck-collab-conflict { flex-shrink: 0; padding: 0 5px; border-radius: 4px; background: #fff0e9; color: #a44528; font-size: 11px; font-style: normal; }
    .clickdeck-collab-review-card__description { overflow-wrap: anywhere; font-size: 13px; font-weight: 400; line-height: 1.5; }
    .clickdeck-collab-review-card small { font-size: 12px; }
    .clickdeck-collab-review-card small.is-locatable { color: #3f6b55; }
    .clickdeck-collab-review-card small.is-unlocatable { color: #a55a32; }
    .clickdeck-collab-filter-empty { margin: 0; padding: 4px 12px 12px; color: var(--review-muted); font-size: 12px; }
    .clickdeck-collab-filter-empty[hidden] { display: none; }
    .clickdeck-collab-stale-note, .clickdeck-collab-capacity-note { padding: 9px 10px; margin-bottom: 12px; border-radius: 7px; font-size: 11px; line-height: 1.45; }
    .clickdeck-collab-stale-note { background: #fff3df; color: #7a4c20; }
    .clickdeck-collab-capacity-note { background: #f7ecd8; color: #79572f; }
    .clickdeck-collab-capacity-note.is-full { background: #fbe5de; color: #9c3f26; }
    .clickdeck-collab-marker-layer { position: fixed; inset: 0; z-index: 10002; pointer-events: none; }
    .clickdeck-collab-page-highlight { position: fixed; border: 2px solid #35654d; border-radius: 5px; background: rgba(53, 101, 77, 0.08); box-shadow: 0 0 0 3px rgba(53, 101, 77, 0.12); box-sizing: border-box; pointer-events: none; }
    .clickdeck-collab-page-marker { position: fixed; display: grid; place-items: center; width: 27px; height: 27px; padding: 0; border: 2px solid #fff; border-radius: 999px; background: #3f6b55; color: #fff; box-shadow: 0 3px 12px rgba(35, 48, 39, 0.35); font: 700 12px/1 system-ui, sans-serif; cursor: pointer; pointer-events: auto; }
    .clickdeck-collab-page-marker:hover, .clickdeck-collab-page-marker.is-active { background: #234c38; transform: scale(1.08); }
    .clickdeck-collab-page-marker.has-conflict { background: #b8472d; }
    .clickdeck-collab-page-marker.is-draft { border: 2px dashed #64736a; background: #fff; color: #35654d; min-width: 30px; width: auto; padding: 0 3px; }
    .clickdeck-collab-page-highlight.is-draft { border-style: dashed; background: transparent; box-shadow: none; }
    .clickdeck-collab-review-card.is-draft .clickdeck-collab-review-card__number { border: 1px dashed #64736a; background: #fff; box-sizing: border-box; }
    .clickdeck-collab-kind { flex-shrink: 0; color: #64736a; font-size: 11px; }
    #${rootId} .clickdeck-collab-scopes { display: flex; gap: 14px; border-bottom: 1px solid #e1e8e3; margin-bottom: 8px; }
    #${rootId} .clickdeck-collab-scopes button { border: 0; border-bottom: 2px solid transparent; background: transparent; color: #64736a; padding: 5px 0; font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }
    #${rootId} .clickdeck-collab-scopes [aria-pressed="true"] { border-bottom-color: #35654d; color: #35654d; font-weight: 600; }
    #${rootId} .clickdeck-collab-location-heading { font-size: 11px; font-weight: 600; color: #64736a; padding: 8px 0 0; }
    .clickdeck-collab-actions[hidden], [data-collab-location-group][hidden] { display: none; }
    @media (max-width: 360px) {
      .clickdeck-collab-modal__header strong { font-size: 16px; white-space: nowrap; }
      #${rootId} .clickdeck-collab-header-tools .clickdeck-button { min-width: 20px; padding: 4px 3px; font-size: 12px; white-space: nowrap; }
      #${rootId} .clickdeck-collab-scopes { gap: 8px; margin-bottom: 0; }
      .clickdeck-collab-list-toolbar .clickdeck-collab-section__title { gap: 6px; }
    }
    .clickdeck-collab-page-marker__label { position: absolute; right: 31px; top: 50%; max-width: 180px; padding: 5px 7px; border-radius: 6px; background: #283c32; color: #fff; box-shadow: 0 3px 10px rgba(35, 48, 39, 0.25); opacity: 0; overflow: hidden; transform: translateY(-50%); white-space: nowrap; text-overflow: ellipsis; pointer-events: none; }
    .clickdeck-collab-page-marker:hover .clickdeck-collab-page-marker__label, .clickdeck-collab-page-marker.is-active .clickdeck-collab-page-marker__label { opacity: 1; }
    .clickdeck-collab-copy { margin-bottom: 12px; }
    .clickdeck-collab-copy input { flex: 1; font-family: monospace; }
    .clickdeck-collab-actions { position: sticky; bottom: 0; z-index: 2; flex-wrap: wrap; margin: 12px 0 0; padding: 10px 0; background: #fff; border-top: 1px solid var(--review-line); box-shadow: 0 18px 0 #fff; }
    .clickdeck-collab-actions .clickdeck-button--primary { flex: 1; }
    #${rootId} .clickdeck-collab-actions .clickdeck-button:not(.clickdeck-button--primary) { background: transparent; border-color: transparent; color: var(--review-muted); }
    .clickdeck-collab-fineprint { margin: 0; color: var(--review-muted); font-size: 12px; line-height: 1.5; }
    .clickdeck-collab-modal__message { padding: 9px 10px; margin-bottom: 12px; border-radius: 6px; background: #f1f7f3; color: var(--review-muted); font-size: 12px; }
    .clickdeck-collab-modal__message[data-tone="error"] { background: #fff2eb; color: #a44528; }
    .clickdeck-collab-modal__busy { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(255, 250, 243, 0.82); font-weight: 600; }

    .clickdeck-svg-text-modal__rows {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: min(360px, calc(100vh - 260px));
      overflow-y: auto;
    }

    .clickdeck-svg-text-modal__row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .clickdeck-svg-text-modal__label {
      font-size: 11px;
      font-weight: 600;
      color: #6b4e35;
    }

    .clickdeck-svg-text-modal__input {
      width: 100%;
      min-height: 34px;
      padding: 0 10px;
      border: 1px solid #e8d5b0;
      border-radius: 6px;
      background: #fff;
      color: #3d2f24;
      font-size: 13px;
    }

    .clickdeck-svg-text-modal__input:focus {
      outline: 2px solid #c8a47a;
      outline-offset: -1px;
    }

    .clickdeck-svg-inline-highlight {
      border: 2px solid rgba(249, 115, 22, 0.9);
      border-radius: 6px;
      box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.18);
      background: rgba(255, 255, 255, 0.02);
      pointer-events: none;
    }

    .clickdeck-svg-inline-popover {
      position: fixed;
      min-width: 180px;
      max-width: min(280px, calc(100vw - 24px));
      padding: 10px;
      border: 1px solid rgba(120, 84, 53, 0.22);
      border-radius: 10px;
      background: rgba(255, 250, 244, 0.98);
      box-shadow: 0 16px 36px rgba(49, 33, 18, 0.18);
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: auto;
      z-index: 2147483647;
    }

    .clickdeck-svg-inline-popover__title {
      font-size: 11px;
      font-weight: 700;
      color: #6b4e35;
      line-height: 1.3;
    }

    .clickdeck-svg-inline-popover__input {
      width: 100%;
      min-height: 34px;
      padding: 0 10px;
      border: 1px solid rgba(120, 84, 53, 0.24);
      border-radius: 8px;
      background: #fff;
      caret-color: currentColor;
    }

    .clickdeck-svg-inline-popover__input:focus {
      outline: 2px solid rgba(185, 133, 74, 0.9);
      outline-offset: 0;
    }

    .clickdeck-svg-inline-popover__actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
    }

    .clickdeck-svg-inline-popover__button {
      min-width: 54px;
      height: 28px;
      padding: 0 10px;
      border: 1px solid rgba(120, 84, 53, 0.22);
      border-radius: 7px;
      background: #fff;
      color: #4b3525;
      font-size: 12px;
      font-weight: 600;
      pointer-events: auto;
      cursor: pointer;
    }

    .clickdeck-svg-inline-popover__button--primary {
      background: #f59e0b;
      border-color: #f59e0b;
      color: #fff;
    }

    .clickdeck-notice {
      background: #fff3df;
      border: 1px solid #e8d5b0;
      border-radius: 8px;
      padding: 10px 12px;
      margin: 12px 14px 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .clickdeck-notice__title {
      font-size: 12px;
      font-weight: 600;
      color: #3d2f24;
    }

    .clickdeck-notice__actions {
      display: flex;
      gap: 6px;
    }

    .clickdeck-panel__footer {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid rgba(120, 84, 53, 0.14);
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 6px;
      color: #8a6a4e;
      font-size: 11px;
      line-height: 1.4;
    }

    .clickdeck-panel__footer a {
      color: #6b4e35;
      text-decoration: underline;
      text-underline-offset: 2px;
      pointer-events: auto;
    }

    @media print {
      [data-clickdeck="true"] {
        display: none !important;
      }
    }

    .clickdeck-presenting [data-clickdeck="true"],
    .clickdeck-presenting .clickdeck-panel,
    .clickdeck-presenting .clickdeck-outline,
    .clickdeck-exporting [data-clickdeck="true"],
    .clickdeck-exporting .clickdeck-panel,
    .clickdeck-exporting .clickdeck-outline {
      display: none !important;
    }

    .clickdeck-exporting,
    .clickdeck-exporting body {
      scrollbar-width: none !important;
    }

    .clickdeck-exporting::-webkit-scrollbar,
    .clickdeck-exporting body::-webkit-scrollbar {
      display: none !important;
    }

    .clickdeck-presenting,
    .clickdeck-presenting body {
      overflow: hidden !important;
    }

    .clickdeck-presenting .clickdeck-presentation-hidden-slide {
      display: none !important;
    }

    .clickdeck-presenting .clickdeck-presenting-slide {
      position: fixed !important;
      left: 50% !important;
      top: 50% !important;
      transform: translate(-50%, -50%) scale(var(--clickdeck-present-scale, 1)) !important;
      transform-origin: center center !important;
      z-index: 2147483000 !important;
      max-width: none !important;
      max-height: none !important;
      animation: clickdeckFadeIn 0.3s ease-out;
    }

    @keyframes clickdeckFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `;
  document.documentElement.append(style);
}
