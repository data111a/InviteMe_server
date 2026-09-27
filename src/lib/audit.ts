/**
 * Security audit trail.
 *
 * One JSON line per security-relevant event (sign-ins, sign-outs, token
 * rotations, deletions, blocked cross-site requests) written to the server log,
 * so incidents can be reconstructed later. Render keeps these in its log view.
 *
 * NEVER pass secrets here: no passwords, no tokens, no cookies, no intake tokens.
 */
export function audit(event: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), audit: event, ...details }));
}
