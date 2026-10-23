import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginSourceDiagnostic } from './source-diagnostics';
import { readSourceFingerprint } from './source-fingerprint';

const fileUrl = 'file:///D:/private-course/private-secret.html';
const allowedFileAccess = vi.fn(async () => true);
describe('local-only source diagnostics', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CLICKDECK_SOURCE_DIAGNOSTICS', '1');
    allowedFileAccess.mockResolvedValue(true);
    vi.stubGlobal('chrome', {
      runtime: { getManifest: () => ({ version: '1.3.7' }) },
      extension: { isAllowedFileSchemeAccess: allowedFileAccess },
      get webRequest() { throw new Error('Must not observe network requests'); },
      get storage() { throw new Error('Must not store diagnostic history'); },
      get alarms() { throw new Error('Must not keep the worker awake'); }
    });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('does not return diagnostics in a normal build', async () => {
    vi.stubEnv('VITE_CLICKDECK_SOURCE_DIAGNOSTICS', '');
    expect(await readSourceFingerprint(fileUrl, async () => { throw new TypeError('private'); }))
      .toEqual({ ok: false, error: 'source-fetch-failed' });
    expect(beginSourceDiagnostic(fileUrl)).toBeUndefined();
  });

  it('reports failure stage and worker age without source or exception details', async () => {
    const result = await readSourceFingerprint(fileUrl + '#private-fragment', async () => {
      throw new TypeError('private-secret PRIVATE BODY Bearer secret-token ' + fileUrl);
    });
    if (result.ok || !result.sourceDiagnostic) throw new Error('Missing diagnostic');
    expect(JSON.parse(result.sourceDiagnostic)).toEqual({
      diagnostic: 'ClickDeck source check v2', version: '1.3.7', browser: expect.any(String),
      attemptInWorker: expect.any(Number), workerAgeMs: expect.any(Number), elapsedMs: expect.any(Number),
      source: 'file', fileAccess: true, error: 'source-fetch-failed', exceptionKind: 'TypeError', nativeError: 'not-available'
    });
    for (const value of [fileUrl, 'private-secret', 'private-fragment', 'PRIVATE BODY', 'secret-token']) expect(result.sourceDiagnostic).not.toContain(value);
  });

  it('reports denied file permission without attempting a read', async () => {
    allowedFileAccess.mockResolvedValue(false);
    const fetcher = vi.fn<typeof fetch>();
    const result = await readSourceFingerprint(fileUrl, fetcher);
    expect(result).toMatchObject({ ok: false, error: 'source-file-permission' });
    if (!result.ok) expect(JSON.parse(result.sourceDiagnostic!)).toMatchObject({ fileAccess: false, error: 'source-file-permission' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['http://example.com/source.html', 'https://example.com/source.html'])('does not add diagnostics for %s', async url => {
    expect(await readSourceFingerprint(url, async () => { throw new TypeError(); })).toEqual({ ok: false, error: 'source-fetch-failed' });
    expect(beginSourceDiagnostic(url)).toBeUndefined();
  });

  it('keeps the successful fingerprint response unchanged and adds no timers', async () => {
    const heartbeat = vi.spyOn(globalThis, 'setInterval');
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const result = await readSourceFingerprint(fileUrl, async () => new Response('<!doctype html><html><body>private</body></html>'));
    expect(result).toEqual({ ok: true, fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(heartbeat).not.toHaveBeenCalled();
    expect(timeout).toHaveBeenCalledTimes(1);
  });

  it('counts checks in the same worker and does not expose arbitrary errors', () => {
    const first = beginSourceDiagnostic(fileUrl)!;
    const second = beginSourceDiagnostic(fileUrl)!;
    const a = JSON.parse(first.finish('private-secret', undefined, { name: 'private-secret' }));
    const b = JSON.parse(second.finish('source-fetch-failed', true, new Error('private-secret')));
    expect(b.attemptInWorker).toBe(a.attemptInWorker + 1);
    expect(a).toMatchObject({ fileAccess: 'unknown', error: 'source-unavailable', exceptionKind: 'other' });
    expect(JSON.stringify([a, b])).not.toContain('private-secret');
  });
});
