# ClickDeck v1.3.1 Release Notes

ClickDeck v1.3.1 is a release-packaging and product-copy update. It does not add a new product surface. Instead, it makes the shipped version, install materials, and release assets line up with the current ClickDeck MVP.

## Highlights

- Updated the shipped extension version to `1.3.1`.
- Updated the in-panel version label to match the release package.
- Refreshed the README install/download references for the `v1.3.1` package.
- Prepared a cleaner English description for Chrome Web Store submission and release use.
- Rebuilt the extension package as a fresh `v1.3.1` ZIP artifact.

## What this release is for

- A consistent release package for testers and manual installs.
- A cleaner public-facing project description for GitHub Releases and Chrome Web Store materials.
- A stable packaging checkpoint after the recent panel, export, and prompt-handoff improvements already merged into the MVP.

## Installation / Update

1. Download `ClickDeck-v1.3.1.zip` from the GitHub Releases page.
2. Extract the ZIP file to a local folder.
3. Open `chrome://extensions/` or `edge://extensions/`.
4. Enable **Developer mode**.
5. Click **Load unpacked** and choose the extracted folder.
6. If you already installed an older unpacked version, reload it after replacing the files.

## Product Boundary Reminder

ClickDeck v1.3.1 still stays inside the same MVP boundary:

- It visually fine-tunes the current HTML page in the browser.
- It exports edited pages as HTML snapshots, long images, or image-based PDFs.
- It can prepare structured edit prompts from your visual changes for external coding AI handoff.

It still does **not**:

- write changes back to the source repository automatically
- act like a free-form canvas or Figma replacement
- generate content or redesign pages automatically
- export editable PPT or editable PDF files

## Chrome Web Store Description (EN)

Use the following text for the Chrome Web Store listing:

> Visually fine-tune the current HTML page and export it.
>
> ClickDeck is a lightweight Chrome/Edge extension for editing browser-rendered HTML pages without opening DevTools. It works well for AI-generated pages, HTML presentations, reports, proposals, and other pages you want to polish directly in the browser.
>
> Core features:
> - Edit text in place and adjust font size, weight, spacing, alignment, and color
> - Replace images and make quick visual polish changes without touching source code
> - Use undo/redo with a draggable, collapsible control panel
> - Export the edited page as an HTML snapshot, long image, or image-based PDF
> - Generate a structured edit prompt from your visual changes for coding AI handoff
>
> ClickDeck is built for visual fine-tuning of the current page. It is not a free-form design canvas and does not write changes back to your source files automatically.

## 中文说明

ClickDeck v1.3.1 是一次发布收口版本，重点不是新增功能，而是把当前 MVP 的版本号、安装说明、发布说明和打包产物整理一致。

### 主要变化

- 扩展版本号升级到 `1.3.1`
- 面板中的版本显示同步更新
- README 的下载链接和 release 指向更新为 `v1.3.1`
- 补充了更适合 Chrome Web Store / release 使用的英文描述
- 重新生成了 `v1.3.1` 发布包

### 这次发布主要用于

- 给测试者和手动安装用户提供一致的 release 包
- 让 GitHub Releases 与 Chrome Web Store 对外说明更贴近当前能力边界
- 为后续继续推进 MVP 打下一个干净的发布基线

### 能力边界提醒

ClickDeck 仍然是一个浏览器内的 HTML 页面可视化微调工具：

- 可以编辑当前页面元素
- 可以导出 HTML 快照、长图和图片型 PDF
- 可以把可视化修改整理成结构化 prompt，交给外部 coding AI 继续处理源码

它仍然不是：

- 自动回写源码的工具
- 自由画布/类 Figma 工具
- 自动生成内容或自动重设计页面的 AI 工具
- 可导出可编辑 PPT / 可编辑 PDF 的工具
