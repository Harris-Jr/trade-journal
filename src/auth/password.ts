/**
 * Password hashing and token generation using only Node built-ins (no deps).
 * Passwords are hashed with scrypt + a per-password random salt; the stored
 * format is `scrypt$<N>$<saltHex>$<hashHex>`. Verification is constant-time.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384; // scrypt cost
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N });
  return `scrypt$${N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const salt = Buffer.from(parts[2]!, 'hex');
  const expected = Buffer.from(parts[3]!, 'hex');
  if (!Number.isFinite(n) || salt.length === 0 || expected.length === 0) return false;
  let actual: Buffer;
  try {
    actual = scryptSync(password, salt, expected.length, { N: n });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** URL-safe opaque session token with high entropy. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}
