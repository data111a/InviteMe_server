/**
 * Turning stored answers into the three things the dashboard needs:
 *
 *   - a VIEW:    rows lined up under the event's defined columns, plus a list
 *                of any "extra" fields that arrived outside the schema
 *   - a SUMMARY: counts appropriate to each field's type
 *   - a CSV:     defined columns + extras, safely escaped (see csv.ts)
 *
 * All three live here, and both the admin routes (Phase 6) and the read-only
 * client routes (Phase 7) call them - so the two dashboards can never drift
 * apart or disagree about the numbers.
 */
import type { Answer, EventRecord, FieldDef } from '../store/types';
import { toCsv } from './csv';

// --- discovering extra fields ----------------------------------------------

/**
 * Every key that appears in the answers but is NOT one of the event's defined
 * fields. These are the "extra data" - things the invitation site sent that we
 * never asked for, kept anyway.
 */
export function extraKeys(event: EventRecord, answers: Answer[]): string[] {
  const defined = new Set(event.fieldSchema.map((f) => f.key));
  const extras = new Set<string>();

  for (const answer of answers) {
    for (const key of Object.keys(answer.values)) {
      if (!defined.has(key)) extras.add(key);
    }
  }

  return [...extras].sort();
}

// --- the summary ------------------------------------------------------------

export type FieldSummary =
  | { key: string; label: string; type: 'text'; answered: number }
  | {
      key: string;
      label: string;
      type: 'yesno';
      yes: number;
      no: number;
      maybe: number;
      other: number;
    }
  | {
      key: string;
      label: string;
      type: 'number';
      count: number;
      sum: number;
      average: number | null;
    }
  | {
      key: string;
      label: string;
      type: 'dropdown';
      counts: { option: string; count: number }[];
      other: number;
    };

export interface AnswersSummary {
  total: number;
  fields: FieldSummary[];
}

function summariseField(field: FieldDef, answers: Answer[]): FieldSummary {
  const values = answers.map((a) => a.values[field.key]);

  switch (field.type) {
    case 'yesno': {
      let yes = 0;
      let no = 0;
      let maybe = 0;
      let other = 0;
      for (const v of values) {
        if (v === 'yes') yes += 1;
        else if (v === 'no') no += 1;
        else if (v === 'maybe') maybe += 1;
        else if (v !== null && v !== undefined && v !== '') other += 1;
      }
      return { key: field.key, label: field.label, type: 'yesno', yes, no, maybe, other };
    }

    case 'number': {
      const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      const sum = nums.reduce((a, b) => a + b, 0);
      return {
        key: field.key,
        label: field.label,
        type: 'number',
        count: nums.length,
        sum,
        average: nums.length > 0 ? sum / nums.length : null,
      };
    }

    case 'dropdown': {
      const options = field.options ?? [];
      const tally = new Map<string, number>(options.map((o) => [o, 0]));
      let other = 0;
      for (const v of values) {
        if (typeof v === 'string' && tally.has(v)) {
          tally.set(v, (tally.get(v) ?? 0) + 1);
        } else if (v !== null && v !== undefined && v !== '') {
          other += 1;
        }
      }
      return {
        key: field.key,
        label: field.label,
        type: 'dropdown',
        counts: options.map((option) => ({ option, count: tally.get(option) ?? 0 })),
        other,
      };
    }

    default: {
      const answered = values.filter((v) => v !== null && v !== undefined && v !== '').length;
      return { key: field.key, label: field.label, type: 'text', answered };
    }
  }
}

export function buildSummary(event: EventRecord, answers: Answer[]): AnswersSummary {
  return {
    total: answers.length,
    fields: event.fieldSchema.map((field) => summariseField(field, answers)),
  };
}

// --- the CSV ----------------------------------------------------------------

/**
 * Columns are: submitted time, every defined field (by label), then every
 * extra key discovered. So the export never loses a value, defined or not.
 */
export function buildCsv(event: EventRecord, answers: Answer[]): string {
  const extras = extraKeys(event, answers);

  const header = [
    'Submitted at',
    ...event.fieldSchema.map((f) => f.label),
    ...extras.map((k) => `${k} (extra)`),
  ];

  const rows: unknown[][] = answers.map((answer) => [
    answer.submittedAt,
    ...event.fieldSchema.map((f) => answer.values[f.key] ?? ''),
    ...extras.map((k) => answer.values[k] ?? ''),
  ]);

  return toCsv([header, ...rows]);
}

/** A filename like "nino-giorgi-wedding-answers.csv". */
export function csvFilename(event: EventRecord): string {
  const slug =
    event.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'event';
  return `${slug}-answers.csv`;
}

// --- the view (for the on-screen table) ------------------------------------

export interface AnswersView {
  fields: FieldDef[];
  extraKeys: string[];
  answers: { id: string; submittedAt: string; values: Record<string, unknown> }[];
}

export function buildView(event: EventRecord, answers: Answer[]): AnswersView {
  return {
    fields: event.fieldSchema,
    extraKeys: extraKeys(event, answers),
    answers: answers.map((a) => ({ id: a.id, submittedAt: a.submittedAt, values: a.values })),
  };
}
