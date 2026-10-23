import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AddressInfo } from "node:net";
import { chromium, expect, test as base, BrowserContext, Page } from "@playwright/test";

type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
  demoPageUrl: string;
  presentationActivePrevUrl: string;
};

const CHROME_UNSAFE_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161,
  179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563,
  587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061,
  6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080
]);

async function listenOnSafePort(server: ReturnType<typeof createServer>): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    if (!CHROME_UNSAFE_PORTS.has(port)) {
      return port;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  throw new Error("Failed to allocate a Chrome-safe local test port");
}

const test = base.extend<ExtensionFixtures>({
  page: async ({}, use) => {
    const projectRoot = process.cwd();
    const extensionPath = path.join(projectRoot, "dist");
    const context = await chromium.launchPersistentContext("", {
      channel: "msedge",
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });
    
    // Grant clipboard permissions
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    
    // A persistent context has one page by default
    const page = context.pages()[0] || await context.newPage();
    await use(page);
    await context.close();
  },
  demoPageUrl: async ({}, use) => {
    const projectRoot = process.cwd();
    const fixturePath = path.join(projectRoot, "fixtures");
    const server = createServer(async (request, response) => {
      const requestPath = new URL(request.url || "/", "http://127.0.0.1").pathname;
      const fixtureName = requestPath.replace(/^\//, "");

      try {
        if (fixtureName.endsWith(".html")) {
          const html = await readFile(path.join(fixturePath, fixtureName), "utf8");
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end(html);
          return;
        }
        if (fixtureName === "test-image.png") {
          const image = await readFile(path.join(fixturePath, "test-image.png"));
          response.writeHead(200, { "content-type": "image/png" });
          response.end(image);
          return;
        }
      } catch {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      response.writeHead(404);
      response.end("Not found");
    });

    const port = await listenOnSafePort(server);
    await use(`http://127.0.0.1:${port}/demo-page.html`);
    server.close();
  },
  presentationActivePrevUrl: async ({ demoPageUrl }, use) => {
    await use(demoPageUrl.replace("/demo-page.html", "/presentation-active-prev-fixture.html"));
  }
});

// Helper to activate extension on a page
async function activateExtension(page: Page) {
  const root = page.locator("#clickdeck-root");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.keyboard.press("Alt+Shift+C");
    try {
      await expect(root).toBeVisible({ timeout: 2000 });
      return;
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
      await page.waitForTimeout(400);
    }
  }
}

test.describe("ClickDeck core editing workflows", () => {
  test("loads the extension and applies a style change on a page element", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);

    const heading = page.getByRole("heading", { name: "Quarterly Product Review" });
    const initialFontSize = await heading.evaluate((element) => getComputedStyle(element).fontSize);

    await heading.click();
    await page.locator("[data-action='font-larger']").click();

    const updatedFontSize = await heading.evaluate((element) => getComputedStyle(element).fontSize);
    expect(parseFloat(updatedFontSize)).toBeGreaterThan(parseFloat(initialFontSize));

    const initialFontWeight = await heading.evaluate((element) => getComputedStyle(element).fontWeight);
    await page.locator("[data-action='weight-increase']").click();
    const updatedFontWeight = await heading.evaluate((element) => getComputedStyle(element).fontWeight);
    
    // font-weight should be greater or bolder
    const fwCurrent = initialFontWeight === "normal" ? 400 : (initialFontWeight === "bold" ? 700 : parseInt(initialFontWeight));
    const fwNext = updatedFontWeight === "normal" ? 400 : (updatedFontWeight === "bold" ? 700 : parseInt(updatedFontWeight));
    expect(fwNext).toBeGreaterThan(fwCurrent);

    await page.locator("[data-action='undo']").click();
    const undoneFontWeight = await heading.evaluate((element) => getComputedStyle(element).fontWeight);
    expect(undoneFontWeight).toBe(initialFontWeight);

    await page.locator("[data-action='undo']").click();
    const undoneFontSize = await heading.evaluate((element) => getComputedStyle(element).fontSize);
    expect(undoneFontSize).toBe(initialFontSize);
  });

  test("1. Esc cancels selection", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);

    const heading = page.getByRole("heading", { name: "Quarterly Product Review" });
    await heading.click();
    
    // Outline should be visible around the heading
    const root = page.locator("#clickdeck-root");
    const outline = root.locator(".clickdeck-outline");
    await expect(outline).toBeVisible();
    
    // Press Esc
    await page.keyboard.press("Escape");
    await page.mouse.move(0, 0); // Move mouse away so hover outline doesn't stay
    
    // Outline should be hidden
    await expect(outline).toBeHidden();
    
    // The panel shouldn't even show typography controls when nothing is selected (Task 29 logic)
    const fontLargerBtn = page.locator("[data-action='font-larger']");
    await expect(fontLargerBtn).toBeHidden();
  });

  test("2. Tab/Shift+Tab switches selection", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);

    // Select the first span inside the article
    const span = page.locator("article span").first();
    await span.click();
    
    const panelHint = page.locator(".clickdeck-panel__hint");
    await expect(panelHint).toContainText("span");
    
    // Press tab to select parent
    await page.keyboard.press("Tab");
    
    // Should now select the article
    await expect(panelHint).toContainText("article");
    
    // Press Shift+Tab to go back to the first child (strong)
    await page.keyboard.press("Shift+Tab");
    // Just expect it to change from article (to strong or whatever first child is)
    await expect(panelHint).not.toContainText("article");
  });

  test("3. Prompt generation includes locators", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);

    const heading = page.getByRole("heading", { name: "Quarterly Product Review" });
    await heading.click();
    await page.locator("[data-action='font-larger']").click();

    await page.locator("[data-action='copy-ai-prompt']").click();
    
    const modal = page.locator(".clickdeck-prompt-modal");
    await expect(modal).toBeVisible();
    
    const textarea = modal.locator("textarea");
    const promptText = await textarea.inputValue();
    
    expect(promptText).toContain("Quarterly Product Review"); // locator context
    expect(promptText).toContain("fontSize");
    expect(promptText).toContain("Machine location evidence:");
    expect(promptText).toContain("Original HTML source location:");
    expect(promptText).toMatch(/demo-page\.html:\d+:\d+/);
    expect(promptText).toContain("confidence: high");
  });

  test("4. Prompt does not include undone changes", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);

    const heading = page.getByRole("heading", { name: "Quarterly Product Review" });
    await heading.click();
    await page.locator("[data-action='font-larger']").click();
    
    const p = page.locator("p").first();
    await p.click();
    await page.locator("[data-action='font-smaller']").click();
    
    // Undo the second change
    await page.locator("[data-action='undo']").click();
    
    // Open prompt
    await page.locator("[data-action='copy-ai-prompt']").click();
    const modal = page.locator(".clickdeck-prompt-modal");
    await expect(modal).toBeVisible();

    const promptText = await modal.locator("textarea").inputValue();
    
    // Should contain the first change (font-size on heading)
    expect(promptText).toContain("Quarterly Product Review");
    // Should NOT contain the second change (on the p element)
    expect(promptText).not.toContain("This page is a stable local fixture");
  });

  test("5. Image replace with undo/redo", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);

    const img = page.locator("#test-image");
    await img.click();
    
    // Initial src
    const initialSrc = await img.evaluate((element: HTMLImageElement) => element.src);
    
    // Upload image
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator("[data-action='replace-image']").click();
    const fileChooser = await fileChooserPromise;
    
    // Point to the same test image just as a file payload to simulate upload
    const projectRoot = process.cwd();
    await fileChooser.setFiles(path.join(projectRoot, "fixtures", "test-image.png"));
    
    // Wait for the src to update to data URI
    await expect(img).not.toHaveAttribute("src", initialSrc);
    const dataUrlSrc = await img.evaluate((element: HTMLImageElement) => element.src);
    expect(dataUrlSrc).toContain("data:image/");
    
    // Undo
    await page.locator("[data-action='undo']").click();
    await expect(img).toHaveJSProperty("src", initialSrc);
    
    // Redo
    await page.locator("[data-action='redo']").click();
    await expect(img).toHaveJSProperty("src", dataUrlSrc);
  });

  test("selects complex elements as whole blocks with safe controls", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await page.evaluate(() => {
      const host = document.createElement("section");
      host.id = "complex-fixture";
      host.innerHTML = `
        <svg id="complex-svg" width="120" height="80" style="display:block; width:120px; height:80px;">
          <rect id="complex-svg-rect" x="10" y="10" width="80" height="40" fill="#88c"></rect>
        </svg>
        <span id="complex-formula" class="katex" style="font-size:20px;"><span id="complex-formula-child">x + 1</span></span>
        <iframe id="complex-iframe" srcdoc="<main><p>Nested content</p></main>" style="display:block; width:160px; height:80px;"></iframe>
      `;
      document.body.prepend(host);
    });
    await activateExtension(page);

    await page.locator("#complex-svg-rect").click();
    await expect(page.locator(".clickdeck-panel__complex-notice")).toContainText("svg");
    await expect(page.locator("[data-section='typography']")).toBeHidden();
    await expect(page.locator("[data-section='image-basic']")).toBeHidden();

    const svgWidthBefore = await page.locator("#complex-svg").evaluate((element) => getComputedStyle(element).width);
    await page.locator("[data-section='complex-basic'] [data-action='image-width-larger']").click();
    const svgWidthAfter = await page.locator("#complex-svg").evaluate((element) => getComputedStyle(element).width);
    expect(parseFloat(svgWidthAfter)).toBeGreaterThan(parseFloat(svgWidthBefore));

    await page.locator("#complex-formula-child").click();
    await expect(page.locator(".clickdeck-panel__complex-notice")).toContainText("formula");
    await expect(page.locator("[data-section='complex-basic']")).toBeVisible();

    await page.locator("#complex-iframe").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + 4,
          clientY: rect.top + 4,
        }),
      );
    });
    await expect(page.locator(".clickdeck-panel__complex-notice")).toContainText("iframe");
    await expect(page.locator("[data-action='replace-image']")).toBeHidden();
  });

  test("edits simple inline SVG text in place with undo and redo", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await page.evaluate(() => {
      const host = document.createElement("section");
      host.id = "svg-text-fixture";
      host.innerHTML = `
        <svg id="editable-svg" width="220" height="80" style="display:block; width:220px; height:80px;">
          <text id="editable-svg-text" x="12" y="42">Hello</text>
          <text x="12" y="66"><tspan id="editable-svg-tspan">World</tspan></text>
        </svg>
      `;
      document.body.prepend(host);
    });
    await activateExtension(page);

    await page.locator("#editable-svg-text").click();
    await expect(page.locator(".clickdeck-panel__complex-notice")).toContainText("svg");
    await expect(page.locator(".clickdeck-panel__svg-text-status")).toContainText("Click the text itself to edit in place");

    const textBox = await page.locator("#editable-svg-text").boundingBox();
    const highlight = page.locator(".clickdeck-svg-inline-highlight");
    const inlineEditor = page.locator(".clickdeck-svg-inline-popover");
    const inlineInput = page.locator(".clickdeck-svg-inline-popover__input");
    await expect(highlight).toBeVisible();
    await expect(inlineEditor).toBeVisible();
    const editorBox = await inlineEditor.boundingBox();
    const highlightBox = await highlight.boundingBox();
    expect(textBox).not.toBeNull();
    expect(editorBox).not.toBeNull();
    expect(highlightBox).not.toBeNull();
    if (textBox && editorBox && highlightBox) {
      expect(Math.abs(highlightBox.x - (textBox.x - 4))).toBeLessThanOrEqual(4);
      expect(Math.abs(highlightBox.y - (textBox.y - 4))).toBeLessThanOrEqual(4);
      expect(editorBox.y).toBeGreaterThanOrEqual(textBox.y + textBox.height + 4);
    }
    await inlineInput.fill("Lens");
    await expect(page.locator("#editable-svg-text")).toHaveText("Lens");
    await inlineInput.press("Enter");

    await page.locator("#editable-svg-tspan").click();
    await expect(inlineEditor).toBeVisible();
    await inlineInput.fill("Deck");
    await expect(page.locator("#editable-svg-tspan")).toHaveText("Deck");
    await inlineInput.press("Enter");

    await expect(page.locator("#editable-svg-text")).toHaveText("Lens");
    await expect(page.locator("#editable-svg-tspan")).toHaveText("Deck");

    await page.locator("[data-action='undo']").click();
    await expect(page.locator("#editable-svg-text")).toHaveText("Lens");
    await expect(page.locator("#editable-svg-tspan")).toHaveText("World");

    await page.locator("[data-action='undo']").click();
    await expect(page.locator("#editable-svg-text")).toHaveText("Hello");
    await expect(page.locator("#editable-svg-tspan")).toHaveText("World");

    await page.locator("[data-action='redo']").click();
    await page.locator("[data-action='redo']").click();
    await expect(page.locator("#editable-svg-text")).toHaveText("Lens");
    await expect(page.locator("#editable-svg-tspan")).toHaveText("Deck");
  });

  test("does not expose SVG text editing for complex SVG text structures", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await page.evaluate(() => {
      const host = document.createElement("section");
      host.id = "svg-complex-text-fixture";
      host.innerHTML = `
        <svg id="complex-svg-text" width="220" height="80" style="display:block; width:220px; height:80px;">
          <defs>
            <path id="curve" d="M10 50 Q 110 0 210 50"></path>
          </defs>
          <text id="complex-svg-text-node"><textPath href="#curve">Curved title</textPath></text>
        </svg>
      `;
      document.body.prepend(host);
    });
    await activateExtension(page);

    await page.locator("#complex-svg-text-node").click();
    await expect(page.locator(".clickdeck-panel__complex-notice")).toContainText("svg");
    await expect(page.locator(".clickdeck-panel__svg-text-status")).toContainText("structure is too complex");
    await expect(page.locator("[data-action='edit-svg-text']")).toHaveCount(0);
    await expect(page.locator(".clickdeck-svg-inline-popover")).toHaveCount(0);
  });

  test("6. Save/Restore persistence", async ({ page, demoPageUrl }) => {
    // Clear storage first
    await page.goto(demoPageUrl);
    await page.evaluate(() => {
      // Clear chrome storage if accessible, or just rely on the controller logic
      if ((window as any).chrome?.storage?.local) {
        (window as any).chrome.storage.local.clear();
      }
    });

    await activateExtension(page);

    const heading = page.getByRole("heading", { name: "Quarterly Product Review" });
    const initialFontSize = await heading.evaluate((element) => getComputedStyle(element).fontSize);
    
    await heading.click();
    await page.locator("[data-action='font-larger']").click();
    
    const updatedFontSize = await heading.evaluate((element) => getComputedStyle(element).fontSize);
    
    // Reload page
    await page.reload();
    
    // Heading should be back to initial state before clickdeck is activated
    const resetFontSize = await heading.evaluate((element) => getComputedStyle(element).fontSize);
    expect(resetFontSize).toBe(initialFontSize);
    
    // Activate extension again, it should detect saved edits and show notice
    await activateExtension(page);
    
    const notice = page.locator(".clickdeck-notice");
    await expect(notice).toBeVisible();
    
    // Click Restore
    await page.locator("[data-notice-action='restore']").click();
    
    // Heading should have the updated font size applied
    const restoredFontSize = await heading.evaluate((element) => getComputedStyle(element).fontSize);
    expect(restoredFontSize).toBe(updatedFontSize);
    
    // Notice should be gone
    await expect(notice).toBeHidden();
  });

  test("7. Panel collapse and transparency", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);

    const root = page.locator("#clickdeck-root");
    const panel = root.locator(".clickdeck-panel");
    const content = panel.locator(".clickdeck-panel__content-wrapper");
    const floatBtn = panel.locator(".clickdeck-panel__floating-button");

    // Initially, content is visible, float btn is hidden
    await expect(content).toBeVisible();
    await expect(floatBtn).toBeHidden();
    await expect(panel).not.toHaveClass(/clickdeck-panel--collapsed/);

    // Click transparency twice
    const transBtn = panel.locator("[data-internal-action='transparency']");
    await transBtn.click();
    await expect(panel).toHaveClass(/clickdeck-panel--opacity-70/);
    await transBtn.click();
    await expect(panel).toHaveClass(/clickdeck-panel--opacity-40/);
    await transBtn.click();
    await expect(panel).not.toHaveClass(/clickdeck-panel--opacity-70/);
    await expect(panel).not.toHaveClass(/clickdeck-panel--opacity-40/);

    // Click collapse
    await panel.locator("[data-internal-action='collapse']").click();
    await expect(panel).toHaveClass(/clickdeck-panel--collapsed/);
    // Use evaluate to check display:none because playwright's toBeHidden might check bounding box, but floatBtn is visible inside it.
    await expect(content).not.toBeVisible();
    await expect(floatBtn).toBeVisible();

    const outline = root.locator(".clickdeck-outline");
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.id = "native-click-target";
      button.textContent = "Native page button";
      button.addEventListener("click", () => {
        document.body.dataset.nativeClicked = "true";
      });
      document.body.appendChild(button);
    });

    // While collapsed, ClickDeck should behave like browsing mode: page clicks pass through.
    await page.locator("#native-click-target").click();
    await expect.poll(() => page.evaluate(() => document.body.dataset.nativeClicked)).toBe("true");
    await expect(outline).toBeHidden();

    // Click floating button to restore
    await floatBtn.click();
    await expect(panel).not.toHaveClass(/clickdeck-panel--collapsed/);
    await expect(content).toBeVisible();
    await expect(floatBtn).toBeHidden();

    // Restoring should bring editing selection back without losing state.
    const heading = page.getByRole("heading", { name: "Quarterly Product Review" });
    await heading.click();
    await expect(outline).toBeVisible();
  });

  test("8. Long image export", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);

    const exportBtn = page.locator("[data-action='export-long-image']");
    
    // Mock the capture API via our exposed flag
    await page.evaluate(() => {
      (window as any).__MOCK_CAPTURE_VISIBLE_TAB = true;
    });

    await exportBtn.click();
    
    // The UI should hide (clickdeck-exporting added)
    await expect(page.locator("html")).toHaveClass(/clickdeck-exporting/);
    
    // Eventually the export finishes and UI is restored
    await expect(page.locator("html")).not.toHaveClass(/clickdeck-exporting/, { timeout: 10000 });
  });

  test("9. Presentation mode syncs active/prev fixture state", async ({ page, presentationActivePrevUrl }) => {
    await page.goto(presentationActivePrevUrl);
    await activateExtension(page);

    await page.locator("[data-action='present']").click();
    await expect(page.locator("html")).toHaveClass(/clickdeck-presenting/);
    await expect(page.locator("#ap-slide-1")).toHaveClass(/active/);
    await expect(page.locator(".nav-dot").nth(0)).toHaveClass(/active/);

    await page.keyboard.press("ArrowRight");

    await expect(page.locator("#ap-slide-2")).toHaveClass(/active/);
    await expect(page.locator("#ap-slide-1")).toHaveClass(/prev/);
    await expect(page.locator(".nav-dot").nth(1)).toHaveClass(/active/);
    await expect(page.locator("#currentSlide")).toHaveText("2");
    await expect.poll(async () => {
      return page.locator("#ap-slide-2").evaluate((element) => getComputedStyle(element).opacity);
    }).toBe("1");

    await page.keyboard.press("Escape");
    await expect(page.locator("html")).not.toHaveClass(/clickdeck-presenting/);
    await expect(page.locator("#clickdeck-root")).toBeVisible();
  });

  test("presentation starts from the visible host page, not zero-sized hidden slides", async ({ page, presentationActivePrevUrl }) => {
    await page.goto(presentationActivePrevUrl);
    await page.addStyleTag({ content: '.slide:not(.active) { display: none; }' });
    await page.evaluate(() => {
      document.querySelector('#ap-slide-1')!.classList.remove('active');
      document.querySelector('#ap-slide-2')!.classList.add('active');
    });
    await activateExtension(page);
    await page.locator('[data-action="present"]').click();
    await expect(page.locator('#ap-slide-2')).toHaveClass(/clickdeck-presenting-slide/);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#ap-slide-3')).toHaveClass(/clickdeck-presenting-slide/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#ap-slide-3')).toHaveClass(/active/);
    await page.locator('[data-action="present"]').click();
    await expect(page.locator('#ap-slide-3')).toHaveClass(/clickdeck-presenting-slide/);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#ap-slide-2')).toHaveClass(/clickdeck-presenting-slide/);
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).not.toHaveClass(/clickdeck-presenting/);
  });

  test("presentation centers slides inside a generic will-change ancestor and restores it", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await page.evaluate(() => {
      document.body.innerHTML = '<main id="generic-wide" style="position:relative;width:700vw;display:flex;will-change:transform!important;transition:transform 2s!important"><section class="slide" style="width:100vw;height:100vh;flex:0 0 100vw">Generic first</section><section class="slide" style="width:100vw;height:100vh;flex:0 0 100vw">Generic second</section></main>';
    });
    const before = await page.locator('#generic-wide').getAttribute('style');
    await activateExtension(page);
    await page.locator('[data-action="present"]').click();
    for (let i=0; i<2; i++) {
      if (i) await page.keyboard.press('ArrowRight');
      const box = await page.locator('.clickdeck-presenting-slide').boundingBox();
      const width = await page.evaluate(() => innerWidth);
      expect(Math.abs(box!.x + box!.width/2 - width/2)).toBeLessThan(2);
      expect(box!.width).toBeGreaterThan(width*0.8);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).not.toHaveClass(/clickdeck-presenting/);
    expect(await page.locator('#generic-wide').getAttribute('style')).toBe(before);
  });

  test("browse mode restores host navigation and review controls keep keys local", async ({ page, presentationActivePrevUrl }) => {
    await page.goto(presentationActivePrevUrl);
    await page.evaluate(() => {
      // This presentation fixture originally has no clickable host navigation behavior.
      // Keep its nav above its slides while installing a native navigation fixture.
      (document.querySelector('.nav-dots') as HTMLElement).style.zIndex = '10';
      const slides = Array.from(document.querySelectorAll('.slide'));
      const go = (index: number) => slides.forEach((slide, i) => slide.classList.toggle('active', i === index));
      document.querySelectorAll('.nav-dot').forEach((button, i) => button.addEventListener('click', () => go(i)));
      window.addEventListener('keydown', event => {
        if (event.key === 'ArrowRight') go((slides.findIndex(slide => slide.classList.contains('active')) + 1) % slides.length);
      });
    });
    await activateExtension(page);
    const heading = page.locator('#ap-slide-1 h1');
    await heading.click();
    await page.locator('[data-action="font-larger"]').click();
    const font = await heading.evaluate(el => el.style.fontSize);
    await page.locator('[data-internal-action="collapse"]').click();
    await expect(heading).not.toHaveAttribute('contenteditable', 'true');
    await expect(page.locator('[data-internal-action="restore"]')).toContainText(/Browsing|浏览中/);
    await page.locator('.nav-dot').nth(1).click();
    await expect(page.locator('#ap-slide-2')).toHaveClass(/active/);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#ap-slide-3')).toHaveClass(/active/);
    await page.locator('[data-internal-action="restore"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.clickdeck-panel')).not.toHaveClass(/--collapsed/);
    await expect(page.locator('[data-action="undo"]')).toBeEnabled();
    await expect(heading).toHaveCSS('font-size', font);
    await page.locator('[data-action="team-collaboration"]').click();
    await page.locator('[data-collab="current-page"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#ap-slide-3')).toHaveClass(/active/);
    await page.locator('.nav-dot').nth(0).click();
    await expect(page.locator('#ap-slide-1')).toHaveClass(/active/);
    await page.locator('[data-collab="close"]').click();
    await expect(page.locator('.clickdeck-panel')).not.toHaveClass(/--collapsed|--reviewing/);
    await page.locator('.nav-dot').nth(1).click();
    await expect(page.locator('#ap-slide-1')).toHaveClass(/active/);
  });

  test("10. Move intent target box label and dashed styles", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);

    const heading = page.getByRole("heading", { name: "Quarterly Product Review" });
    await heading.click();

    // 1. Initially it should create a marker with label "1"
    await page.locator("[data-action='add-intent']").click();
    
    // Draw an intent region
    const mouse = page.mouse;
    await mouse.move(50, 50);
    await mouse.down();
    await mouse.move(150, 150);
    await mouse.up();

    // Check initial marker text
    const marker = page.locator(".clickdeck-intent-region-marker").first();
    await expect(marker).toBeVisible();
    await expect(marker.locator(".clickdeck-intent-region-badge")).toHaveText("1");
    // Ensure border style is solid initially
    await expect(marker).toHaveCSS("border-style", "solid");

    // 2. Click Move to... to switch to move
    const intentDraft = page.locator(".clickdeck-intent-draft");
    const btnTarget = intentDraft.locator(".clickdeck-intent-draft__target-btn");
    await btnTarget.click();

    // The marker should update its label to "1A"
    await expect(marker.locator(".clickdeck-intent-region-badge")).toHaveText("1A");

    // The ghost button should not exist anymore (Task 62)
    const btnGhost = intentDraft.locator(".clickdeck-intent-draft__ghost-btn");
    await expect(btnGhost).toHaveCount(0);
    
    // We should be in ghost preview mode now
    await expect(page.locator(".clickdeck-ghost-preview")).toBeVisible();
    
    // Close the ghost preview
    const ghostPreview = page.locator(".clickdeck-ghost-preview");
    await ghostPreview.locator(".clickdeck-ghost-preview__close").click();
    await expect(ghostPreview).not.toBeVisible();
    
    // Verify that anchorElement inline position pollution was cleaned up
    const headingAnchor = page.getByRole("heading", { name: "Quarterly Product Review" });
    const positionStyle = await headingAnchor.evaluate((el: HTMLElement) => el.style.position);
    expect(positionStyle).toBe("");
  });

  test("11. Move intent target box dragging", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

    await activateExtension(page);

    const heading = page.getByRole("heading", { name: "Quarterly Product Review" });
    await heading.click();
    await page.locator("[data-action='add-intent']").click();
    
    // Draw Source A around the heading text rather than a generic page corner.
    const sourceTextBox = await heading.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const mouse = page.mouse;
    await mouse.move(sourceTextBox.x - 4, sourceTextBox.y - 4);
    await mouse.down();
    await mouse.move(sourceTextBox.x + sourceTextBox.width + 4, sourceTextBox.y + sourceTextBox.height + 4);
    await mouse.up();

    // Click Move to... triggers ghost preview immediately
    const intentDraft = page.locator(".clickdeck-intent-draft");
    const btnTarget = intentDraft.locator(".clickdeck-intent-draft__target-btn");
    await btnTarget.click();

    const ghostPreview = page.locator(".clickdeck-ghost-preview");
    await expect(ghostPreview).toBeVisible();

    const initialBox = await ghostPreview.boundingBox();
    expect(initialBox).toBeTruthy();
    const headingBox = await heading.boundingBox();
    expect(headingBox).toBeTruthy();

    // Drag the ghost preview
    await mouse.move(initialBox!.x + 10, initialBox!.y + 10);
    await mouse.down();
    // Move close enough to the heading left edge so the ghost preview should really snap to it.
    await mouse.move(headingBox!.x + 13, initialBox!.y + 80);

    const guideLine = page.locator(".clickdeck-ghost-guide-line").first();
    await expect(guideLine).toBeVisible();
    await expect(ghostPreview.locator(".clickdeck-ghost-preview__center-hint")).toContainText("X:");

    await mouse.up();

    const newBox = await ghostPreview.boundingBox();
    expect(newBox).toBeTruthy();
    expect(newBox!.y).toBeGreaterThan(initialBox!.y + 20);

    // Verify 1B marker is the ghost preview itself and has the correct badge
    await expect(ghostPreview).toBeVisible();
    await expect(ghostPreview.locator(".clickdeck-ghost-preview__label")).toHaveText("1B");
    await expect(page.locator(".clickdeck-intent-region-marker", { hasText: "1B" })).toHaveCount(0); // Ensure no duplicate 1B marker

    await expect(page.locator(".clickdeck-ghost-guide-line")).toHaveCount(0);

    // Simulate a later size edit before copying. Prompt generation must read the
    // current rendered source instead of replaying the geometry captured earlier.
    await heading.evaluate((element: HTMLElement) => {
      element.style.fontSize = "64px";
    });

    // Copy AI prompt
    await page.locator("[data-action='copy-ai-prompt']").click();
    const modal = page.locator(".clickdeck-prompt-modal");
    await expect(modal).toBeVisible();
    const promptText = await modal.locator("textarea").inputValue();
    
    expect(promptText).toContain("type: move");
    expect(promptText).toContain("Measurement state: Source A, Target B, anchors, and nearby references were refreshed from the rendered page");
    expect(promptText).toContain("Treat the complete TodoList as one desired final-state specification");
    expect(promptText).toContain("active snap guides; stable anchor-relative Target B; containment, non-overlap, and nearby spacing; viewport/document pixels only as fallback");
    expect(promptText).toContain("Dragged-frame calibration:");
    expect(promptText).toContain("Target B source: normalized from the dragged target frame using the current Source A size.");
    expect(promptText).toContain("Target B normalized content destination:");
    const currentContentBox = promptText.match(/Current Source A content box: \[x:-?\d+, y:-?\d+, w:(\d+), h:(\d+)\]/);
    const normalizedDestination = promptText.match(/Normalized content destination: \[x:-?\d+, y:-?\d+, w:(\d+), h:(\d+)\]/);
    expect(currentContentBox).toBeTruthy();
    expect(normalizedDestination).toBeTruthy();
    expect(normalizedDestination?.slice(1)).toEqual(currentContentBox?.slice(1));
    expect(promptText).toContain("Target B top edge is about");
    expect(promptText).toContain("below Source A top edge");
    expect(promptText).toContain("Source A summary:");
    expect(promptText).toContain("Source A implementation evidence:");
    expect(promptText).toContain("css-path:");
    expect(promptText).toContain("structural-path:");
    expect(promptText).toContain("Local HTML for Source A:");
    expect(promptText).toContain("Original HTML source location:");
    expect(promptText).toMatch(/demo-page\.html:\d+:\d+/);
    expect(promptText).toContain('<h1 style="font-size: 64px;">Quarterly Product Review</h1>');
    expect(promptText).not.toContain("next-sibling: div.clickdeck");
    expect(promptText).toContain("Group wrapper hint: no stronger shared wrapper signal was detected");
    expect(promptText).not.toContain("Source A contains multiple sibling items");
    expect(promptText).toContain("Target B summary:");
    expect(promptText).toContain("Final alignment guide:");
    expect(promptText).toContain("aligns with");
    const anchorLines = promptText.split("\n").filter((line) => line.startsWith("- Anchor:"));
    expect(anchorLines.length).toBeGreaterThanOrEqual(2);
    expect(anchorLines.join("\n")).not.toMatch(/ClickDeck|1A|1B|X: centerX/);
  });

  test("12. Remove intent marker", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);

    const heading = page.getByRole("heading", { name: "Quarterly Product Review" });
    await heading.click();
    await page.locator("[data-action='add-intent']").click();
    
    // Draw an intent region
    const mouse = page.mouse;
    await mouse.move(50, 50);
    await mouse.down();
    await mouse.move(150, 150);
    await mouse.up();

    // Switch to Remove
    const intentDraft = page.locator(".clickdeck-intent-draft");
    const btnRemove = intentDraft.locator(".clickdeck-intent-draft__remove-btn");
    await btnRemove.click();

    // Check marker is dashed and has "1 Del" or "Del"
    const marker = page.locator(".clickdeck-intent-region-marker").first();
    await expect(marker).toHaveCSS("border-style", "dashed");
    await expect(marker.locator(".clickdeck-intent-region-badge")).toContainText("Del");

    // Save with empty note
    await intentDraft.locator("[data-action='save']").click();
    
    // Panel should show [Mark removal] or similar saved state
    await expect(intentDraft.locator(".clickdeck-intent-draft__saved-action")).toBeVisible();
    
    // DOM element should still be visible
    await expect(heading).toBeVisible();

    // Check Prompt
    await page.locator("[data-action='copy-ai-prompt']").click();
    const modal = page.locator(".clickdeck-prompt-modal");
    await expect(modal).toBeVisible();
    const promptText = await modal.locator("textarea").inputValue();
    
    expect(promptText).toContain("type: remove");
    expect(promptText).toContain("Remove the selected region from the source HTML/CSS");
  });

  test("13. Text editing caret placement", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);

    // Find a long text element (using a locator that won't break when text changes)
    const heading = page.locator("h1").first();
    
    // Get its bounding box to click at ~30% width
    const box = await heading.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // The text is "Quarterly Product Review" (24 chars)
    // 30% width should land roughly around "Quarterly" or "Product"
    const clickX = box.x + box.width * 0.35;
    const clickY = box.y + box.height / 2;

    // Click to enter text editing at the specific position
    await page.mouse.click(clickX, clickY);

    // Verify it entered contenteditable
    await expect(heading).toHaveAttribute("contenteditable", "true");

    // Type some characters
    await page.keyboard.type("TEST-");

    // Get the new text
    const newText = await heading.textContent();
    
    // It should NOT be appended to the end (e.g., "Quarterly Product ReviewTEST-")
    // It should be inserted in the middle (e.g., "Quarterly TEST-Product Review")
    expect(newText?.endsWith("TEST-")).toBe(false);
    expect(newText).toContain("TEST-");
    expect(newText).not.toEqual("Quarterly Product ReviewTEST-");
  });

  test("14. Background clicks should not let the host page reset a just-applied style edit", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);

    const heading = page.getByRole("heading", { name: "Quarterly Product Review" });
    const initialFontSize = await heading.evaluate((element) => getComputedStyle(element).fontSize);

    await page.evaluate((originalSize) => {
      const bg = document.createElement("div");
      bg.id = "host-reset-background";
      Object.assign(bg.style, {
        position: "fixed",
        right: "16px",
        top: "16px",
        width: "120px",
        height: "120px",
        background: "rgba(255,0,0,0.01)",
        zIndex: "10"
      });
      bg.addEventListener("click", () => {
        const heading = document.querySelector("h1");
        if (heading instanceof HTMLElement) {
          heading.style.fontSize = originalSize;
          document.body.dataset.hostResetTriggered = "true";
        }
      });
      document.body.appendChild(bg);
    }, initialFontSize);

    await heading.click();
    await page.locator("[data-action='font-larger']").click();

    const updatedFontSize = await heading.evaluate((element) => getComputedStyle(element).fontSize);
    expect(parseFloat(updatedFontSize)).toBeGreaterThan(parseFloat(initialFontSize));

    await page.locator("#host-reset-background").click({ force: true });

    const finalFontSize = await heading.evaluate((element) => getComputedStyle(element).fontSize);
    expect(finalFontSize).toBe(updatedFontSize);
    await expect.poll(() => page.evaluate(() => document.body.dataset.hostResetTriggered ?? "false")).toBe("false");
  });

  test("15. Clicking a poster background block clears selection instead of escalating to a container", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);

    await page.evaluate(() => {
      const host = document.createElement("section");
      host.id = "selection-poster";
      Object.assign(host.style, {
        position: "relative",
        width: "720px",
        height: "520px",
        margin: "24px auto",
        background: "#141414",
        border: "1px solid rgba(255,255,255,0.08)"
      });

      const title = document.createElement("span");
      title.id = "selection-poster-title";
      title.textContent = "Poster Headline";
      Object.assign(title.style, {
        display: "inline-block",
        margin: "48px",
        fontSize: "48px",
        fontWeight: "700",
        color: "#f5f5f5"
      });

      const blank = document.createElement("div");
      blank.id = "selection-poster-blank";
      Object.assign(blank.style, {
        position: "absolute",
        left: "24px",
        right: "24px",
        bottom: "24px",
        height: "220px",
        background: "rgba(255,255,255,0.02)"
      });

      host.appendChild(title);
      host.appendChild(blank);
      document.body.appendChild(host);
    });

    const title = page.locator("#selection-poster-title");
    await title.click();

    const initialFontSize = await title.evaluate((element) => getComputedStyle(element).fontSize);
    await page.locator("[data-action='font-larger']").click();
    const updatedFontSize = await title.evaluate((element) => getComputedStyle(element).fontSize);
    expect(parseFloat(updatedFontSize)).toBeGreaterThan(parseFloat(initialFontSize));

    await page.locator("#selection-poster-blank").click({ force: true });

    await expect(page.locator(".clickdeck-panel__hint")).toHaveText("Click to edit. Collapse the editor to browse and use page navigation.");
    await expect(page.locator("#clickdeck-root .clickdeck-outline")).toBeHidden();

    const finalFontSize = await title.evaluate((element) => getComputedStyle(element).fontSize);
    expect(finalFontSize).toBe(updatedFontSize);
  });

  test("16. Intent drawer docks to the main panel with color tabs and follows collapse/move", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);

    const heading = page.getByRole("heading", { name: "Quarterly Product Review" });
    const mouse = page.mouse;

    for (const [start, end] of [
      [{ x: 40, y: 40 }, { x: 140, y: 120 }],
      [{ x: 180, y: 60 }, { x: 280, y: 140 }]
    ] as const) {
      await heading.click();
      await page.locator("[data-action='add-intent']").click();
      await mouse.move(start.x, start.y);
      await mouse.down();
      await mouse.move(end.x, end.y);
      await mouse.up();
    }

    const drawer = page.locator(".clickdeck-intent-draft");
    await expect(drawer).toBeVisible();
    await expect(page.locator(".clickdeck-intent-draft__tab")).toHaveCount(2);

    await page.locator(".clickdeck-intent-draft__collapse").click();
    await expect(drawer).not.toHaveClass(/clickdeck-intent-draft--expanded/);

    const panel = page.locator(".clickdeck-panel");
    const header = panel.locator(".clickdeck-panel__header");
    const drawerBefore = await drawer.boundingBox();
    const headerBox = await header.boundingBox();
    expect(drawerBefore).not.toBeNull();
    expect(headerBox).not.toBeNull();
    if (!drawerBefore || !headerBox) return;

    await mouse.move(headerBox.x + 20, headerBox.y + 10);
    await mouse.down();
    await mouse.move(headerBox.x - 80, headerBox.y + 40);
    await mouse.up();

    const drawerAfterMove = await drawer.boundingBox();
    expect(drawerAfterMove).not.toBeNull();
    expect(drawerAfterMove!.x).toBeLessThan(drawerBefore.x - 40);

    await panel.locator("[data-internal-action='collapse']").click();
    await expect(drawer).toBeHidden();
  });

  test("17. Selected-area interaction review copies its dedicated prompt and collapses the panel", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);

    const askGeminiGroup = page.locator(".clickdeck-panel__group--ask-gemini");
    const interactionRow = askGeminiGroup.locator("[data-ask-gemini-column='interaction']");
    await expect(askGeminiGroup.locator(":scope > *")).toHaveCount(3);
    await expect(interactionRow.locator("[data-action='ask-gemini-interaction']")).toBeVisible();
    await expect(interactionRow.locator("[data-action='ask-gemini-interaction-selection']")).toBeVisible();
    const askRows = await askGeminiGroup.locator(":scope > *").evaluateAll((rows) => rows.map((row) => {
      const rect = row.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width };
    }));
    expect(askRows[0].y).toBeLessThan(askRows[1].y);
    expect(askRows[1].y).toBeLessThan(askRows[2].y);
    expect(Math.abs(askRows[0].width - askRows[1].width)).toBeLessThan(1);
    expect(Math.abs(askRows[1].width - askRows[2].width)).toBeLessThan(1);

    await page.locator("[data-action='ask-gemini-interaction-selection']").click();

    await expect(page.locator(".clickdeck-panel")).toHaveClass(/clickdeck-panel--collapsed/);
    const copiedPrompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiedPrompt).toContain("Select from screen");
    expect(copiedPrompt).toContain("Analyze only this selected region");
    expect(copiedPrompt).toContain("Option 0");
  });

  test("18. Interaction dictionary filters 20 patterns and keeps demos usable on narrow screens", async ({ page, demoPageUrl }) => {
    // This case tests looping animation. Do not inherit an OS preference that
    // deliberately disables playback; reduced-motion behavior is tested separately.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(demoPageUrl);
    await activateExtension(page);

    const dictionaryButton = page.locator("[data-internal-action='interaction-library']");
    await expect(dictionaryButton).toHaveText("Interaction dictionary");
    await expect(dictionaryButton).not.toContainText("20");
    await dictionaryButton.click();

    const library = page.locator(".clickdeck-interaction-library");
    const dialog = library.locator(".clickdeck-interaction-library__dialog");
    await expect(library).toBeVisible();
    await expect(dialog.locator(".clickdeck-interaction-library__title")).toHaveText("Interaction dictionary");
    await expect(library.locator("[data-library-relation='all']")).toHaveText("All");
    await expect(library.locator(".clickdeck-interaction-library__count")).toHaveText("Fixed index");
    await expect(library.locator("[data-library-pattern]")).toHaveCount(20);
    await expect(library.locator(".clickdeck-interaction-library__item-index").first()).toHaveText("01");
    await expect(library.locator(".clickdeck-interaction-library__item-index").last()).toHaveText("20");

    await library.locator("[data-library-relation='comparison-change']").click();
    await expect(library.locator("[data-library-pattern]")).toHaveCount(20);
    await expect(library.locator("[data-library-pattern][data-filter-match='true']")).toHaveCount(3);
    const compareItem = library.locator("[data-library-pattern='compare-slider']");
    const compareItemBeforeHover = await compareItem.boundingBox();
    await compareItem.hover();
    const compareItemAfterHover = await compareItem.boundingBox();
    expect(compareItemBeforeHover).not.toBeNull();
    expect(compareItemAfterHover).not.toBeNull();
    expect(compareItemAfterHover?.width).toBe(compareItemBeforeHover?.width);
    expect(compareItemAfterHover?.height).toBe(compareItemBeforeHover?.height);
    await expect(compareItem).toHaveCSS("transform", "none");
    await expect(compareItem).toHaveCSS("box-shadow", "none");
    await expect(compareItem).toHaveAttribute("aria-current", "false");
    await expect(library.locator("[data-demo-renderer='view-switcher']")).toBeVisible();

    await compareItem.click();
    await expect(compareItem).toHaveAttribute("aria-current", "true");
    const slider = library.locator("[data-demo-action='compare-slider']");
    await expect(slider).toBeVisible();
    expect(await library.locator("[data-demo-compare]").evaluate((element: HTMLElement) => element.style.width)).toBe("50%");
    await page.evaluate(() => {
      const state = window as unknown as { cdDemoEvents: unknown[] };
      state.cdDemoEvents = [];
      for (const type of ["mouseover", "mouseout", "click", "input"]) {
        document.addEventListener(type, event => {
          const target = event.target as HTMLElement;
          if (!target.closest?.("[data-library-demo-stage]")) return;
          const related = (event as MouseEvent).relatedTarget as HTMLElement | null;
          if (state.cdDemoEvents.length < 32) state.cdDemoEvents.push({ type, trusted: event.isTrusted, target: target.tagName,
            related: related?.tagName, relatedInside: Boolean(related?.closest?.("[data-library-demo-stage]")) });
        }, true);
      }
    });
    await library.locator("[data-library-demo-stage]").hover();
    try {
      await expect(library.locator("[data-library-demo-stage]")).toHaveAttribute("data-preview-playing", "true");
      await expect.poll(
        () => library.locator("[data-demo-renderer='compare-slider']").getAttribute("data-preview-cycle")
      ).toBe("1");
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        playing: document.querySelector("[data-library-demo-stage]")?.getAttribute("data-preview-playing"),
        cycle: document.querySelector("[data-demo-renderer='compare-slider']")?.getAttribute("data-preview-cycle"),
        events: (window as unknown as { cdDemoEvents: unknown[] }).cdDemoEvents
      }));
      await test.info().attach("demo-playback-state", { body: JSON.stringify(diagnostic), contentType: "application/json" });
      throw error;
    }
    await library.locator("[data-library-demo-stage]").click({ position: { x: 8, y: 8 } });
    await expect.poll(
      () => library.locator("[data-demo-compare]").evaluate((element: HTMLElement) => element.style.width)
    ).toBe("50%");
    await expect(library.locator(".clickdeck-interaction-library__demo-wrap")).toHaveCSS("background-color", "rgb(23, 35, 31)");

    const copyPatternButton = library.locator("[data-library-action='copy-pattern']");
    const detailTitle = library.locator(".clickdeck-interaction-library__detail-title");
    const copyBox = await copyPatternButton.boundingBox();
    const titleBox = await detailTitle.boundingBox();
    expect(copyBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(copyBox!.x).toBeGreaterThan(titleBox!.x);
    await copyPatternButton.click();
    await expect(copyPatternButton).toHaveText("Copied");
    const copiedPattern = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiedPattern).toContain("Change this region to Before–After Compare Slider");
    expect(copiedPattern).toContain("invent no new content");

    await page.setViewportSize({ width: 390, height: 780 });
    const dialogBox = await dialog.boundingBox();
    const listBox = await library.locator(".clickdeck-interaction-library__list-pane").boundingBox();
    const detailBox = await library.locator(".clickdeck-interaction-library__detail").boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(listBox).not.toBeNull();
    expect(detailBox).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(390);
    expect(detailBox!.y).toBeGreaterThan(listBox!.y);

    await library.locator("[data-library-action='close']").click();
    await expect(library).toHaveCount(0);
  });

  test("19. Interaction pattern writes an editable description into the active suggestion", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);

    await page.getByRole("heading", { name: "Quarterly Product Review" }).click();
    await page.locator("[data-action='add-intent']").click();
    await page.mouse.move(40, 40);
    await page.mouse.down();
    await page.mouse.move(180, 130);
    await page.mouse.up();

    const draft = page.locator(".clickdeck-intent-draft");
    await expect(draft).toBeVisible();
    await draft.locator(".clickdeck-intent-draft__interaction-btn").click();

    const library = page.locator(".clickdeck-interaction-library");
    await expect(library).toBeVisible();
    await expect(library).toContainText("Click a pattern on the left");
    await expect(library).toContainText("The inserted description remains editable");
    await library.locator("[data-library-pattern='filter-chips']").click();
    await library.locator("[data-library-action='select']").click();

    await expect(library).toHaveCount(0);
    const textarea = draft.locator(".clickdeck-intent-draft__textarea");
    await expect(textarea).toHaveValue(/Filter Chips/);
    await expect(textarea).toHaveValue(/invent no new content/);

    await draft.locator("button[data-action='save']").click();
    await expect(draft.locator(".clickdeck-intent-draft__saved-text")).toContainText("Filter Chips");
  });

  test("20. Private collaboration entry is secondary, explicit, and offline when unconfigured", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);

    const aiActions = page.locator("[data-section='ai-prompt'] [data-action]");
    await expect(aiActions).toHaveCount(2);
    await expect(aiActions.nth(0)).toHaveAttribute("data-action", "copy-ai-prompt");
    await expect(aiActions.nth(1)).toHaveAttribute("data-action", "team-collaboration");

    await aiActions.nth(1).click();
    const modal = page.locator(".clickdeck-collab-modal");
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("not configured for private collaboration");
    await expect(modal).toContainText("48 hours");
    await expect(modal.locator("[data-collab='manage']")).toBeDisabled();
    await expect(modal.locator("form")).toHaveCount(0);
    await expect(modal.locator("input")).toHaveCount(0);
  });

  test("automatically recovers source checking and reuses it only within the loaded page", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    const worker = page.context().serviceWorkers()[0] || await page.context().waitForEvent('serviceworker');
    await worker.evaluate(url => {
      const probe = { calls: 0, fail: true };
      (globalThis as typeof globalThis & { clickdeckSourceProbe: typeof probe }).clickdeckSourceProbe = probe;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        if (String(input) === url) {
          probe.calls++;
          if (probe.fail) throw new TypeError('Simulated source fetch failure');
        }
        return originalFetch(input, init);
      };
    }, demoPageUrl);
    const readCount = () => worker.evaluate(() => (globalThis as typeof globalThis & { clickdeckSourceProbe: { calls: number } }).clickdeckSourceProbe.calls);
    await activateExtension(page);
    await page.locator('[data-action="team-collaboration"]').click();
    await expect(page.locator('.clickdeck-collab-modal')).toContainText('could not fetch the source');
    expect(await readCount()).toBe(1);
    await worker.evaluate(() => { (globalThis as typeof globalThis & { clickdeckSourceProbe: { fail: boolean } }).clickdeckSourceProbe.fail = false; });
    await page.locator('[data-collab="refresh"]').click();
    await expect(page.locator('.clickdeck-collab-modal__busy')).toHaveCount(0);
    await expect(page.locator('[data-collab="verify-source"]')).toHaveCount(0);
    await expect(page.locator('.clickdeck-collab-modal')).not.toContainText('could not fetch the source');
    expect(await readCount()).toBe(2);
    await page.locator('[data-collab="close"]').click();
    await page.locator('[data-action="team-collaboration"]').click();
    await expect(page.locator('.clickdeck-collab-modal__busy')).toHaveCount(0);
    expect(await readCount()).toBe(2);
    await page.keyboard.press('Alt+Shift+C');
    await expect(page.locator('#clickdeck-root')).toBeHidden();
    await activateExtension(page);
    await page.locator('[data-action="team-collaboration"]').click();
    await expect(page.locator('.clickdeck-collab-modal__busy')).toHaveCount(0);
    expect(await readCount()).toBe(2);
    await page.reload();
    await activateExtension(page);
    await page.locator('[data-action="team-collaboration"]').click();
    await expect(page.locator('.clickdeck-collab-modal__busy')).toHaveCount(0);
    await expect.poll(readCount).toBe(3);
  });

  test("28. Page scripts cannot approve collaboration; trusted windows expire with their source", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);
    await page.locator("[data-action='team-collaboration']").click();
    // Initial verification finishes asynchronously and re-renders the panel.
    // Wait for its final state BEFORE the deliberate test-only enable below;
    // otherwise that re-render restores disabled and the real click races it.
    await expect(page.locator("[data-collab-source]")).toContainText("Original version verified");
    await expect(page.getByText("This build is not configured for private collaboration.", { exact: true })).toBeVisible();
    const manage = page.locator("[data-collab='manage']");
    // Deliberately bypass only the unconfigured UI disable to exercise the actual
    // browser isolation and click guards. No remote service is configured.
    await manage.evaluate(el => { (el as HTMLButtonElement).disabled = false; (el as HTMLButtonElement).click(); });
    await page.waitForTimeout(250);
    expect(page.context().pages().filter(p => p.url().includes("collaboration.html"))).toHaveLength(0);
    const popupPromise = page.context().waitForEvent("page");
    await manage.click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    await expect(popup.locator("form")).toBeVisible();
    await expect(popup.locator("input[name='consent']")).not.toBeChecked();
    await popup.locator("[name='title']").fill("test draft");
    await popup.locator("[name='name']").fill("A");
    await popup.locator("input[name='consent']").check();
    await expect(popup.locator("button[value='create']")).toBeDisabled();
    // Creation now requires login. Exercise the same trusted-window boundary
    // through the enabled login action, without bypassing the creation gate.
    const login = popup.getByRole('button', { name: '使用 Google 登录以继续', exact: true });
    await expect(popup.locator("button[value='create']")).toBeHidden();
    await login.click();
    await expect(popup.locator("#status")).not.toBeEmpty();
    await expect(popup.locator("[name='title']")).toHaveValue("test draft");
    await expect(popup.locator("[name='name']")).toHaveValue("A");
    const secureUrl = popup.url();
    // The host cannot embed/read the privileged UI (not web-accessible).
    expect(await page.evaluate(async url => { try { await fetch(url); return true; } catch { return false; } }, secureUrl)).toBe(false);
    await page.reload();
    await login.click();
    await expect(popup.locator("#status")).toContainText("窗口已失效");
    await popup.close();
  });

  test("21. Visible image intent remains visible when Move target is dragged", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl);
    await activateExtension(page);

    const imageBox = await page.locator("#test-image").boundingBox();
    expect(imageBox).toBeTruthy();

    await page.locator("[data-action='add-intent']").click();
    await page.mouse.move(imageBox!.x + 4, imageBox!.y + 4);
    await page.mouse.down();
    await page.mouse.move(imageBox!.x + imageBox!.width - 4, imageBox!.y + imageBox!.height - 4);
    await page.mouse.up();

    const source = page.locator(".clickdeck-intent-region-marker").first();
    await expect(source).toBeVisible();
    await page.locator(".clickdeck-intent-draft__target-btn").click();
    await expect(source).toBeVisible();
    await expect(source.locator(".clickdeck-intent-region-badge")).toHaveText("1A");

    const target = page.locator(".clickdeck-ghost-preview");
    await expect(target).toBeVisible();
    const before = await target.boundingBox();
    expect(before).toBeTruthy();
    await page.mouse.move(before!.x + 12, before!.y + 12);
    await page.mouse.down();
    await page.mouse.move(before!.x + 92, before!.y + 72);
    await page.mouse.up();
    const after = await target.boundingBox();
    expect(after).toBeTruthy();
    expect(after!.x).toBeGreaterThan(before!.x + 30);
    await expect(source).toBeVisible();
  });

  test("22. Hidden generic container cannot swallow an intent marker", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl.replace("/demo-page.html", "/intent-hidden-container.html"));
    await activateExtension(page);

    await page.locator("[data-action='add-intent']").click();
    await page.mouse.move(90, 100);
    await page.mouse.down();
    await page.mouse.move(360, 245);
    await page.mouse.up();

    const marker = page.locator(".clickdeck-intent-region-marker").first();
    await expect(marker).toBeVisible();
    expect(await marker.evaluate(element => element.parentElement?.classList.contains("ghost-container"))).toBe(false);
  });

  test("23. Intent marker follows a nonstandard transform page", async ({ page, demoPageUrl }) => {
    await page.goto(demoPageUrl.replace("/demo-page.html", "/intent-transform-pages.html"));
    await activateExtension(page);

    await page.locator("[data-action='add-intent']").click();
    await page.mouse.move(85, 85);
    await page.mouse.down();
    await page.mouse.move(330, 210);
    await page.mouse.up();

    const marker = page.locator(".clickdeck-intent-region-marker").first();
    await expect(marker).toBeVisible();
    expect(await marker.evaluate(element => element.parentElement?.id || element.parentElement?.className || "body")).toBe("page-one-target");
    const panel = page.locator(".clickdeck-panel");
    await panel.locator("[data-internal-action='collapse']").click();
    await page.locator("#next").click();
    await page.waitForTimeout(180);
    await expect(page.getByRole("heading", { name: "Page 2" })).toBeVisible();
    const movedMarkerBox = await marker.boundingBox();
    expect(movedMarkerBox).toBeTruthy();
    expect(movedMarkerBox!.x + movedMarkerBox!.width).toBeLessThanOrEqual(0);

    await page.locator("#previous").click();
    await page.waitForTimeout(180);
    const restoredMarkerBox = await marker.boundingBox();
    expect(restoredMarkerBox).toBeTruthy();
    expect(restoredMarkerBox!.x).toBeGreaterThanOrEqual(0);
  });

});
