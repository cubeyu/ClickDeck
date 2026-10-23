// Build-time only. A public identity key, never a signing/private credential.
import { createHash, createPublicKey } from 'node:crypto';

export const OFFICIAL_EXTENSION_ID = 'dejmgkhjgibolmfhfpgacfhpoindohmg';
export const OFFICIAL_EXTENSION_PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtwY6pqTV/N2xlhtQjtoErsGBKPOyAYJUElwD5MMdIrnJVmUVnsI0qZOIxm9xnP7NUWM9ej6QWYmACf827URDCgX9S4kyi+XZhBboT006+KbZkfRctiIendThIFSze14YUfiX1IcpIoJCVT3z4qkMKkgjIpEb6dR5U3JyOaLayp7vL++mzDImke4h1TW08XS6BtHz1zVqba5Km4kUrMrZ8A3IwzgD3S/eCH2aUSEIzvLvqDLXco7pjzqXwX+0IopUiBTcYm+mWyQqLiRxOO1r7qfQjeVZgMcT+8/PB2NrgX7+27kniJBxX6iFlfr0e5VzO7fN5gtvRrLEln/InlplbwIDAQAB';

export function officialExtensionKey(flag = ''): string | undefined {
  if (flag === '' || flag === '0') return undefined;
  if (flag !== '1') throw new Error('Unsupported official extension identity setting');
  const der = Buffer.from(OFFICIAL_EXTENSION_PUBLIC_KEY, 'base64');
  createPublicKey({ key: der, format: 'der', type: 'spki' });
  const id = createHash('sha256').update(der).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
  if (id !== OFFICIAL_EXTENSION_ID) throw new Error('Official extension identity mismatch');
  return OFFICIAL_EXTENSION_PUBLIC_KEY;
}
