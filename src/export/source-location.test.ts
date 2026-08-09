import { describe, expect, it, vi } from "vitest";
import { fetchAndResolveSourceLocations, resolveSourceLocations } from "./source-location";

describe("source location evidence", () => {
  const html = `<!doctype html>
<html>
  <body>
    <main>
      <h1 id="hero-title">Quarterly Product Review</h1>
      <img class="hero-image" src="assets/hero.png" alt="Hero visual">
      <p class="summary">A unique summary sentence.</p>
    </main>
  </body>
</html>`;

  it("resolves a unique id to the original HTML start line", () => {
    const result = resolveSourceLocations(html, "https://example.com/index.html", [{
      key: "#hero-title",
      tagName: "h1",
      idHint: "#hero-title",
      textSnippet: "Quarterly Product Review",
      selectorStability: "high"
    }]);

    expect(result.locations["#hero-title"]).toMatchObject({
      line: 5,
      column: 7,
      confidence: "high",
      matchMethod: "unique-id"
    });
  });

  it("uses unique stable class, image, and text evidence without guessing duplicated targets", () => {
    const result = resolveSourceLocations(html, "https://example.com/index.html", [
      { key: "image", tagName: "img", imageHint: "Hero visual", selectorStability: "medium" },
      { key: "summary", tagName: "p", classHint: ".summary", textSnippet: "A unique summary sentence.", selectorStability: "high" },
      { key: "missing", tagName: "div", classHint: ".card", selectorStability: "medium" }
    ]);

    expect(result.locations.image.matchMethod).toBe("unique-image");
    expect(result.locations.summary.matchMethod).toBe("unique-class");
    expect(result.locations.missing).toBeUndefined();
  });

  it("returns unavailable instead of a guessed line when candidates are duplicated", () => {
    const duplicated = `<!doctype html><html><body>
      <p class="item">Same</p>
      <p class="item">Same</p>
    </body></html>`;
    const result = resolveSourceLocations(duplicated, "https://example.com/", [{
      key: "item",
      tagName: "p",
      classHint: ".item",
      textSnippet: "Same",
      selectorStability: "medium"
    }]);

    expect(result.locations).toEqual({});
    expect(result.unavailableReason).toBe("no-unique-source-match");
  });

  it("does not mistake tags inside comments or raw script text for page elements", () => {
    const source = `<!doctype html><html><body>
      <!-- <h1 id="comment-title">Comment only</h1> -->
      <script>const sample = '<h1 id="script-title">Script only</h1>';</script>
      <h1 id="real-title">Real title</h1>
    </body></html>`;
    const result = resolveSourceLocations(source, "https://example.com/", [
      { key: "comment", tagName: "h1", idHint: "#comment-title" },
      { key: "script", tagName: "h1", idHint: "#script-title" },
      { key: "real", tagName: "h1", idHint: "#real-title" }
    ]);

    expect(result.locations.comment).toBeUndefined();
    expect(result.locations.script).toBeUndefined();
    expect(result.locations.real.line).toBe(4);
  });

  it("fetches only HTML resources and degrades cleanly on failure", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(html, { status: 200, headers: { "content-type": "text/html" } }));
    const result = await fetchAndResolveSourceLocations("https://example.com/index.html", [{
      key: "#hero-title",
      tagName: "h1",
      idHint: "#hero-title"
    }], fetcher);
    expect(result.locations["#hero-title"].line).toBe(5);
    expect(fetcher).toHaveBeenCalledWith("https://example.com/index.html", expect.objectContaining({
      cache: "no-store",
      credentials: "include"
    }));

    const failed = await fetchAndResolveSourceLocations("https://example.com/index.html", [], vi.fn().mockRejectedValue(new Error("offline")));
    expect(failed.locations).toEqual({});
    expect(failed.unavailableReason).toBe("source-fetch-failed");
  });
});
