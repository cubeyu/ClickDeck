import { describe, expect, it } from 'vitest';
import { officialExtensionKey, OFFICIAL_EXTENSION_PUBLIC_KEY } from './official-extension-key';

describe('official extension build identity', () => {
  it('leaves local/test extension IDs unchanged by default', () => {
    expect(officialExtensionKey()).toBeUndefined();
    expect(officialExtensionKey('0')).toBeUndefined();
  });
  it('validates the operator public key against the existing store ID', () => {
    expect(officialExtensionKey('1')).toBe(OFFICIAL_EXTENSION_PUBLIC_KEY);
  });
  it('rejects misspelled configuration', () => {
    expect(() => officialExtensionKey('true')).toThrow('Unsupported');
  });
});
