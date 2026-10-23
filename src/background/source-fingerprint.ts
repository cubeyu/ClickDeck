import { beginSourceDiagnostic } from './source-diagnostics';

// Background-only: never fingerprint the rendered DOM or accept a URL from page messages.
export async function readSourceFingerprint(url: string | undefined, fetcher: typeof fetch = fetch): Promise<{ ok: true; fingerprint: string } | { ok: false; error: string; sourceDiagnostic?: string }> {
  if (!url) return { ok: false, error: "source-url-missing" };
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, error: "source-unavailable" }; }
  if (!["file:", "https:", "http:"].includes(parsed.protocol)) return { ok: false, error: "source-unavailable" };
  parsed.hash = "";
  const diagnostic = beginSourceDiagnostic(parsed.href);
  let fileAccess: boolean | undefined;
  async function failure(error: string, exception?: unknown): Promise<{ ok: false; error: string; sourceDiagnostic?: string }> {
    let sourceDiagnostic: string | undefined;
    try { sourceDiagnostic = await diagnostic?.finish(error, fileAccess, exception); } catch { /* observation is best effort */ }
    return { ok: false, error, ...(sourceDiagnostic ? { sourceDiagnostic } : {}) };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let stage = 'source-permission-check-failed';
  try {
    if (parsed.protocol === 'file:' && typeof chrome !== 'undefined'
      && chrome.extension?.isAllowedFileSchemeAccess) {
      fileAccess = await chrome.extension.isAllowedFileSchemeAccess();
      if (!fileAccess) return await failure('source-file-permission');
    }
    stage = 'source-fetch-failed';
    const response = await fetcher(parsed.href, { cache: "no-store", credentials: "include", signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(parsed.protocol === 'file:' ? 'source-unavailable' : 'source-http-error');
    stage = 'source-stream-failed';
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 64 * 1024 * 1024) { await reader.cancel(); throw new Error('source-too-large'); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let html: string;
    try { html = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"); }
    catch { throw new Error('source-invalid-encoding'); }
    if (!/<(?:!doctype\s+html|html|body)[\s>]/i.test(html.slice(0,4096))) throw new Error('source-not-html');
    stage = 'source-hash-failed';
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ClickDeck source-v2\n" + html));
    return { ok: true, fingerprint: Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2,"0")).join("") };
  } catch (error) {
    const codes = ['source-unavailable', 'source-too-large', 'source-invalid-encoding', 'source-not-html', 'source-http-error'];
    return await failure(controller.signal.aborted ? 'source-timeout' : error instanceof Error && codes.includes(error.message) ? error.message : stage, error);
  }
  finally { clearTimeout(timer); }
}
