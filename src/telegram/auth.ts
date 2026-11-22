import { parseAllowedUserIds } from '../config/env';

/**
 * Constant-time comparison of two secret strings using SHA-256 digests
 * so neither content nor length leaks through timing.
 */
export async function verifySecretToken(
  provided: string | undefined,
  expected: string | undefined,
): Promise<boolean> {
  if (!provided || !expected) return false;

  const encoder = new TextEncoder();
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);

  const bytesA = new Uint8Array(hashA);
  const bytesB = new Uint8Array(hashB);

  let diff = 0;
  for (let i = 0; i < bytesA.length; i += 1) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}

export function isUserAllowed(
  userId: number | undefined,
  allowedRaw: string | undefined,
): boolean {
  if (!userId) return false;
  const allowed = parseAllowedUserIds(allowedRaw);
  return allowed.has(userId);
}
