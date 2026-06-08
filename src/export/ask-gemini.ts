export type AskGeminiPromptKey = "flow" | "focus" | "interaction";
export type AskGeminiPromptLanguage = "en" | "zh";

const COMMON_REQUIREMENTS_ZH = `请先根据当前网页判断它更像哪种类型：方案/PPT、产品界面、营销页、工具页、文章页或其他。后续建议必须贴合这个页面类型，不要套用固定模板。

执行难度判断标准：
低：主要是调整顺序、字号、间距、强调层级、删减或移动现有模块。
中：需要重构一个页面区域，或加入少量 HTML/CSS/原生 JS 交互。
高：需要重做多页结构、复杂动画、多状态交互、响应式大改，或可能影响整体架构。

推荐程度判断标准：
★★★★★：低成本且明显改善核心理解、转化或操作路径，建议优先做。
★★★★☆：收益明确，但需要一点重排或判断，适合当前阶段做。
★★★☆☆：有帮助，但不是关键问题，可作为可选优化。
★★☆☆☆：收益有限或容易分散重点，不建议当前优先做。
★☆☆☆☆：可能炫技、过度设计或工程成本偏高，建议暂缓。

约束条件：
- 最多输出 3 条建议。
- 不写总评，不泛泛表扬，不重写整份页面。
- 不建议复杂后台、数据库、AI API、上传服务或重做整站。
- 每条建议必须引用当前页面中的具体区域、标题、模块、按钮、表格或可见文字。如果看不清页面内容，必须说明不确定，不要假装看见。
- 三条建议之间尽量覆盖不同页面、不同区域或不同问题，不要全部集中在同一个模块。
- 优先推荐低成本、少改文案、少加交互的方案。
- 如果一个建议需要新增较多 JS、改变业务表达或引入复杂动效，请降低推荐星级。
- 不要为了显得高级而建议复杂动画、3D、沉浸式重做、多状态系统。优先选择低成本但能明显改善阅读或操作的改法。

每条建议必须按以下结构输出：

## 建议 N：一句话标题

页面类型判断：
方案/PPT / 产品界面 / 营销页 / 工具页 / 文章页 / 其他

你看到的问题：
用 1-2 句话说明当前页面哪里不顺。必须引用页面里的具体区域、标题、模块、按钮、表格或可见文字。

为什么值得改：
说明这个修改能改善什么：理解速度、说服力、转化、操作效率、视觉记忆点、移动端阅读体验等。

建议怎么改：
给出具体调整方向。不要只写“增强层级”“优化体验”这类空话。

执行难度：
低 / 中 / 高

推荐程度：
★☆☆☆☆ 到 ★★★★★

为什么推荐：
用一句普通用户能理解的话说明为什么这条值得先做或不值得现在做。

给 coding AI 的修改 prompt：
写一段可以直接复制给 coding AI 的执行指令，必须包含：
- 目标页面或目标区域
- 具体要改什么
- 保留什么现有风格
- 不要改什么
- 如适合用 ClickDeck 框选，请说明建议框选哪个区域`;

const COMMON_REQUIREMENTS_EN = `First decide what type of page this is: proposal/PPT, product UI, marketing page, tool page, article page, or something else. Your suggestions must fit that page type. Do not apply a fixed template.

Implementation difficulty scale:
Low: mostly adjusts order, font size, spacing, emphasis, hierarchy, deletion, or movement of existing modules.
Medium: requires rebuilding one page region, or adding a small amount of HTML/CSS/vanilla JS interaction.
High: requires rebuilding multiple pages, complex animation, multi-state interaction, major responsive changes, or changes that may affect the overall architecture.

Recommendation rating scale:
★★★★★: low cost and clearly improves core comprehension, conversion, or the operation path; do it first.
★★★★☆: clear value, but needs some layout work or judgment; suitable for the current phase.
★★★☆☆: useful, but not a core issue; optional optimization.
★★☆☆☆: limited value or may distract from the main point; do not prioritize now.
★☆☆☆☆: likely over-designed, gimmicky, or costly; defer it.

Constraints:
- Output at most 3 suggestions.
- Do not write an overall review, generic praise, or a full-page rewrite.
- Do not suggest complex backend work, databases, AI APIs, upload services, or rebuilding the whole site/app.
- Each suggestion must cite a specific region, heading, module, button, table, or visible text from the current page. If you cannot clearly see the page content, say that you are unsure instead of pretending.
- The 3 suggestions should cover different regions or different problems when possible. Do not put all of them on the same module.
- Prefer low-cost changes that keep copy mostly intact and avoid adding unnecessary interaction.
- If a suggestion requires substantial JS, changes business messaging, or adds complex motion, lower its recommendation rating.
- Do not propose complex animation, 3D effects, immersive rebuilds, or multi-state systems just to sound advanced. Prefer low-cost changes that clearly improve reading or operation.

Each suggestion must use this exact structure:

## Suggestion N: One-line title

Page type judgment:
Proposal/PPT / Product UI / Marketing page / Tool page / Article page / Other

What you noticed:
Use 1-2 sentences to describe what feels unclear or ineffective. You must cite a concrete region, heading, module, button, table, or visible text from the page.

Why it is worth changing:
Explain what this improves: comprehension speed, persuasion, conversion, operation efficiency, visual memorability, mobile readability, etc.

How to change it:
Give a concrete adjustment. Do not write vague advice such as "improve hierarchy" or "enhance the experience" without specifics.

Implementation difficulty:
Low / Medium / High

Recommendation:
★☆☆☆☆ to ★★★★★

Why this rating:
Use one plain sentence that a non-technical user can understand.

Prompt for coding AI:
Write one directly copyable instruction for a coding AI. It must include:
- Target page or target region
- Exactly what to change
- What existing style to preserve
- What not to change
- If ClickDeck selection would help, specify which area the user should select`;

const FLOW_FOCUS_ZH = `请从“看逻辑”视角评审当前页面。
聚焦要求：
- 页面顺序是否顺。
- 信息递进是否自然。
- 用户是否知道下一步为什么出现。
- 方案/PPT 是否有说服闭环。
- 产品 UI 是否有清楚的任务路径。`;

const FOCUS_FOCUS_ZH = `请从“看重点”视角评审当前页面。
聚焦要求：
- 第一眼看到什么。
- 核心标题、数字、按钮、金句、图表是否足够突出。
- 页面是否太满、太平均或太松。
- 重要信息是否被次要信息淹没。
- 视觉主次是否适合当前页面类型。`;

const INTERACTION_FOCUS_ZH = `请从“看交互”视角评审当前页面。
聚焦要求：
- 静态内容是否适合改成轻量交互。
- 表格、时间线、矩阵、步骤、筛选、卡片是否有更清楚的表达形式。
- 小产品 UI 的按钮、入口、表单、切换路径是否顺手。
- 移动端阅读或操作是否吃力。
- 只建议纯 HTML/CSS/少量原生 JS 能完成的轻交互。`;

const FLOW_FOCUS_EN = `Review the current page from the "Check Flow" perspective.
Focus on:
- Whether the page order feels natural.
- Whether the information progression is clear.
- Whether the user understands why the next section appears.
- Whether a proposal/PPT has a persuasive loop.
- Whether a product UI has a clear task path.`;

const FOCUS_FOCUS_EN = `Review the current page from the "Check Focus" perspective.
Focus on:
- What the user sees first.
- Whether the core heading, numbers, CTA, quote, chart, or key message stands out.
- Whether the page feels too dense, too flat, or too loose.
- Whether important information is buried by secondary information.
- Whether the visual hierarchy fits the page type.`;

const INTERACTION_FOCUS_EN = `Review the current page from the "Check Interaction" perspective.
Focus on:
- Whether static content would be clearer as lightweight interaction.
- Whether tables, timelines, matrices, steps, filters, or cards could be expressed more clearly.
- Whether a product UI's buttons, entry points, forms, or switching paths feel smooth.
- Whether mobile reading or operation feels difficult.
- Only suggest lightweight interactions that can be built with plain HTML/CSS and a small amount of vanilla JS.`;

export const askGeminiPrompts = {
  en: {
    flow: `${FLOW_FOCUS_EN}\n\n${COMMON_REQUIREMENTS_EN}`,
    focus: `${FOCUS_FOCUS_EN}\n\n${COMMON_REQUIREMENTS_EN}`,
    interaction: `${INTERACTION_FOCUS_EN}\n\n${COMMON_REQUIREMENTS_EN}`
  },
  zh: {
    flow: `${FLOW_FOCUS_ZH}\n\n${COMMON_REQUIREMENTS_ZH}`,
    focus: `${FOCUS_FOCUS_ZH}\n\n${COMMON_REQUIREMENTS_ZH}`,
    interaction: `${INTERACTION_FOCUS_ZH}\n\n${COMMON_REQUIREMENTS_ZH}`
  }
} as const;

export function getAskGeminiPrompt(key: AskGeminiPromptKey, language: AskGeminiPromptLanguage): string {
  return askGeminiPrompts[language][key];
}
