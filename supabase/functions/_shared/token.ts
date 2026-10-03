/** Customer link tokens: 32 random bytes, base64url in the URL, HMAC(pepper) in the database. */

const TOKEN_BYTES = 32;

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function newToken(
  randomBytes: (length: number) => Uint8Array = (length) =>
    crypto.getRandomValues(new Uint8Array(length)),
): string {
  return base64Url(randomBytes(TOKEN_BYTES));
}

/** HMAC-SHA256(pepper, token) as hex: what the database stores instead of the token. */
export async function hashToken(token: string, pepper: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(token)));
  return Array.from(signature, (b) => b.toString(16).padStart(2, '0')).join('');
}
