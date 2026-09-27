/**
 * The intake endpoint - where RSVPs from your invitation site land.
 *
 *   POST /api/intake/:intakeToken      (Content-Type: application/json only)
 *
 * This is the ONE endpoint an anonymous stranger can reach, because the token
 * sits in your invitation site's public page. So it is built defensively, and
 * the order of the checks below is deliberate - cheapest first, database last:
 *
 *   1. rate limit per IP          - stop one machine flooding us
 *   2. body must be a JSON object  - (the JSON-only rule is enforced in app.ts)
 *   3. honeypot                    - silently swallow obvious bots
 *   4. token must LOOK valid       - junk never reaches the database
 *   5. find the event by token     - generic reject if unknown/rotated
 *   6. rate limit per token        - stop one event being flooded
 *   7. captcha                     - Cloudflare Turnstile, when configured
 *   8. sanitize, refuse empties    - flexible about content, strict about size
 *   9. per-event storage cap       - a leaked token cannot fill the database
 *
 * "Flexible" means: whatever fields arrive are kept, even ones not in the
 * event's form. The only reasons to reject are shape, size, rate, a bad token,
 * a failed captcha, an empty submission or a full event.
 */
import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import { env } from '../env';
import { countAnswers, createAnswer, getEventByToken } from '../store';
import { INTAKE_LIMITS, sanitizeIntake } from '../lib/sanitize';
import { isIntakeToken, isPlainObject } from '../lib/validate';
import { audit } from '../lib/audit';
import { verifyCaptcha } from './captcha';

export const intakeRouter = Router();

/**
 * The name of the invisible "honeypot" field. Your real form must NOT include
 * a field with this name. Bots fill in every field they see, so anything that
 * arrives here is a bot - we reply "success" and quietly bin it.
 */
const HONEYPOT_FIELD = '_hp_website';
/** Where the invitation site puts the Turnstile token. Plumbing, not an answer. */
const CAPTCHA_FIELD = 'captchaToken';

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
    if (!isPlainObject(body)) {
      res.status(400).json(GENERIC_REJECT);
      return;
    }

    // --- honeypot: pretend success, store nothing ---
    const honeypot = body[HONEYPOT_FIELD];
    if (typeof honeypot === 'string' && honeypot.trim() !== '') {
      res.status(202).json({ ok: true });
      return;
    }

    // --- the token must look right before we ask the database about it ---
    const token = String(req.params.intakeToken ?? '');
    if (!isIntakeToken(token)) {
      res.status(400).json(GENERIC_REJECT);
      return;
    }

    const event = await getEventByToken(token);
    if (!event) {
      // Same generic reply whether the token is nonsense or was just rotated.
      res.status(400).json(GENERIC_REJECT);
      return;
    }

    // --- per-token rate limit (only worth doing for a real token) ---
    perTokenLimiter(req, res, async (limiterErr?: unknown) => {
      if (limiterErr) {
        next(limiterErr);
        return;
      }

      try {
        const captcha = await verifyCaptcha(body[CAPTCHA_FIELD], req.ip ?? '');
        if (!captcha.ok) {
          audit('intake.captcha_failed', { eventId: event.id, ip: req.ip });
          res.status(400).json(GENERIC_REJECT);
          return;
        }

        // Strip the plumbing BEFORE sanitising, so it neither counts toward
        // the field limit nor gets stored as an "answer".
        const { [HONEYPOT_FIELD]: _hp, [CAPTCHA_FIELD]: _captcha, ...answerFields } = body;
        const { values, fieldCount } = sanitizeIntake(answerFields, event.fieldSchema);

        if (fieldCount === 0) {
          res.status(400).json(GENERIC_REJECT);
          return;
        }

        if ((await countAnswers(event.id)) >= env.MAX_ANSWERS_PER_EVENT) {
          audit('intake.event_full', { eventId: event.id, limit: env.MAX_ANSWERS_PER_EVENT });
          res.status(400).json(GENERIC_REJECT);
          return;
        }

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
