/**
 * Format checks for identifiers that arrive in URLs.
 *
 * Every id the app mints has a fixed, boring shape (see ids.ts). Rejecting
 * anything else up front means a malformed or hostile value never reaches a
 * database query, and probing gets the same bland "not found" as a real miss.
 */

const EVENT_ID = /^e_[a-z0-9]{6,40}$/;
const ANSWER_ID = /^a_[a-z0-9]{6,40}$/;
/** "itk_" + base64url of 32 random bytes (43 chars); some slack for the future. */
const INTAKE_TOKEN = /^itk_[A-Za-z0-9_-]{20,100}$/;

export const isEventId = (v: unknown): v is string => typeof v === 'string' && EVENT_ID.test(v);
export const isAnswerId = (v: unknown): v is string => typeof v === 'string' && ANSWER_ID.test(v);
export const isIntakeToken = (v: unknown): v is string =>
  typeof v === 'string' && INTAKE_TOKEN.test(v);

/** A JSON object (not null, not an array) - the only body shape we accept. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
