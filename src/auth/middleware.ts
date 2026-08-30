/**
 * The guards that sit in front of protected routes.
 *
 * The core rule of this app lives here: WHO YOU ARE AND WHAT YOU OWN IS READ
 * FROM THE STORE, NEVER FROM THE BROWSER. The cookie only says "this is user
 * u_abc". Everything else - admin or client, and which event a client may see -
 * is looked up server-side on every request.
 */
import type { NextFunction, Request, Response } from 'express';

import { getUserById } from '../store';
import { forbidden, unauthorized } from '../lib/errors';
import { COOKIE_NAME, verifyToken } from './jwt';

/** Signed in as anybody. Attaches the fresh user record to req.user. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token: unknown = req.cookies?.[COOKIE_NAME];
    if (typeof token !== 'string' || token.length === 0) {
      next(unauthorized());
      return;
    }

    const userId = verifyToken(token);
    if (!userId) {
      next(unauthorized());
      return;
    }

    // Re-read every time. If the account was deleted a second ago, the session
    // dies now rather than lingering until the token expires.
    const user = await getUserById(userId);
    if (!user) {
      next(unauthorized());
      return;
    }

    req.user = user;
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
