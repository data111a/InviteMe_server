/**
 * Sign in, sign out, and "who am I".
 *
 * Three rules are enforced here, and they matter more than the code:
 *
 *   1. ONE ERROR MESSAGE. A wrong password, an unknown username and a malformed
 *      request all return exactly "Invalid credentials". An attacker must never
 *      be able to use this endpoint to discover which usernames exist.
 *
 *   2. CONSTANT TIME. If the username does not exist we still run a bcrypt
 *      comparison against a decoy hash. Without this, "unknown user" would come
 *      back in 1ms and "wrong password" in 500ms - and that difference alone
 *      tells an attacker which usernames are real.
 *
 *   3. THROTTLED. Five failed attempts per 15 minutes per IP address.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { getUserById, getUserByUsername, toPublicUser } from '../store';
import { unauthorized } from '../lib/errors';
import { verifyPassword } from './password';
import { clearLoginCookie, setLoginCookie, signToken } from './jwt';
import { requireAuth } from './middleware';

export const authRouter = Router();

/**
 * A real bcrypt hash of a random string nobody knows. Used only to burn the
 * same ~500ms when the username does not exist. Not a secret, not a password.
 */
const DECOY_HASH = '$2b$12$CmlHjX47rg6yPXUc4fnJ2evwLLbtFdYPXZTDNgtQAILiAUzTWc3Z2';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  // Only failures count. Signing in successfully ten times is not an attack.
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});

const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});

authRouter.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);

    // Note: even a malformed body gets the generic message, not a validation
    // report. There is nothing useful to tell an anonymous caller here.
    if (!parsed.success) {
      next(unauthorized('Invalid credentials'));
      return;
    }

    const { username, password } = parsed.data;
    const user = await getUserByUsername(username);

    const passwordOk = await verifyPassword(password, user?.passwordHash ?? DECOY_HASH);

    if (!user || !passwordOk) {
      next(unauthorized('Invalid credentials'));
      return;
    }

    const { token, expiresAt } = signToken(user.id);
    setLoginCookie(res, token, expiresAt);

    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', (_req, res) => {
  clearLoginCookie(res);
  // Always 200, even if you were not signed in. Nothing to reveal.
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    // requireAuth guarantees req.user, but re-reading keeps this honest if the
    // middleware ever changes.
    const user = req.user ? await getUserById(req.user.id) : null;
    if (!user) {
      next(unauthorized());
      return;
    }
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});
