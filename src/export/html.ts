import type { ClickDeckLogger } from "../diagnostics/logger";

function ensureBaseTag(clone: HTMLElement): void {
  // Inject <base> tag to ensure relative URLs (images, css) still work.
  // Note: external resources still depend on their original URLs; this is not an offline packager.
  const baseEl = document.createElement("base");
  baseEl.href = window.location.href;
  
  let head = clone.querySelector("head");
  if (!head) {
    head = document.createElement("head");
    clone.insertBefore(head, clone.firstChild);
  }
  head.prepend(baseEl);
  
  // Ensure charset is set to utf-8 to avoid encoding issues
  if (!head.querySelector("meta[charset]")) {
    const metaCharset = document.createElement("meta");
    metaCharset.setAttribute("charset", "utf-8");
    head.prepend(metaCharset);
  }
}

function syncInlineStyles(sourceRoot: HTMLElement, cloneRoot: HTMLElement): void {
  const sourceElements = [sourceRoot, ...Array.from(sourceRoot.querySelectorAll<HTMLElement>("*"))];
  const cloneElements = [cloneRoot, ...Array.from(cloneRoot.querySelectorAll<HTMLElement>("*"))];

  const length = Math.min(sourceElements.length, cloneElements.length);
  for (let index = 0; index < length; index += 1) {
    const source = sourceElements[index];
    const clone = cloneElements[index];
    const styleAttr = source.getAttribute("style");
    if (styleAttr === null) {
      clone.removeAttribute("style");
      continue;
    }
    clone.setAttribute("style", styleAttr);
  }
}

export function exportHtmlSnapshot(logger: ClickDeckLogger): void {
  try {
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    syncInlineStyles(document.documentElement, clone);
    
    // Remove ClickDeck UI
    const elementsToRemove = clone.querySelectorAll("[data-clickdeck='true'], #clickdeck-style, .clickdeck-panel, .clickdeck-outline");
    elementsToRemove.forEach(el => el.remove());

    // Remove ClickDeck specific state classes
    clone.classList.remove("clickdeck-presenting", "clickdeck-exporting");
    const body = clone.querySelector("body");
    if (body) {
      body.classList.remove("clickdeck-presenting", "clickdeck-exporting");
    }

    ensureBaseTag(clone);

    const htmlContent = clone.outerHTML;
    // Prepend doctype if the document has one
    const doctype = document.doctype 
      ? `<!DOCTYPE ${document.doctype.name}>` 
      : "<!DOCTYPE html>";

    const comment = "\n<!-- Exported by ClickDeck Snapshot. Modifications applied to DOM are preserved. Original source files are not rewritten. -->\n";
    const fullHtml = `${doctype}${comment}${htmlContent}`;

    const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `clickdeck-snapshot-${Date.now()}.html`;
    a.dataset.clickdeck = "true";
    a.click();

    URL.revokeObjectURL(url);
    logger.info(
      "HTML snapshot exported. Note: external images/fonts still rely on their original URLs. data: URL images are preserved."
    );
  } catch (error) {
    logger.error("Failed to export HTML snapshot", { error });
  }
}
