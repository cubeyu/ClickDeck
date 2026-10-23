import { afterEach, describe, expect, it, vi } from "vitest";
import { readSourceFingerprint } from "./source-fingerprint";
describe("original source verification", () => {
  afterEach(() => vi.unstubAllGlobals());
  it('distinguishes missing URL, permission API failure and fetch rejection without exposing exception data', async () => {
    expect(await readSourceFingerprint(undefined)).toEqual({ ok: false, error: 'source-url-missing' });
    expect(await readSourceFingerprint('file:///C:/test.html', async () => { throw new Error('private path'); })).toEqual({ ok: false, error: 'source-fetch-failed' });
    vi.stubGlobal('chrome', { extension: { isAllowedFileSchemeAccess: async () => { throw new Error('private detail'); } } });
    expect(await readSourceFingerprint('file:///C:/test.html')).toEqual({ ok: false, error: 'source-permission-check-failed' });
  });
  it('identifies missing file access before attempting to read source bytes', async () => {
    vi.stubGlobal('chrome', { extension: { isAllowedFileSchemeAccess: async () => false } });
    const fetcher = vi.fn<typeof fetch>();
    expect(await readSourceFingerprint('file:///C:/test.html', fetcher)).toEqual({ ok: false, error: 'source-file-permission' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("identifies equal source across paths and normalizes BOM/newlines", async () => {
    const a = await readSourceFingerprint("file:///C:/a.html", async () => new Response("\uFEFF<!doctype html>\r\n<body>A</body>") as never);
    const b = await readSourceFingerprint("file:///D:/other/renamed.html#page2", async () => new Response("<!doctype html>\n<body>A</body>") as never);
    expect(a).toEqual(b); expect(a.ok).toBe(true);
    expect(await readSourceFingerprint("file:///C:/a.html", async () => new Response("<!doctype html>\n<body>B</body>") as never)).not.toEqual(a);
  });
  it("fails closed on inaccessible or non-HTML sources instead of using a DOM fallback", async () => {
    expect(await readSourceFingerprint("file:///C:/a.html", async () => { throw Error(); })).toMatchObject({ ok: false });
    expect(await readSourceFingerprint("data:text/html,x")).toMatchObject({ ok: false });
    expect(await readSourceFingerprint("https://example.com/a", async () => new Response("plain text") as never)).toEqual({ ok: false, error: 'source-not-html' });
  });
  it("rejects oversized or invalid UTF-8 files", async () => {
    expect(await readSourceFingerprint("file:///C:/a.html", async () => new Response(new Uint8Array([255])) as never)).toEqual({ ok: false, error: 'source-invalid-encoding' });
    expect(await readSourceFingerprint("file:///C:/a.html", async () => new Response("<!doctype html>" + "x".repeat(64 * 1024 * 1024)) as never)).toEqual({ ok: false, error: 'source-too-large' });
  });
  it('accepts embedded-resource HTML above the former 8 MiB limit without changing its fingerprint algorithm', async () => {
    const html = '<!doctype html><body>' + 'a'.repeat(9 * 1024 * 1024) + '</body>';
    const expected = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ClickDeck source-v2\n' + html))), byte => byte.toString(16).padStart(2, '0')).join('');
    expect(await readSourceFingerprint('file:///C:/large.html', async () => new Response(html) as never))
      .toEqual({ ok: true, fingerprint: expected });
  });
});
