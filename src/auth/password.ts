/**
 * Password hashing.
 *
 * bcrypt turns a password into a one-way scramble. There is no "unhash" - even
 * with the database in hand, an attacker has to guess passwords one at a time,
 * and the cost factor below makes each guess deliberately slow.
 */
import bcrypt from 'bcryptjs';

/**
 * Cost factor. Each +1 doubles the work. 12 is the usual modern choice: a few
 * hundred milliseconds to check one password, which nobody notices at login and
 * which makes bulk guessing hopeless.
 */
export const BCRYPT_ROUNDS = 12;

/** Shortest password we will accept for any account. */
export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
