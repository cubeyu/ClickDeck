export function normalizeHtmlForFingerprint(html: string): string {
  return html.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}
export async function createPageFingerprint(html: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto API is unavailable; cannot create a page fingerprint.");
  }
  const bytes = new TextEncoder().encode(normalizeHtmlForFingerprint(html));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
