// Explicit local diagnostic builds only. No network observers or stored history.
const bootAt = performance.now();
let sequence = 0;

export function beginSourceDiagnostic(url: string) {
  if (import.meta.env.VITE_CLICKDECK_SOURCE_DIAGNOSTICS !== '1' || !url.startsWith('file:')) return;
  const started = performance.now();
  const number = ++sequence;
  return {
    finish(error: string, permission: boolean | undefined, exception: unknown): string {
      let version = 'unknown';
      try {
        const candidate = chrome.runtime.getManifest().version;
        if (/^\d+(?:\.\d+){0,3}$/.test(candidate)) version = candidate;
      } catch { /* optional runtime metadata */ }
      const browser = typeof navigator === 'undefined' ? 'unknown'
        : navigator.userAgent.match(/(?:Edg|Chrome)\/\d+(?:\.\d+){0,3}/g)?.join(' ') ?? 'unknown';
      const exceptionKind = exception instanceof Error && ['TypeError', 'AbortError', 'Error'].includes(exception.name) ? exception.name : 'other';
      // Return safe metadata only to this check's original caller. Never include
      // exception messages, URLs, page contents, account data or fingerprints.
      return JSON.stringify({
        diagnostic: 'ClickDeck source check v2', version, browser,
        attemptInWorker: number, workerAgeMs: Math.round(started - bootAt),
        elapsedMs: Math.round(performance.now() - started), source: 'file',
        fileAccess: permission ?? 'unknown',
        error: /^source-[a-z-]+$/.test(error) ? error : 'source-unavailable',
        exceptionKind, nativeError: 'not-available'
      }, null, 2);
    }
  };
}
