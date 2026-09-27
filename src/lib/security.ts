/**
 * Small, single-purpose security middleware.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { audit } from './audit';
import { forbidden } from './errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * API responses carry private data (answers, guest names, tokens). Tell every
 * browser and proxy never to store them - a shared or stolen machine must not
 * be able to pull a guest list out of its cache.
 */
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}

/** Switch off powerful browser features this app never uses. */
export function permissionsPolicy(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  );
  next();
}

/**
 * Only accept JSON bodies. A "simple" cross-site request (form post, or
 * fetch with text/plain) skips the CORS preflight entirely; insisting on
 * application/json both forces the preflight and stops empty junk submissions.
 */
export function requireJsonBody(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const type = req.headers['content-type'] ?? '';
  if (/^application\/json\b/i.test(type)) {
    next();
    return;
  }
  res.status(415).json({ ok: false, error: 'Content-Type must be application/json' });
}

function refererOrigin(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return 'null';
  }
}

/**
 * CSRF guard for the cookie-authenticated API.
 *
 * With SameSite=None (needed when the dashboard and API are on different
 * sites) the browser attaches the login cookie to requests started by ANY
 * site. CORS only protects *reading* responses and preflighted requests - a
 * plain form POST still goes through. So for every state-changing request we
 * check where it came from:
 *
 *   - Origin (or Referer) is an allowed dashboard origin, or this server itself -> ok
 *   - no Origin/Referer at all -> a non-browser client (curl, Postman, scripts),
 *     which cannot ride a victim's cookie -> ok
 *   - anything else, including the opaque "null" origin -> 403
 */
export function verifyOrigin(isAllowed: (origin: string) => boolean): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const source = req.get('origin') ?? refererOrigin(req.get('referer'));
    if (source === undefined) {
      next();
      return;
    }

    let sameHost = false;
    if (source !== 'null') {
      try {
        sameHost = new URL(source).host === req.get('host');
      } catch {
        sameHost = false;
      }
    }

    if (source !== 'null' && (sameHost || isAllowed(source))) {
      next();
      return;
    }

    audit('csrf.blocked', { method: req.method, path: req.path, origin: source, ip: req.ip });
    next(forbidden('Cross-site request blocked'));
  };
}
