import { randomBytes } from 'node:crypto';

/** No l, I, 0, 1 - so an id read aloud or copied by eye is unambiguous. */
const ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';

/**
 * A short readable id, e.g. newId('e') -> "e_k4m2xp9wqd".
 * These are identifiers, not secrets - guessing one gains you nothing, because
 * every route still checks who you are and what you own.
 */
export function newId(prefix: string, length = 10): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `${prefix}_${out}`;
}

/**
 * An intake token. This one IS a secret - whoever holds it can post answers to
 * an event - so it uses the full 256 bits of randomness, not the pretty alphabet.
 */
export function newIntakeToken(): string {
  return `itk_${randomBytes(32).toString('base64url')}`;
}
