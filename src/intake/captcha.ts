/**
 * Captcha check for incoming RSVPs - Cloudflare Turnstile.
 *
 * OFF unless TURNSTILE_SECRET is set. While off, the honeypot and the rate
 * limits carry the load. To switch it on:
 *   1. create a Turnstile widget at dash.cloudflare.com (free) for your
 *      invitation site's domain
 *   2. put its SECRET key in this server's environment as TURNSTILE_SECRET
 *   3. add the widget to the RSVP form and send its token as "captchaToken"
 *
 * When on, it FAILS CLOSED: a missing token, a bad token, or Cloudflare being
 * unreachable all mean the submission is refused.
 */
import { env } from '../env';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface CaptchaResult {
  ok: boolean;
}

/** Whether RSVPs currently need a captcha token. */
export const captchaEnabled = (): boolean => Boolean(env.TURNSTILE_SECRET);

/**
 * @param token whatever the invitation site sent as "captchaToken"
 * @param ip    the caller's IP, which Turnstile uses as an extra signal
 */
export async function verifyCaptcha(token: unknown, ip: string): Promise<CaptchaResult> {
  if (!env.TURNSTILE_SECRET) return { ok: true };

  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return { ok: false };
  }

  try {
    const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
    if (ip) form.set('remoteip', ip);

    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false };

    const data = (await res.json()) as { success?: unknown };
    return { ok: data.success === true };
  } catch {
    return { ok: false };
  }
}
