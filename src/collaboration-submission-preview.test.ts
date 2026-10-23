// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createSubmissionPreview, confirmationSourceLabel } from "./collaboration-submission-preview";
import type { SharedTask } from "./shared/collaboration-contract";
const style: SharedTask = { id: "1", sequence: 0, kind: "style", summary: "Title", property: "fontSize", before: "56px", after: "86px" };
describe("readable submission confirmation", () => {
  it("keeps a web origin and readable file context without treating a label as the source identity", () => {
    expect(confirmationSourceLabel("file:///D:/private/%E8%81%AA%E6%98%8E/index.html")).toBe("本地文件 · 聪明/index.html");
    expect(confirmationSourceLabel("https://example.com/a/index.html#slide2")).toBe("https://example.com · a/index.html");
    expect(confirmationSourceLabel("file:///D:/invalid%/index.html")).toContain("invalid%");
    expect(confirmationSourceLabel("not a URL")).toBe("not a URL");
  });
  it("shows a human-readable diff and keeps JSON collapsed without mutating tasks", () => {
    const tasks = Object.freeze([Object.freeze({ ...style })]);
    const view = createSubmissionPreview(tasks);
    expect(view.querySelector(".submission-kind")?.textContent).toBe("字号");
    expect(view.querySelector(".submission-headline .submission-change")).not.toBeNull();
    expect(view.querySelector(".submission-row")?.children).toHaveLength(2);
    expect(view.querySelector<HTMLDetailsElement>(".submission-full")?.open).toBe(false);
    expect(view.querySelector(".submission-change")?.textContent).toBe("56px → 86px");
    expect(view.querySelector<HTMLDetailsElement>(".submission-raw")?.open).toBe(false);
    expect(JSON.parse(view.querySelector("pre")!.textContent!)).toEqual(tasks);
    expect(tasks[0].after).toBe("86px");
  });
  it("treats hostile markup and image URLs as text, without loading resources", () => {
    const view = createSubmissionPreview([{ ...style, kind: "attribute", attribute: "src", summary: '<img src=x onerror="alert(1)">', after: "javascript:alert(1)" }]);
    expect(view.querySelectorAll("img,script,iframe,a")).toHaveLength(0);
    expect(view.textContent).toContain("javascript:alert(1)");
    expect(view.textContent).toContain("不加载图片");
  });
  it("shortens long values but preserves full text and distinguishes unknown from empty", () => {
    const view = createSubmissionPreview([{ ...style, kind: "content", before: undefined, after: "长".repeat(4000) }, { ...style, id: "2", kind: "content", after: "" }]);
    expect(view.querySelector(".submission-change")!.textContent!.length).toBeLessThan(150);
    expect(view.querySelector(".submission-full p")?.textContent).toContain("长".repeat(4000));
    expect(view.textContent).toContain("原值未记录"); expect(view.textContent).toContain("空内容");
  });
  it("covers move, remove and free-form intent without inventing page numbers or execution", () => {
    const view = createSubmissionPreview((["move", "remove", "intent"] as const).map((kind, i) => ({ id: String(i), sequence: i, kind, summary: "请调整此区域" })));
    expect(view.querySelectorAll(".submission-item")).toHaveLength(3);
    expect(view.textContent).toContain("移动建议"); expect(view.textContent).toContain("删除建议");
    expect(view.textContent).toContain("目标位置未明确记录");
    expect(view.textContent).not.toContain("第 1 页");
  });
});
