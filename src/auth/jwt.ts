/**
 * The login token, and the cookie that carries it.
 *
 * A JWT ("JSON Web Token") is a short string the server signs. Anyone can read
 * what is inside it, but nobody can change it without the signing secret - so
 * we can hand it to a browser and still trust it when it comes back.
 *
 * Deliberate choice: the token contains the USER ID AND NOTHING ELSE. Not the
 * role, not the event. Those are looked up fresh from the store on every single
 * request (see middleware.ts), which means:
 *   - demoting or deleting an account takes effect immediately
 *   - a stolen token can never be edited to claim "role: admin"
 */
import jwt from 'jsonwebtoken';
import type { CookieOptions, Response } from 'express';

import { env } from '../env';

export const COOKIE_NAME = 'sid';

export function signToken(userId: string): { token: string; expiresAt: Date } {
  const token = jwt.sign({}, env.JWT_SECRET, {
    subject: userId,
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });

  const decoded = jwt.decode(token) as { exp?: number } | null;
  const expiresAt = new Date((decoded?.exp ?? 0) * 1000);

  return { token, expiresAt };
}

/** Returns the user id, or null for anything expired, tampered with or absent. */
export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload === 'string') return null;
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}

function cookieOptions(expiresAt?: Date): CookieOptions {
  return {
    // httpOnly: JavaScript in the page cannot read this cookie. If a script
    // ever gets injected into the dashboard, it still cannot steal the session.
    httpOnly: true,

    // secure: only send over HTTPS. Off in development (localhost is plain
    // http), on in production. Required for sameSite:'none' below.
    secure: env.isProduction,

    // SameSite decides whether the cookie rides along on cross-site requests:
    //   dev  -> 'lax'  the dashboard and API are same-origin (Vite proxy), and
    //                  Lax also blocks the classic cross-site CSRF request.
    //   prod -> 'none' so the cookie is sent when the dashboard and API live on
    //                  DIFFERENT origins (e.g. a static dashboard calling this
    //                  API on Render). 'none' requires Secure (set above).
    //
    // With 'none' the cookie IS sent cross-site, so CSRF protection now rests on
    // CORS: DASHBOARD_ORIGIN MUST be your real dashboard origin, NOT '*'. State-
    // changing calls are JSON (preflighted), so a hostile origin is turned away.
    sameSite: env.isProduction ? 'none' : 'lax',

    path: '/',
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}

export function setLoginCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(COOKIE_NAME, token, cookieOptions(expiresAt));
}

export function clearLoginCookie(res: Response): void {
  // Must match the options the cookie was set with, or the browser keeps it.
  res.clearCookie(COOKIE_NAME, cookieOptions());
}
