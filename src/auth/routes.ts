/**
 * Sign in, sign out, and "who am I".
 *
 * The rules enforced here matter more than the code:
 *
 *   1. ONE ERROR MESSAGE. A wrong password, an unknown username and a malformed
 *      request all return exactly "Invalid credentials". This endpoint must
 *      never reveal which usernames exist.
 *
 *   2. CONSTANT TIME. If the username does not exist we still run a bcrypt
 *      comparison against a decoy hash, so response time reveals nothing.
 *
 *   3. THROTTLED TWO WAYS. Per IP (one machine guessing) AND per account (a
 *      botnet guessing one account from thousands of IPs). Only failures count.
 *
 *   4. SIGNING OUT MEANS IT. Logout revokes the token server-side, so a copied
 *      cookie stops working too - not just the one in this browser.
 */
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { getUserById, getUserByUsername, revokeToken, toPublicUser } from '../store';
import { unauthorized } from '../lib/errors';
import { audit } from '../lib/audit';
import { verifyPassword } from './password';
import { clearLoginCookie, readSessionToken, setLoginCookie, signToken, verifyToken } from './jwt';
import { requireAuth } from './middleware';

export const authRouter = Router();

/**
 * A real bcrypt hash of a random string nobody knows. Used only to burn the
 * same time when the username does not exist. Not a secret, not a password.
 */
const DECOY_HASH = '$2b$12$CmlHjX47rg6yPXUc4fnJ2evwLLbtFdYPXZTDNgtQAILiAUzTWc3Z2';

const TOO_MANY = { error: 'Too many attempts. Try again later.' };

/** Per IP: 5 failed attempts per 15 minutes. */
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: TOO_MANY,
});

/** The account an attempt is aimed at, normalised the same way lookups are. */
function accountKey(req: Request): string {
  const username: unknown = (req.body as { username?: unknown } | undefined)?.username;
  return typeof username === 'string' ? username.trim().toLowerCase().slice(0, 100) : '(none)';
}

/**
 * Per account: 10 failed attempts per 15 minutes, whatever the source IP.
 * Stops distributed guessing against one known username such as "admin".
 */
const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `acct:${accountKey(req)}`,
  message: TOO_MANY,
});

const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});

authRouter.post('/login', loginIpLimiter, loginAccountLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);

    // Even a malformed body gets the generic message, not a validation report.
    if (!parsed.success) {
      next(unauthorized('Invalid credentials'));
      return;
    }

    const { username, password } = parsed.data;
    const user = await getUserByUsername(username);

    const passwordOk = await verifyPassword(password, user?.passwordHash ?? DECOY_HASH);

    if (!user || !passwordOk) {
      audit('auth.login_failed', { username: username.slice(0, 60), ip: req.ip });
      next(unauthorized('Invalid credentials'));
      return;
    }

    const { token, expiresAt } = signToken(user);
    setLoginCookie(res, token, expiresAt);
    audit('auth.login', { userId: user.id, role: user.role, ip: req.ip });

    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', async (req, res) => {
  const token = readSessionToken(req);
  const claims = token ? verifyToken(token) : null;

  if (claims) {
    try {
      await revokeToken(claims.jti, claims.expiresAt);
      audit('auth.logout', { userId: claims.userId, ip: req.ip });
    } catch (err) {
      // The cookie is cleared regardless; log so a failed revocation is visible.
      console.error('[logout] could not record the revocation:', err instanceof Error ? err.message : err);
    }
  }

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
