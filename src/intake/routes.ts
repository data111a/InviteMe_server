/**
 * The intake endpoint - where RSVPs from your invitation site land.
 *
 *   POST /api/intake/:intakeToken
 *
 * This is the ONE endpoint an anonymous stranger can reach, because the token
 * sits in your invitation site's public page. So it is built defensively. The
 * order of the checks below matters and is deliberate:
 *
 *   1. rate limit per IP        - stop one machine flooding us
 *   2. honeypot                 - silently swallow obvious bots
 *   3. find the event by token  - generic reject if unknown/rotated
 *   4. rate limit per token     - stop one event being flooded
 *   5. captcha hook             - a stub today (see captcha.ts)
 *   6. sanitize + store         - flexible about content, strict about size
 *
 * "Flexible" means: whatever fields arrive are kept, even ones not in the
 * event's form. Nothing is ever rejected for being unexpected. The only reasons
 * to reject are size, rate, a bad token, or a failed captcha.
 */
import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import { createAnswer, getEventByToken } from '../store';
import { INTAKE_LIMITS, sanitizeIntake } from '../lib/sanitize';
import { verifyCaptcha } from './captcha';

export const intakeRouter = Router();

/**
 * The name of the invisible "honeypot" field. Your real form must NOT include
 * a field with this name. Bots fill in every field they see, so anything that
 * arrives here is a bot - we reply "success" and quietly bin it, so the bot
 * never learns it was caught.
 */
const HONEYPOT_FIELD = '_hp_website';

/** Per-IP: caps one machine regardless of which event it targets. */
const perIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  message: { ok: false, error: 'Too many requests' },
});

/** Per-token: caps how fast a single event can receive answers. */
const perTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `tok:${String(req.params.intakeToken ?? '')}`,
  message: { ok: false, error: 'Too many requests' },
});

/** One bland reply for every rejection, so probing reveals nothing. */
const GENERIC_REJECT = { ok: false, error: 'Could not accept submission' };

intakeRouter.post('/:intakeToken', perIpLimiter, async (req, res, next) => {
  try {
    const body: unknown = req.body;

    // --- honeypot: pretend success, store nothing ---
    if (
      typeof body === 'object' &&
      body !== null &&
      typeof (body as Record<string, unknown>)[HONEYPOT_FIELD] === 'string' &&
      ((body as Record<string, unknown>)[HONEYPOT_FIELD] as string).trim() !== ''
    ) {
      res.status(202).json({ ok: true });
      return;
    }

    // --- the token must match a real event ---
    // Express types a route param as string | string[]; coerce to a plain string.
    const token = String(req.params.intakeToken ?? '');
    const event = await getEventByToken(token);
    if (!event) {
      // Same generic reply whether the token is nonsense or was just rotated.
      res.status(400).json(GENERIC_REJECT);
      return;
    }

    // --- per-token rate limit (only worth doing for a valid token) ---
    perTokenLimiter(req, res, async (limiterErr?: unknown) => {
      if (limiterErr) {
        next(limiterErr);
        return;
      }

      try {
        // --- captcha hook (stub passes today) ---
        const captchaToken =
          typeof body === 'object' && body !== null
            ? (body as Record<string, unknown>).captchaToken
            : undefined;
        const captcha = await verifyCaptcha(captchaToken, req.ip ?? '');
        if (!captcha.ok) {
          res.status(400).json(GENERIC_REJECT);
          return;
        }

        // --- sanitize + store (flexible about content) ---
        const { values, fieldCount } = sanitizeIntake(body, event.fieldSchema);

        // The honeypot and captcha fields are plumbing, not answers.
        delete values[HONEYPOT_FIELD];
        delete values.captchaToken;

        const answer = await createAnswer(event.id, values);

        res.status(201).json({ ok: true, id: answer.id, stored: fieldCount });
      } catch (err) {
        next(err);
      }
    });
  } catch (err) {
    next(err);
  }
});

export { HONEYPOT_FIELD, INTAKE_LIMITS };
