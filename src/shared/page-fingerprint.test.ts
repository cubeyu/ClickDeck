import { describe, expect, it } from "vitest";
import { createPageFingerprint, normalizeHtmlForFingerprint } from "./page-fingerprint";

describe("page fingerprint", () => {
  it("normalizes BOM and line endings without changing meaningful content", async () => {
    const windows = "\uFEFF<html>\r\n<body>A</body>\r\n</html>";
    const unix = "<html>\n<body>A</body>\n</html>";
    expect(normalizeHtmlForFingerprint(windows)).toBe(unix);
    expect(await createPageFingerprint(windows)).toBe(await createPageFingerprint(unix));
  });

  it("changes when the HTML content changes", async () => {
    expect(await createPageFingerprint("<p>A</p>"))
      .not.toBe(await createPageFingerprint("<p>B</p>"));
  });
});
