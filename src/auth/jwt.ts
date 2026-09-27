/**
 * The login token, and the cookie that carries it.
 *
 * A JWT is a short string the server signs. Anyone can read what is inside it,
 * but nobody can change it without the signing secret - so we can hand it to a
 * browser and still trust it when it comes back.
 *
 * What the token carries - and why it carries nothing else:
 *   sub  the user id. Role and event are looked up fresh on every request
 *        (middleware.ts), so a token can never be edited to claim "admin".
 *   ver  the user's session version. Changing a password bumps it, which kills
 *        every session that user has - even ones on a stolen laptop.
 *   jti  a unique id for THIS login, so signing out can revoke exactly it.
 *   iss/aud  who minted it and who it is for, so a token signed for some other
 *        purpose with the same secret is never accepted here.
 *
 * The algorithm is pinned to HS256 on both sides. Never let the token itself
 * choose how it is verified.
 */
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { CookieOptions, Request, Response } from 'express';

import { env } from '../env';
import type { User } from '../store/types';

const ALGORITHM = 'HS256' as const;
const ISSUER = 'inviteme-server';
const AUDIENCE = 'inviteme-dashboard';

/**
 * In production the cookie uses the "__Host-" prefix: the browser then refuses
 * it unless it is Secure, has Path=/ and names no Domain - so no other site or
 * subdomain can plant or overwrite it. Plain-http development cannot satisfy
 * those rules, so it keeps the plain name.
 */
export const COOKIE_NAME = env.cookieSecure ? '__Host-sid' : 'sid';

export interface SessionClaims {
  userId: string;
  version: number;
  jti: string;
  expiresAt: Date;
}

export function signToken(user: Pick<User, 'id' | 'tokenVersion'>): {
  token: string;
  expiresAt: Date;
} {
  const token = jwt.sign({ ver: user.tokenVersion ?? 0 }, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    subject: user.id,
    issuer: ISSUER,
    audience: AUDIENCE,
    jwtid: randomUUID(),
    expiresIn: env.jwtTtlSeconds,
  });

  const decoded = jwt.decode(token) as { exp?: number } | null;
  return { token, expiresAt: new Date((decoded?.exp ?? 0) * 1000) };
}

/** The verified claims, or null for anything expired, tampered with, foreign or absent. */
export function verifyToken(token: string): SessionClaims | null {
  if (token.length > 2048) return null;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload === 'string') return null;

    const { sub, jti, exp, ver } = payload as jwt.JwtPayload & { ver?: unknown };
    if (typeof sub !== 'string' || sub.length === 0) return null;
    if (typeof jti !== 'string' || jti.length === 0) return null;
    if (typeof exp !== 'number') return null;
    if (typeof ver !== 'number' || !Number.isInteger(ver) || ver < 0) return null;

    return { userId: sub, version: ver, jti, expiresAt: new Date(exp * 1000) };
  } catch {
    return null;
  }
}

/** The raw session token from the request's cookie, if any. */
export function readSessionToken(req: Request): string | null {
  const token: unknown = req.cookies?.[COOKIE_NAME];
  return typeof token === 'string' && token.length > 0 ? token : null;
}

function cookieOptions(expiresAt?: Date): CookieOptions {
  const crossSite = env.cookieSameSite === 'none';
  return {
    // JavaScript in the page cannot read this cookie. If a script ever gets
    // injected into the dashboard, it still cannot steal the session.
    httpOnly: true,

    // Only sent over HTTPS. Required in production and for SameSite=None.
    secure: env.cookieSecure,

    // lax  (dev, or a same-site production setup): not sent on cross-site
    //      requests - the strongest CSRF protection.
    // none (dashboard on a different site than the API): sent cross-site, so
    //      CSRF protection comes from the Origin check in lib/security.ts.
    sameSite: env.cookieSameSite,

    // CHIPS: a cross-site cookie that is "partitioned" to the dashboard's site
    // keeps working in browsers that restrict third-party cookies.
    partitioned: crossSite,

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
