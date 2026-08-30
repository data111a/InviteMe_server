/**
 * Cleaning and bounding incoming RSVP data.
 *
 * The guiding rule (from the plan): intake is FLEXIBLE about WHAT arrives - an
 * unexpected field is kept, never rejected - but STRICT about SIZE and SHAPE,
 * because the token that reaches this code is public.
 *
 * Nothing here trusts the sender. Values are cleaned; keys are bounded; the
 * whole thing is capped in count and length. We never run or evaluate anything
 * that arrives - it is only ever stored as data and shown as text.
 */
import type { FieldDef } from '../store/types';

export const INTAKE_LIMITS = {
  /** Hard ceiling on how many fields one answer may carry. */
  maxFields: 60,
  /** Longest a single field name may be. */
  maxKeyLength: 80,
  /** Longest a single text value may be. */
  maxValueLength: 2000,
  /** Longest a value inside an array may be (e.g. multi-select). */
  maxArrayItems: 50,
} as const;

/**
 * Keys that could poison JavaScript's object machinery if used as property
 * names. We refuse to store under these, no matter what is sent.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Control characters, written as hex escapes so the source stays plain ASCII:
 * \x00-\x08, \x0B, \x0C, \x0E-\x1F. This is every control char EXCEPT tab
 * (\x09), newline (\x0A) and carriage return (\x0D), which are legitimate.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

/** Remove control characters and trim. */
function cleanString(input: string): string {
  return input.replace(CONTROL_CHARS, '').trim().slice(0, INTAKE_LIMITS.maxValueLength);
}

/** A key we are willing to store under. Bounded, cleaned, never dangerous. */
function cleanKey(key: string): string | null {
  const cleaned = cleanString(key).slice(0, INTAKE_LIMITS.maxKeyLength);
  if (cleaned === '') return null;
  if (FORBIDDEN_KEYS.has(cleaned)) return null;
  return cleaned;
}

/**
 * Clean one value without throwing information away.
 *
 * Objects and deeply nested things are flattened to a JSON string rather than
 * stored raw - that keeps what the guest sent, visible in the dashboard, while
 * guaranteeing every stored value is a simple string/number/boolean/array.
 */
function cleanValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') return cleanString(value);
  if (typeof value === 'boolean') return value;

  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  if (Array.isArray(value)) {
    return value
      .slice(0, INTAKE_LIMITS.maxArrayItems)
      .map((item) => (typeof item === 'string' ? cleanString(item) : cleanValue(item)));
  }

  if (typeof value === 'object') {
    // Nested object: keep it as readable text rather than dropping it.
    try {
      return cleanString(JSON.stringify(value));
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Line one field up with its definition, so the dashboard can show tidy typed
 * columns - WITHOUT ever rejecting a value. A "yes" stays "yes"; a number field
 * that receives "two" keeps "two" (shown as-is) rather than being thrown away.
 */
function coerceToFieldType(value: unknown, field: FieldDef): unknown {
  switch (field.type) {
    case 'number': {
      if (typeof value === 'number') return value;
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
        return Number(value);
      }
      return value; // unparseable: preserve exactly what arrived
    }
    case 'yesno': {
      if (typeof value === 'string') {
        const v = value.trim().toLowerCase();
        if (['yes', 'y', 'true', '1'].includes(v)) return 'yes';
        if (['no', 'n', 'false', '0'].includes(v)) return 'no';
        if (['maybe', 'm'].includes(v)) return 'maybe';
      }
      if (value === true) return 'yes';
      if (value === false) return 'no';
      return value;
    }
    default:
      return value;
  }
}

export interface SanitizeResult {
  values: Record<string, unknown>;
  /** How many fields we kept, for the response and the rate context. */
  fieldCount: number;
}

/**
 * Turn a raw request body into the clean `values` object we store.
 *
 * @param body   whatever JSON arrived
 * @param schema the event's field definitions, used only to line up types
 */
export function sanitizeIntake(body: unknown, schema: FieldDef[]): SanitizeResult {
  const values: Record<string, unknown> = Object.create(null);

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { values: {}, fieldCount: 0 };
  }

  const byKey = new Map(schema.map((f) => [f.key, f] as const));
  let count = 0;

  for (const [rawKey, rawValue] of Object.entries(body)) {
    if (count >= INTAKE_LIMITS.maxFields) break;

    const key = cleanKey(rawKey);
    if (key === null) continue;

    let value = cleanValue(rawValue);

    const field = byKey.get(key);
    if (field) value = coerceToFieldType(value, field);

    values[key] = value;
    count += 1;
  }

  // Spread into a plain object so the null-prototype does not surprise anything
  // downstream (JSON.stringify, the store, etc.).
  return { values: { ...values }, fieldCount: count };
}
