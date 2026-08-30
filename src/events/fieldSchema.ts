/**
 * The rules for an event's custom form.
 *
 * A "field" is one question on the RSVP form. The admin types a label; the KEY
 * is generated from it. The key is the name your invitation site actually sends
 * ("Preferred song" -> preferred_song), so it has to be stable, unique within
 * the event, and safe to put in JSON and a CSV header.
 */
import { z } from 'zod';

import { badRequest } from '../lib/errors';
import { FIELD_TYPES, type FieldDef } from '../store/types';

export const MAX_FIELDS = 40;
export const MAX_OPTIONS = 50;
export const MAX_LABEL_LENGTH = 80;
export const MAX_KEY_LENGTH = 40;

/**
 * "Preferred song" -> "preferred_song".
 *
 * Accented letters are folded to plain ones (é -> e). Alphabets with no Latin
 * equivalent - Georgian, for example - leave nothing behind, and the caller
 * falls back to field_1, field_2... The admin can always type their own key.
 */
export function keyFromLabel(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_KEY_LENGTH);
}

const fieldInput = z.object({
  label: z.string().trim().min(1).max(MAX_LABEL_LENGTH),
  key: z
    .string()
    .trim()
    .max(MAX_KEY_LENGTH)
    .regex(/^[a-z0-9_]*$/, 'a key may only use lowercase letters, numbers and underscores')
    .optional(),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(MAX_LABEL_LENGTH)).max(MAX_OPTIONS).optional(),
});

export const fieldSchemaInput = z.array(fieldInput).max(MAX_FIELDS);

export type FieldInput = z.infer<typeof fieldInput>;

/**
 * Turns what the browser sent into the exact shape we store: keys filled in,
 * made unique, dropdown options cleaned, and options dropped from field types
 * that cannot have them.
 */
export function normalizeFieldSchema(input: FieldInput[]): FieldDef[] {
  const used = new Set<string>();
  const out: FieldDef[] = [];

  input.forEach((field, index) => {
    // --- the key ---
    let key = field.key?.trim() || keyFromLabel(field.label);
    if (!key) key = `field_${index + 1}`;

    // Two fields called "Name" would collide; the second becomes name_2.
    if (used.has(key)) {
      let n = 2;
      while (used.has(`${key}_${n}`)) n += 1;
      key = `${key}_${n}`;
    }
    used.add(key);

    // --- the options ---
    let options: string[] | undefined;
    if (field.type === 'dropdown') {
      const cleaned = [...new Set((field.options ?? []).map((o) => o.trim()).filter(Boolean))];
      if (cleaned.length === 0) {
        throw badRequest(`"${field.label}" is a dropdown, so it needs at least one option`);
      }
      options = cleaned;
    }
    // text / yesno / number never carry options, whatever was sent.

    out.push({
      key,
      label: field.label.trim(),
      type: field.type,
      required: field.required ?? false,
      ...(options ? { options } : {}),
    });
  });

  return out;
}
