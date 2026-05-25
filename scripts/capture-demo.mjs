import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { chromium } from "@playwright/test";

const projectRoot = process.cwd();
const extensionPath = path.join(projectRoot, "dist");
const assetDir = path.join(projectRoot, "docs", "assets");
const tempDir = path.join(projectRoot, "tmp", "capture-demo");
const screenshotPath = path.join(assetDir, "clickdeck-showcase.png");
const videoPath = path.join(tempDir, "clickdeck-demo.webm");
const gifPath = path.join(assetDir, "clickdeck-demo.gif");

await mkdir(assetDir, { recursive: true });
await mkdir(tempDir, { recursive: true });

const server = await serveStatic(projectRoot);
const port = server.address().port;

const context = await chromium.launchPersistentContext(path.join(tempDir, "profile"), {
  channel: "msedge",
  headless: false,
  locale: "en-US",
  viewport: { width: 1280, height: 820 },
  recordVideo: {
    dir: tempDir,
    size: { width: 1280, height: 820 }
  },
  args: [
    "--lang=en-US",
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`
  ]
});

try {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/fixtures/showcase-page.html`);
  await page.waitForLoadState("networkidle");
  await pause(700);

  await page.keyboard.press("Alt+Shift+C");
  await page.locator("#clickdeck-root").waitFor({ state: "visible" });
  await pause(700);

  const heading = page.getByRole("heading", { name: "Make the final page feel finished." });
  await heading.click();
  await pause(500);
  await page.locator("[data-action='font-larger']").click();
  await pause(450);
  await page.locator("[data-action='font-larger']").click();
  await pause(450);

  await page.locator(".clickdeck-color-picker").fill("#d9552a");
  await pause(650);

  await page.screenshot({ path: screenshotPath, fullPage: false });

  await page.locator("[data-action='undo']").click();
  await pause(500);
  await page.locator("[data-action='redo']").click();
  await pause(800);

  const video = page.video();
  await page.close();
  await video.saveAs(videoPath);
  await convertVideoToGif(videoPath, gifPath);
  await unlink(videoPath).catch(() => {});
} finally {
  await context.close();
  await new Promise((resolve) => server.close(resolve));
}

console.log(`Screenshot: ${screenshotPath}`);
console.log(`GIF: ${gifPath}`);

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function serveStatic(root) {
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "") || "fixtures/showcase-page.html";
    const filePath = path.resolve(root, relativePath);

    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    try {
      await stat(filePath);
    } catch {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const stream = createReadStream(filePath);
    response.writeHead(200, { "content-type": contentType(filePath) });
    stream.pipe(response);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function convertVideoToGif(inputPath, outputPath) {
  await new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-vf",
      "fps=12,scale=960:-1:flags=lanczos",
      outputPath
    ], { stdio: "inherit" });

    ffmpeg.on("error", reject);
    ffmpeg.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}
