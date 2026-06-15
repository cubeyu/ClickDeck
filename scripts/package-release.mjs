import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const packageJsonPath = join(repoRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const version = packageJson.version;
const distDir = join(repoRoot, "dist");
const releaseRoot = join(repoRoot, "release");
const folderName = `ClickDeck-v${version}`;
const stageDir = join(releaseRoot, folderName);
const zipPath = join(repoRoot, `${folderName}.zip`);
const manifestPath = join(distDir, "manifest.json");

if (!existsSync(manifestPath)) {
  console.error("dist/manifest.json not found. Run `npm run build` before packaging the release zip.");
  process.exit(1);
}

rmSync(stageDir, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(stageDir, { recursive: true });
cpSync(distDir, stageDir, { recursive: true });
writeFileSync(join(stageDir, "INSTALL.txt"), buildInstallText(folderName), "utf8");

const pythonSnippet = [
  "import os, sys, zipfile",
  "base_dir, folder_name, zip_path = sys.argv[1:4]",
  "root = os.path.join(base_dir, folder_name)",
  "with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:",
  "    for dirpath, _, filenames in os.walk(root):",
  "        for filename in filenames:",
  "            full_path = os.path.join(dirpath, filename)",
  "            archive_name = os.path.relpath(full_path, base_dir)",
  "            zf.write(full_path, archive_name)",
].join("\n");

const pythonCommands = ["python3", "python"];
let zipResult = null;

for (const command of pythonCommands) {
  const result = spawnSync(command, ["-c", pythonSnippet, releaseRoot, folderName, zipPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status === 0) {
    zipResult = result;
    break;
  }
}

if (!zipResult) {
  console.error("Failed to create release zip. Python 3 is required for scripts/package-release.mjs.");
  process.exit(1);
}

console.log(`Created ${zipPath}`);
console.log(`Top-level folder inside zip: ${folderName}/`);

function buildInstallText(folder) {
  return [
    "ClickDeck manual install package",
    "================================",
    "",
    `This ZIP extracts to a folder named ${folder}/.`,
    "Load that extracted folder in Chrome or Edge. It must contain manifest.json at its root.",
    "",
    "Do NOT install from GitHub's auto-generated Source code (zip) archive.",
    "That archive is the Vite source project, not the unpacked extension package.",
    "",
    "Install steps:",
    "1. Extract this ZIP.",
    `2. Open chrome://extensions/ or edge://extensions/.`,
    "3. Enable Developer mode.",
    `4. Click Load unpacked and select the extracted ${folder}/ folder.`,
    "",
    "For local file:// HTML pages:",
    "1. Open ClickDeck -> Details in the extensions page.",
    '2. Enable "Allow access to file URLs" / "允许访问文件网址".',
    "3. Reload the local HTML file and click the ClickDeck toolbar icon again.",
    "",
  ].join("\n");
}
