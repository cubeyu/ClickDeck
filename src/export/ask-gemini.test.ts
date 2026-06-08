import { describe, it, expect } from "vitest";
import { askGeminiPrompts } from "./ask-gemini";

describe("askGeminiPrompts", () => {
  it("should have three distinct prompts", () => {
    expect(askGeminiPrompts.flow).not.toEqual(askGeminiPrompts.focus);
    expect(askGeminiPrompts.flow).not.toEqual(askGeminiPrompts.interaction);
    expect(askGeminiPrompts.focus).not.toEqual(askGeminiPrompts.interaction);
  });

  const allPrompts = [
    { name: "flow", prompt: askGeminiPrompts.flow },
    { name: "focus", prompt: askGeminiPrompts.focus },
    { name: "interaction", prompt: askGeminiPrompts.interaction },
  ];

  for (const { name, prompt } of allPrompts) {
    it(`${name} prompt should contain all required constraints and output formats`, () => {
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
    });
  }
});
