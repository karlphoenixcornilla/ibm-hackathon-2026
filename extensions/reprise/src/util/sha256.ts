// util/sha256.ts — SHA-256 via crypto.subtle (browser/web worker safe)

/**
 * Compute the SHA-256 hex digest of the given bytes.
 * Uses crypto.subtle.digest which is available in secure contexts and web workers.
 */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute the SHA-256 hex digest of a UTF-8 string.
 */
export async function sha256String(text: string): Promise<string> {
  return sha256(new TextEncoder().encode(text));
}
