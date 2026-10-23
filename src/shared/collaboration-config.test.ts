import { describe, expect, it } from 'vitest';
import { isCollaborationConfigValid } from './collaboration-config';
const url = 'https://example.supabase.co';
const key = 'sb_publishable_' + 'a'.repeat(30);
const jwt = (role: string) => 'e30.' + btoa(JSON.stringify({ role })).replace(/=/g, '') + '.signature';
describe('public collaboration client configuration', () => {
  it('accepts public and legacy anon credentials', () => {
    for (const publishableKey of [key, jwt('anon')]) expect(isCollaborationConfigValid({ projectUrl:url, publishableKey })).toBe(true);
  });
  it('rejects administrator, secret and unclassified credentials', () => {
    for (const publishableKey of ['sb_secret_' + 'a'.repeat(30), jwt('service_role'), jwt('authenticated'), 'a'.repeat(40), 'broken.jwt.value']) {
      expect(isCollaborationConfigValid({ projectUrl:url, publishableKey })).toBe(false);
    }
  });
  it('rejects credential-bearing or redirected project URLs', () => {
    for (const projectUrl of ['http://example.supabase.co', 'https://user:password@example.supabase.co', url+'/rest/v1', url+'?key=x', url+'#x', 'https://example.supabase.co.attacker.test']) {
      expect(isCollaborationConfigValid({ projectUrl, publishableKey:key })).toBe(false);
    }
  });
});
