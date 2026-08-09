# ClickDeck v1.3.6

ClickDeck v1.3.6 makes AI edit handoff more precise, especially when a visual request combines text or style changes with moving content. The copied prompt now gives coding AI stronger DOM and source-location evidence while treating the user's edits as one final-state specification.

This release does not write back to source code, execute AI-generated changes, or automatically move page elements.

## Highlights

- Added stronger machine-readable location evidence for edited elements:
  - CSS and structural paths
  - concise parent and sibling context
  - selector-stability guidance
  - an original HTML line and column only when a unique, high-confidence match is available
- Improved move-intent handoff:
  - identifies the Source A implementation element and preserves its local HTML structure
  - avoids mistaking multiple text lines from one element for a multi-element wrapper
  - describes all edit tasks as one desired final state instead of a required operation history
- Calibrated movement after layout-changing edits:
  - refreshes the current rendered geometry when the prompt is copied
  - normalizes the destination to the current Source A size
  - separates the dragged frame, its offset, inset, and alignment guides from the actual content destination
- Prevented Source A and its descendants from being reported as Target B content or placement references
- Kept the existing interaction assistance, visual editing, export, complex-element safety, and simple SVG text editing workflows intact

## Current scope

ClickDeck v1.3.6 can:

- visually fine-tune the current HTML page in Chrome or Edge
- edit text and safe visual properties in place
- replace images and resize supported media
- mark visual edit suggestions and two-region move intent
- prepare structured edit prompts with DOM, spatial, and optional source-line evidence for external coding AI
- prepare page and selected-region interaction-review prompts for external AI
- browse and copy lightweight interaction-pattern references
- export edited pages as HTML snapshots, long images, and image-based PDFs

ClickDeck v1.3.6 does not:

- run a built-in AI model
- generate, execute, or apply source-code changes automatically
- guarantee source line numbers for dynamic, transformed, repeated, or unreadable HTML
- turn viewport coordinates into hard-coded layout instructions
- become a free-form design canvas
- export editable PPT or editable PDF

## Installation / Update

1. Download the attached release asset `ClickDeck-v1.3.6.zip`
2. Do **not** use GitHub's auto-generated **Source code (zip)** archive for installation
3. Extract the ZIP file locally
4. Open the extracted `ClickDeck-v1.3.6/` folder and confirm that it contains `manifest.json`
5. Open `chrome://extensions/` or `edge://extensions/`
6. Enable **Developer mode**
7. Click **Load unpacked** and select the extracted `ClickDeck-v1.3.6/` folder
8. If you edit local `file://` HTML files, open ClickDeck's **Details** page and enable **Allow access to file URLs**

## Privacy policy

https://ningsiii.github.io/ClickDeck/privacy-policy.html

## 中文说明

ClickDeck v1.3.6 重点提升了 AI 修改交接的定位精度，尤其适合同时包含文字或样式调整与内容移动的复杂修改。复制给 coding AI 的 Prompt 现在会提供更完整的 DOM、源码与空间证据，并把全部修改表达为一个期望的最终状态。

本版本不会回写源码，不会执行 AI 生成的修改，也不会自动移动页面元素。

### 主要变化

- 为明确修改补充更稳定的机器定位证据：
  - CSS path 与结构路径
  - 简洁的父级、前后相邻元素信息
  - selector 稳定性提示
  - 只有原始 HTML 能唯一高置信度匹配时才提供行号与列号
- 提升移动意图的源码交接精度：
  - 识别 Source A 的实际实现元素，并保留局部 HTML 结构
  - 不再把同一元素的多行文字误判为需要移动共享 wrapper
  - 明确全部任务共同描述最终状态，不要求 coding AI 照搬用户操作历史
- 校准会受排版变化影响的移动位置：
  - 复制 Prompt 时重新读取当前渲染几何
  - 按 Source A 当前尺寸生成同尺寸目标落点
  - 分开描述拖拽框、位移、框内 inset、吸附线与真实内容落点
- Target B 的内容与位置参考不再混入 Source A 自身及其后代元素
- 原有交互辅助、可视化编辑、导出、复杂元素安全处理与简单 SVG 文字编辑能力保持不变

### 安装提醒

- 请下载 GitHub Release 附件中的 `ClickDeck-v1.3.6.zip`
- 不要把 GitHub 自动生成的 **Source code (zip)** 当成扩展安装包
- 解压后应选择 `ClickDeck-v1.3.6/` 这个包含 `manifest.json` 的文件夹
- 本地 `file://` HTML 页面仍需在扩展详情中开启 **允许访问文件网址**

### 隐私政策

https://ningsiii.github.io/ClickDeck/privacy-policy.html
