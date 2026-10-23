// PKCE primitives only. Provider configuration and the trusted browser flow
// must be wired and verified before exposing a login action.
const base64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  return { verifier, challenge: await pkceChallenge(verifier) };
}

export async function pkceChallenge(verifier: string): Promise<string> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new Error('invalid-oauth-verifier');
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

// No provider error text or token-bearing URL escapes into diagnostics.
export function readOAuthCode(callback: string, expectedRedirect: string): string {
  try {
    const expected = new URL(expectedRedirect);
    const actual = new URL(callback);
    if (expected.protocol !== 'https:' || expected.username || expected.password || expected.search || expected.hash
      || actual.origin !== expected.origin || actual.pathname !== expected.pathname
      || actual.username || actual.password || actual.hash) throw new Error();
    const keys = [...actual.searchParams.keys()];
    if (keys.length !== 1 || keys[0] !== 'code') throw new Error();
    const code = actual.searchParams.get('code') ?? '';
    if (!/^[A-Za-z0-9._~-]{1,2048}$/.test(code)) throw new Error();
    return code;
  } catch { throw new Error('invalid-oauth-callback'); }
}

type Attempt = { id: string; verifier: string; redirect: string; expiresAt: number };
type AttemptStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
};
const ATTEMPT_KEY = 'clickdeck:oauth-attempt:v1';

// Use extension session storage, restricted to trusted extension contexts.
// Persisting an attempt lets a restarted service worker expire or consume it.
export function createOAuthAttempts(storage: AttemptStorage, now = Date.now) {
  let busy = false;
  async function exclusively<T>(action: () => Promise<T>): Promise<T> {
    if (busy) throw new Error('oauth-busy');
    busy = true;
    try { return await action(); } finally { busy = false; }
  }
  async function current(): Promise<Attempt | undefined> {
    const value = (await storage.get(ATTEMPT_KEY))[ATTEMPT_KEY] as Partial<Attempt> | undefined;
    if (!value || typeof value.id !== 'string' || typeof value.verifier !== 'string'
      || typeof value.redirect !== 'string' || typeof value.expiresAt !== 'number'
      || !Number.isFinite(value.expiresAt)) return undefined;
    return value as Attempt;
  }
  return {
    begin: (redirect: string) => exclusively(async () => {
      // Validate the same redirect syntax accepted by callback parsing.
      readOAuthCode(redirect + '?code=validation', redirect);
      const old = await current();
      if (old && old.expiresAt > now()) throw new Error('oauth-busy');
      const pair = await createPkcePair();
      const attempt: Attempt = { id: crypto.randomUUID(), verifier: pair.verifier, redirect, expiresAt: now() + 5 * 60_000 };
      await storage.set({ [ATTEMPT_KEY]: attempt });
      return { id: attempt.id, challenge: pair.challenge, redirect: attempt.redirect };
    }),
    consume: (id: string, callback: string) => exclusively(async () => {
      const attempt = await current();
      if (!attempt || attempt.id !== id) throw new Error('invalid-oauth-attempt');
      // One-use even on malformed callbacks, expiration or exchange failure.
      await storage.remove(ATTEMPT_KEY);
      if (attempt.expiresAt <= now()) throw new Error('oauth-expired');
      const code = readOAuthCode(callback, attempt.redirect);
      await pkceChallenge(attempt.verifier);
      return { code, verifier: attempt.verifier };
    }),
    cancel: (id: string) => exclusively(async () => {
      const attempt = await current();
      // A late cancellation from an old window cannot erase a newer attempt.
      if (attempt?.id === id) await storage.remove(ATTEMPT_KEY);
    })
  };
}

type OAuthSession = { accessToken: string; refreshToken: string; userId: string; expiresAt: number };
export type OAuthLinkContext = { accessToken: string; userId: string };

// Injectable transport keeps secrets inside the background context. The caller
// supplies chrome.identity and must not expose this operation to page senders.
export function createGoogleOAuthFlow(options: {
  projectUrl: string; publicKey: string; redirect: string; storage: AttemptStorage;
  launch(url: string): Promise<string | undefined>;
  fetcher?: typeof fetch; now?: () => number;
}) {
  const attempts = createOAuthAttempts(options.storage, options.now);
  const fetcher = options.fetcher ?? fetch;
  return async (link?: OAuthLinkContext): Promise<OAuthSession> => {
    const endpoint = new URL(options.projectUrl);
    if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.supabase.co')
      || endpoint.username || endpoint.password || endpoint.port || endpoint.pathname !== '/'
      || endpoint.search || endpoint.hash) throw new Error('invalid-oauth-config');
    const attempt = await attempts.begin(options.redirect);
    try {
      const authorize = new URL(link ? '/auth/v1/user/identities/authorize' : '/auth/v1/authorize', endpoint);
      authorize.search = new URLSearchParams({ provider: 'google', redirect_to: attempt.redirect,
        code_challenge: attempt.challenge, code_challenge_method: 's256' }).toString();
      let authorizeUrl = authorize.href;
      if (link) {
        authorize.searchParams.set('skip_http_redirect', 'true');
        const response = await fetcher(authorize, { method: 'GET', redirect: 'error',
          headers: { apikey: options.publicKey, Authorization: `Bearer ${link.accessToken}` } });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (body.code === 'manual_linking_disabled' || body.error_code === 'manual_linking_disabled') throw new Error('identity-link-disabled');
          if (body.code === 'identity_already_exists' || body.error_code === 'identity_already_exists') throw new Error('identity-link-conflict');
          throw new Error('identity-link-failed');
        }
        const target = new URL(body.url);
        if (target.origin !== 'https://accounts.google.com' || target.username || target.password) throw new Error('identity-link-failed');
        authorizeUrl = target.href;
      }
      const callback = await options.launch(authorizeUrl);
      if (!callback) throw new Error('oauth-cancelled');
      const { code, verifier } = await attempts.consume(attempt.id, callback);
      const response = await fetcher(new URL('/auth/v1/token?grant_type=pkce', endpoint), {
        method: 'POST', headers: { apikey: options.publicKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_code: code, code_verifier: verifier }), redirect: 'error'
      });
      if (!response.ok) throw new Error('oauth-exchange-failed');
      const body = await response.json();
      if (typeof body.access_token !== 'string' || !body.access_token || typeof body.refresh_token !== 'string'
        || !body.refresh_token || typeof body.user?.id !== 'string' || !body.user.id
        || body.user.is_anonymous !== false || !Array.isArray(body.user.identities)
        || !body.user.identities.some((identity: { provider?: string }) => identity?.provider === 'google')
        || typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
        throw new Error('invalid-oauth-session');
      }
      if (link && body.user.id !== link.userId) throw new Error('identity-link-conflict');
      return { accessToken: body.access_token, refreshToken: body.refresh_token, userId: body.user.id,
        expiresAt: (options.now ?? Date.now)() + body.expires_in * 1000 };
    } catch (error) {
      const allowed = ['identity-link-disabled', 'identity-link-conflict', 'identity-link-failed', 'oauth-cancelled', 'oauth-exchange-failed', 'invalid-oauth-session',
        'invalid-oauth-callback', 'invalid-oauth-attempt', 'oauth-expired'];
      throw new Error(error instanceof Error && allowed.includes(error.message) ? error.message : 'oauth-failed');
    } finally { await attempts.cancel(attempt.id); }
  };
}
