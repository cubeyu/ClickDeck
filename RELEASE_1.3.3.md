# ClickDeck v1.3.3 Release Notes

ClickDeck v1.3.3 is a release-packaging and public-material cleanup update. It keeps the MVP feature boundary unchanged, prepares a fresh installable package, restores sponsorship entry points in the README, and reduces the amount of local-only demo material exposed in the public GitHub repository.

## Highlights

- Updated the shipped extension version to `1.3.3`.
- Updated the in-panel version label to `v1.3.3`.
- Refreshed the README install references for `ClickDeck-v1.3.3.zip`.
- Restored sponsorship entry points for `WeChat Pay`, `Alipay`, and Ko-fi.
- Reduced public Git tracking for local-only materials such as the internal roadmap, local demo markdown, and extra demo screenshots.
- Rebuilt the extension package as a fresh `v1.3.3` ZIP artifact with the existing self-describing install structure.

## What this release is for

- A cleaner `1.3.3` package for manual installation and GitHub release upload
- A smaller, easier-to-read public GitHub repository surface
- A README that keeps the product description, install steps, and sponsorship entry points aligned with the current release

## Installation / Update

1. Download the attached release asset `ClickDeck-v1.3.3.zip` from the GitHub Releases page.
2. Do **not** use GitHub's auto-generated **Source code (zip)** archive for installation.
3. Extract the ZIP file locally.
4. Open the extracted `ClickDeck-v1.3.3/` folder and confirm that it contains `manifest.json`.
5. Open `chrome://extensions/` or `edge://extensions/`.
6. Enable **Developer mode**.
7. Click **Load unpacked** and choose the extracted `ClickDeck-v1.3.3/` folder.
8. If you edit local `file://` HTML files, open ClickDeck's **Details** page and enable **Allow access to file URLs**.

## Product Boundary Reminder

ClickDeck v1.3.3 still stays inside the same MVP boundary:

- It visually fine-tunes the current HTML page in the browser.
- It exports edited pages as HTML snapshots, long images, or image-based PDFs.
- It supports visual edit suggestions and review-prompt handoff for external AI workflows.
- It does **not** write changes back to the source repository automatically.
- It does **not** become a free-form design canvas, editable PPT exporter, or editable PDF exporter.

## GitHub Release / Public Repo Notes

Recommended release attachment:

- `ClickDeck-v1.3.3.zip`

Do **not** treat these as installation assets:

- GitHub auto-generated `Source code (zip)` / `Source code (tar.gz)`
- local-only roadmap docs
- local demo markdown files
- `fixtures/` and `feedback/`
- old demo screenshots that are not needed by the current README

The uploaded release asset should extract to:

```text
ClickDeck-v1.3.3/
  manifest.json
  background.js
  content.js
  icons/
  brand/
  _locales/
  INSTALL.txt
```

## Sponsorship Note

This release restores the README donation section for:

- `WeChat Pay`
- `Alipay`
- `Ko-fi`: https://ko-fi.com/ningsiii

## 中文说明

ClickDeck v1.3.3 是一次发布整理版本，重点不是新增能力，而是统一当前安装包、README、赞赏入口和 GitHub 公开仓库内容。

### 主要变化

- 扩展版本号升级到 `1.3.3`
- 面板中的版本显示同步更新到 `v1.3.3`
- README 安装说明改为 `ClickDeck-v1.3.3.zip`
- 恢复 `微信赞赏`、`支付宝` 和 Ko-fi 的 README 入口
- 将内部执行路线、本地 demo 文档和额外 demo 图片从 Git 跟踪中移除，但保留本地文件
- 重新生成 `v1.3.3` 发布包，继续保持“解压后可直接加载”的结构

### 安装提醒

- 请下载 GitHub Release 附件里的 `ClickDeck-v1.3.3.zip`
- 不要把 GitHub 自动生成的 **Source code (zip)** 当成扩展安装包
- 解压后应选择 `ClickDeck-v1.3.3/` 这个包含 `manifest.json` 的文件夹
- 本地 `file://` HTML 页面仍需在扩展详情里开启 **允许访问文件网址**

### 仓库公开内容说明

本次版本会尽量只保留最少、最必要的公开材料：

- 保留源码、README、隐私政策、当前 release note 和赞赏图片
- 不继续公开跟踪本地 demo 文档、执行路线图和不再需要的 demo 截图

### 赞赏入口说明

README 中恢复：

- 微信赞赏码
- 支付宝收款码
- Ko-fi 赞助入口：https://ko-fi.com/ningsiii
