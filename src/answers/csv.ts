/**
 * Building CSV text safely.
 *
 * Two separate dangers are handled here:
 *
 *   1. CSV FORMAT: a value containing a comma, a quote or a newline has to be
 *      wrapped in quotes (and its own quotes doubled), or it would break the
 *      columns when opened.
 *
 *   2. CSV INJECTION: a value that starts with = + - or @ is treated by Excel
 *      and Google Sheets as a FORMULA, not text. A malicious RSVP of
 *      "=cmd|..." could then run when the admin opens the file. We defuse this
 *      by prefixing such a value with a single quote, which spreadsheets read
 *      as "this is text".
 */

/** Values starting with one of these are formula triggers in spreadsheets. */
const FORMULA_STARTERS = new Set(['=', '+', '-', '@', '\t', '\r']);

function defuseFormula(text: string): string {
  const first = text.charAt(0);
  return FORMULA_STARTERS.has(first) ? `'${text}` : text;
}

/** Turn any stored value into one safe CSV cell. */
export function csvCell(value: unknown): string {
  let text: string;

  if (value === null || value === undefined) {
    text = '';
  } else if (Array.isArray(value)) {
    text = value.map((v) => String(v)).join('; ');
  } else if (typeof value === 'object') {
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }

  text = defuseFormula(text);

  // Quote if the cell contains anything that would confuse the columns.
  if (/[",\r\n]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

/** Join rows of already-computed cells into a CSV document. */
export function toCsv(rows: unknown[][]): string {
  // \r\n line endings are what spreadsheets expect. A leading BOM makes Excel
  // read it as UTF-8, so accented and Georgian text survives.
  const body = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  return `﻿${body}\r\n`;
}
