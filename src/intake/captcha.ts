/**
 * Captcha check - a placeholder, on purpose.
 *
 * A "captcha" is the "prove you're human" challenge (Cloudflare Turnstile,
 * hCaptcha, reCAPTCHA...). We are NOT adding one now, but the intake endpoint
 * already calls this function, so turning it on later is a change to THIS FILE
 * ALONE - no route edits.
 *
 * Today it always passes. To switch it on:
 *   1. pick a provider and put its secret in .env (e.g. TURNSTILE_SECRET)
 *   2. have the invitation site include the provider's token in the RSVP,
 *      e.g. as "captchaToken"
 *   3. below, read that token and verify it with the provider's API
 */

export interface CaptchaResult {
  ok: boolean;
}

/**
 * @param _token whatever the invitation site sent as its captcha token (unused today)
 * @param _ip    the caller's IP, which most providers want alongside the token
 */
export async function verifyCaptcha(_token: unknown, _ip: string): Promise<CaptchaResult> {
  // No captcha configured: allow everything. The honeypot and the rate limits
  // in routes.ts are what carry the load until a real captcha is switched on.
  return { ok: true };
}
