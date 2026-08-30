/**
 * Turning a list of allowed-origin patterns into a fast matcher.
 *
 * Each pattern is one of:
 *   - an exact origin        "https://invites.inviteme.ge"  (matches only that)
 *   - a wildcard subdomain   "https://*.inviteme.ge"        (matches ANY subdomain)
 *
 * A wildcard allows that scheme on any subdomain of the base, at any depth:
 * "https://*.inviteme.ge" allows invites.inviteme.ge, dashboard.inviteme.ge and
 * a.b.inviteme.ge. It deliberately does NOT allow:
 *   - the bare apex "inviteme.ge"      (list it explicitly if you want it)
 *   - look-alikes "evil-inviteme.ge"   (no dot boundary before the base)
 *   - suffix tricks "inviteme.ge.evil.com"
 * The leading dot on the base domain is what makes those safe.
 *
 * Matching is exact on scheme (http vs https) and case-insensitive on host.
 */
const WILDCARD = /^(https?):\/\/\*\.(.+)$/;

export interface OriginPattern {
  scheme: string;
  /** The base domain with a leading dot, e.g. ".inviteme.ge". */
  suffix: string;
}

export function makeOriginMatcher(patterns: readonly string[]): (origin: string) => boolean {
  const exact = new Set<string>();
  const wildcards: OriginPattern[] = [];

  for (const raw of patterns) {
    const pattern = raw.trim();
    if (pattern === '') continue;

    const m = WILDCARD.exec(pattern);
    if (m) {
      // A successful match always has both capture groups.
      wildcards.push({ scheme: m[1]!.toLowerCase(), suffix: `.${m[2]!.toLowerCase()}` });
    } else {
      exact.add(pattern);
    }
  }

  return (origin: string): boolean => {
    if (exact.has(origin)) return true;
    if (wildcards.length === 0) return false;

    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return false; // not a real origin (e.g. the string "null")
    }

    const scheme = url.protocol.replace(/:$/, '').toLowerCase();
    const host = url.hostname.toLowerCase();

    return wildcards.some((w) => w.scheme === scheme && host.endsWith(w.suffix));
  };
}
