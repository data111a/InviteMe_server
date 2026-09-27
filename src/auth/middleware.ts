/**
 * The guards that sit in front of protected routes.
 *
 * The core rule of this app lives here: WHO YOU ARE AND WHAT YOU OWN IS READ
 * FROM THE STORE, NEVER FROM THE BROWSER. The cookie only says "this is user
 * u_abc". Everything else - admin or client, and which event a client may see -
 * is looked up server-side on every request.
 */
import type { NextFunction, Request, Response } from 'express';

import { getUserById, isTokenRevoked } from '../store';
import { forbidden, unauthorized } from '../lib/errors';
import { readSessionToken, verifyToken } from './jwt';

/**
 * Signed in as anybody. Attaches the fresh user record to req.user.
 *
 * A token is accepted only if ALL of these hold:
 *   - its signature, algorithm, issuer, audience and expiry check out
 *   - the account still exists (deleted = signed out, immediately)
 *   - its session version matches the account's (password changed = signed out)
 *   - it has not been signed out explicitly (revocation list)
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = readSessionToken(req);
    if (!token) {
      next(unauthorized());
      return;
    }

    const claims = verifyToken(token);
    if (!claims) {
      next(unauthorized());
      return;
    }

    const [user, revoked] = await Promise.all([
      getUserById(claims.userId),
      isTokenRevoked(claims.jti),
    ]);

    if (!user || revoked || (user.tokenVersion ?? 0) !== claims.version) {
      next(unauthorized());
      return;
    }

    req.user = user;
    req.auth = claims;
    next();
  } catch (err) {
    next(err);
  }
}

/** Signed in as the admin. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    if (req.user?.role !== 'admin') {
      next(forbidden());
      return;
    }
    next();
  });
}

/** Signed in as a client, and that client actually has an event attached. */
export async function requireClient(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    if (req.user?.role !== 'client' || !req.user.eventId) {
      next(forbidden());
      return;
    }
    next();
  });
}
