/**
 * Password hashing and password policy.
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

/**
 * bcrypt only reads the first 72 BYTES of a password and silently ignores the
 * rest - "…72 chars…X" and "…72 chars…Y" would be the same password. Rather
 * than let a long password be weaker than it looks, we refuse it.
 */
export const MAX_PASSWORD_BYTES = 72;

/**
 * The most-guessed passwords that still clear the length rule. Credential
 * stuffing tries these first; refusing them costs nothing.
 */
const COMMON_PASSWORDS = new Set([
  '1234567890', '0123456789', '0987654321', '1111111111', '1234512345',
  'qwertyuiop', 'qwerty1234', 'qwerty12345', 'qwerty123456', '1q2w3e4r5t',
  '1qaz2wsx3edc', 'asdfghjkl1', 'zxcvbnm123', 'password12', 'password123',
  'password1234', 'password1!', 'passw0rd123', 'p@ssw0rd123', 'iloveyou12',
  'letmein123', 'welcome123', 'changeme123', 'administrator', 'admin12345',
  'admin123456', 'test123456', 'football123', 'sunshine123', 'princess123',
]);

/**
 * Why a new password is unacceptable, or null if it is fine. Follows NIST
 * 800-63B: length over composition rules, plus a ban on the obvious.
 */
export function passwordProblem(password: string, username?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return `must be at most ${MAX_PASSWORD_BYTES} bytes (bcrypt ignores anything longer)`;
  }
  if (new Set(password).size < 4) {
    return 'is too repetitive';
  }
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return 'is too common - pick something less guessable';
  }
  if (username && username.trim().length >= 3 && lower.includes(username.trim().toLowerCase())) {
    return 'must not contain the username';
  }
  return null;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
