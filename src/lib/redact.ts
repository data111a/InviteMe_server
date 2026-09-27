/**
 * Strip credentials out of text before it is logged or printed.
 *
 * Driver errors can echo a connection string; "mongodb+srv://user:PASSWORD@host"
 * must never land in a log file or a terminal screenshot.
 */
const URI_CREDENTIALS = /(mongodb(?:\+srv)?:\/\/)[^@/\s]+@/gi;

export function redactSecrets(text: string): string {
  return text.replace(URI_CREDENTIALS, '$1***:***@');
}
