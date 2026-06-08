import { describe, it, expect } from "vitest";
import { askGeminiPrompts, getAskGeminiPrompt } from "./ask-gemini";

describe("askGeminiPrompts", () => {
  it("should have three distinct prompts per language", () => {
    for (const prompts of [askGeminiPrompts.en, askGeminiPrompts.zh]) {
      expect(prompts.flow).not.toEqual(prompts.focus);
      expect(prompts.flow).not.toEqual(prompts.interaction);
      expect(prompts.focus).not.toEqual(prompts.interaction);
    }
  });

  it("should return language-specific prompt text", () => {
    expect(getAskGeminiPrompt("flow", "en")).toContain("Review the current page from the \"Check Flow\" perspective.");
    expect(getAskGeminiPrompt("flow", "en")).not.toContain("请从“看逻辑”视角评审当前页面");
    expect(getAskGeminiPrompt("flow", "zh")).toContain("请从“看逻辑”视角评审当前页面");
  });

  const zhPrompts = [
    { name: "flow", prompt: askGeminiPrompts.zh.flow },
    { name: "focus", prompt: askGeminiPrompts.zh.focus },
    { name: "interaction", prompt: askGeminiPrompts.zh.interaction },
  ];

  for (const { name, prompt } of zhPrompts) {
    it(`${name} zh prompt should contain all required constraints and output formats`, () => {
      // 页面类型判断
      expect(prompt).toContain("请先根据当前网页判断它更像哪种类型：方案/PPT、产品界面、营销页、工具页、文章页或其他");
      expect(prompt).toContain("页面类型判断：");

      // 最多 3 条建议
      expect(prompt).toContain("最多输出 3 条建议");

      // 执行难度判断标准
      expect(prompt).toContain("执行难度判断标准：");
      expect(prompt).toContain("执行难度：\n低 / 中 / 高");

      // 星级推荐标准
      expect(prompt).toContain("推荐程度判断标准：");
      expect(prompt).toContain("推荐程度：\n★☆☆☆☆ 到 ★★★★★");

      // 给 coding AI 的修改 prompt
      expect(prompt).toContain("给 coding AI 的修改 prompt：");
      expect(prompt).toContain("写一段可以直接复制给 coding AI 的执行指令");

      // 禁止 API/上传/后端/重做整站
      expect(prompt).toContain("不建议复杂后台、数据库、AI API、上传服务或重做整站");

      // 防止过度设计
      expect(prompt).toContain("优先推荐低成本、少改文案、少加交互的方案");
      expect(prompt).toContain("如果一个建议需要新增较多 JS、改变业务表达或引入复杂动效，请降低推荐星级");
    });
  }

  const enPrompts = [
    { name: "flow", prompt: askGeminiPrompts.en.flow },
    { name: "focus", prompt: askGeminiPrompts.en.focus },
    { name: "interaction", prompt: askGeminiPrompts.en.interaction },
  ];

  for (const { name, prompt } of enPrompts) {
    it(`${name} en prompt should contain all required constraints and output formats`, () => {
      expect(prompt).toContain("First decide what type of page this is");
      expect(prompt).toContain("Page type judgment:");
      expect(prompt).toContain("Output at most 3 suggestions");
      expect(prompt).toContain("Implementation difficulty scale:");
      expect(prompt).toContain("Implementation difficulty:\nLow / Medium / High");
      expect(prompt).toContain("Recommendation rating scale:");
      expect(prompt).toContain("Recommendation:\n★☆☆☆☆ to ★★★★★");
      expect(prompt).toContain("Prompt for coding AI:");
      expect(prompt).toContain("Write one directly copyable instruction for a coding AI");
      expect(prompt).toContain("Do not suggest complex backend work, databases, AI APIs, upload services, or rebuilding the whole site/app");
      expect(prompt).toContain("Prefer low-cost changes that keep copy mostly intact and avoid adding unnecessary interaction");
      expect(prompt).toContain("If a suggestion requires substantial JS, changes business messaging, or adds complex motion, lower its recommendation rating");
    });
  }
});
