import { describe, expect, it, vi } from 'vitest';
import { createGoogleOAuthFlow, createOAuthAttempts, createPkcePair, pkceChallenge, readOAuthCode } from './collaboration-oauth';

describe('collaboration OAuth boundary primitives', () => {
  const redirect = 'https://extension-id.chromiumapp.org/collaboration';
  it('matches the RFC 7636 S256 vector and generates independent secure verifiers', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    const first = await createPkcePair();
    const second = await createPkcePair();
    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.challenge).toBe(await pkceChallenge(first.verifier));
  });
  it('accepts an exact redirect containing one authorization code', () => {
    expect(readOAuthCode(redirect + '?code=valid-code', redirect)).toBe('valid-code');
  });
  it.each([
    'https://attacker.test/collaboration?code=secret',
    'https://extension-id.chromiumapp.org/other?code=secret',
    redirect + '/?code=secret', redirect + '?code=a&code=b',
    redirect + '?code=', redirect + '?error=denied',
    redirect + '?code=a&access_token=secret', redirect + '#access_token=secret',
    'https://user@extension-id.chromiumapp.org/collaboration?code=secret', 'not-a-url'
  ])('rejects untrusted or ambiguous callbacks without leaking their contents: %s', value => {
    expect(() => readOAuthCode(value, redirect)).toThrow('invalid-oauth-callback');
  });
});

describe('OAuth attempt lifecycle', () => {
  const redirect = 'https://extension-id.chromiumapp.org/collaboration';
  function memory() {
    const data: Record<string, unknown> = {};
    return {
      get: async (key: string) => ({ [key]: data[key] }),
      set: async (values: Record<string, unknown>) => { Object.assign(data, values); },
      remove: async (key: string) => { delete data[key]; }
    };
  }
  it('links with the existing bearer and rejects a changed UID instead of merging accounts', async () => {
    const launch = vi.fn(async () => redirect + '?code=linked-code');
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes('/identities/authorize')) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer old-access');
        expect(String(url)).not.toContain('old-access');
        return Response.json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=opaque' });
      }
      return Response.json({ access_token: 'new', refresh_token: 'refresh', expires_in: 3600,
        user: { id: 'other-user', is_anonymous: false, identities: [{ provider: 'google' }] } });
    });
    const flow = createGoogleOAuthFlow({ projectUrl: 'https://example.supabase.co', publicKey: 'public',
      redirect, storage: memory(), fetcher, launch });
    await expect(flow({ accessToken: 'old-access', userId: 'old-user' })).rejects.toThrow('identity-link-conflict');
    expect(launch).toHaveBeenCalledTimes(1);
  });
  it('reports a disabled linking provider without launching or exchanging credentials', async () => {
    const launch = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ code: 'manual_linking_disabled' }, { status: 400 }));
    const flow = createGoogleOAuthFlow({ projectUrl: 'https://example.supabase.co', publicKey: 'public',
      redirect, storage: memory(), fetcher, launch });
    await expect(flow({ accessToken: 'old', userId: 'old-user' })).rejects.toThrow('identity-link-disabled');
    expect(launch).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('exchanges only the exact callback code using its PKCE verifier and returns a Google session', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const value = JSON.parse(String(init?.body));
      expect(value.auth_code).toBe('one-time-code');
      expect(value.code_verifier).toHaveLength(43);
      expect(init?.redirect).toBe('error');
      return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600,
        user: { id: 'google-user', is_anonymous: false, identities: [{ provider: 'google' }] } });
    });
    const flow = createGoogleOAuthFlow({ projectUrl: 'https://example.supabase.co', publicKey: 'public',
      redirect, storage: memory(), fetcher, now: () => 100,
      launch: async url => {
        expect(new URL(url).searchParams.get('provider')).toBe('google');
        expect(new URL(url).searchParams.has('code_verifier')).toBe(false);
        return redirect + '?code=one-time-code';
      } });
    expect(await flow()).toEqual({ accessToken: 'access', refreshToken: 'refresh', userId: 'google-user', expiresAt: 3600100 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('cancels without exchange and sanitizes browser errors', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const options = { projectUrl: 'https://example.supabase.co', publicKey: 'public', redirect,
      storage: memory(), fetcher, launch: async (): Promise<string | undefined> => undefined };
    await expect(createGoogleOAuthFlow(options)()).rejects.toThrow('oauth-cancelled');
    await expect(createGoogleOAuthFlow({ ...options, launch: async () => { throw new Error('private token'); } })())
      .rejects.toThrow('oauth-failed');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('consumes once across worker recreation without exposing the verifier at begin', async () => {
    const storage = memory();
    const attempt = await createOAuthAttempts(storage).begin(redirect);
    expect(attempt).not.toHaveProperty('verifier');
    const restarted = createOAuthAttempts(storage);
    const consumed = await restarted.consume(attempt.id, redirect + '?code=abc');
    expect(await pkceChallenge(consumed.verifier)).toBe(attempt.challenge);
    await expect(restarted.consume(attempt.id, redirect + '?code=abc')).rejects.toThrow('invalid-oauth-attempt');
  });
  it('rejects parallel login and stale cancellation, and expires after five minutes', async () => {
    let time = 0;
    const manager = createOAuthAttempts(memory(), () => time);
    const first = await manager.begin(redirect);
    await expect(manager.begin(redirect)).rejects.toThrow('oauth-busy');
    time = 300_000;
    await expect(manager.consume(first.id, redirect + '?code=a')).rejects.toThrow('oauth-expired');
    const second = await manager.begin(redirect);
    await manager.cancel(first.id);
    expect((await manager.consume(second.id, redirect + '?code=b')).code).toBe('b');
  });
  it('does not consume a different attempt, but invalid callbacks terminate their own attempt', async () => {
    const manager = createOAuthAttempts(memory());
    const attempt = await manager.begin(redirect);
    await expect(manager.consume('wrong', redirect + '?code=a')).rejects.toThrow('invalid-oauth-attempt');
    await expect(manager.consume(attempt.id, 'https://attacker.test/?code=a')).rejects.toThrow('invalid-oauth-callback');
    await expect(manager.consume(attempt.id, redirect + '?code=a')).rejects.toThrow('invalid-oauth-attempt');
  });
});
