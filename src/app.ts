/**
 * The Express application - every route and every security layer, but no
 * listening socket and no database connection (index.ts does both). Keeping
 * them apart means the whole app can be exercised in-process.
 *
 * The structural idea: there are TWO different worlds on this one server, and
 * they must not bleed into each other:
 *
 *   /api/intake/*   the public door. Reachable from your invitation site, which
 *                   is a DIFFERENT website. Cookie-less. JSON only. Tiny bodies.
 *
 *   everything else the private dashboard API. Reachable only from the listed
 *                   dashboard origins, only WITH the login cookie, and every
 *                   state-changing request must prove where it came from.
 *
 * Request pipeline, in order:
 *   security headers -> no-store -> health -> global rate limit
 *   -> [intake: its own CORS, JSON only, 16kb, router]
 *   -> dashboard CORS -> CSRF origin check -> cookies -> JSON 32kb -> routers
 *   -> 404 -> error handler
 */
import path from 'node:path';
import { existsSync } from 'node:fs';

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import { env } from './env';
import { errorHandler, notFoundHandler } from './lib/errors';
import { makeOriginMatcher } from './lib/origins';
import { noStore, permissionsPolicy, requireJsonBody, verifyOrigin } from './lib/security';
import { authRouter } from './auth/routes';
import { eventsRouter } from './events/routes';
import { intakeRouter } from './intake/routes';
import { portalRouter } from './portal/routes';

export const app = express();

// Don't advertise "I am Express" in every response header.
app.disable('x-powered-by');

// Trust X-Forwarded-For only for the number of proxies really in front of us
// (Render = 1). Wrong in either direction breaks the per-IP rate limits: too
// few and every visitor shares the proxy's IP; too many and anyone can fake theirs.
app.set('trust proxy', env.trustProxy === 0 ? false : env.trustProxy);

// Plain key=value query strings only - no nested objects or arrays from the URL.
app.set('query parser', 'simple');

/**
 * Security headers, set explicitly rather than by helmet's defaults so the
 * policy is visible and reviewable. The CSP matters most when this server also
 * serves the dashboard HTML (CLIENT_DIST); for JSON it is belt-and-braces.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"], // no inline onclick="" handlers
        // 'unsafe-inline' for STYLES only - low risk. Scripts stay same-origin.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"], // no <object>/<embed> - a classic XSS vector
        frameAncestors: ["'none'"], // may not be framed (clickjacking)
        formAction: ["'self'"],
        ...(env.isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // Leak nothing about where a user came from.
    referrerPolicy: { policy: 'no-referrer' },
    // HSTS only makes sense over real HTTPS, i.e. production.
    hsts: env.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  }),
);
app.use(permissionsPolicy);

// Nothing under /api may be cached by a browser or a proxy.
app.use('/api', noStore);

/**
 * Is the server up? Public, harmless, and open to any origin so a status page
 * on another site can read it. Kept before the rate limiter so monitoring
 * never trips it. The environment name is not revealed in production.
 */
app.get('/api/health', cors(), (_req, res) => {
  res.json({
    ok: true,
    service: 'systemui-server',
    ...(env.isProduction ? {} : { env: env.NODE_ENV }),
    time: new Date().toISOString(),
  });
});

/**
 * A broad per-IP ceiling over the whole API. Login and intake have their own,
 * much tighter limits on top; this one is a backstop against a machine
 * hammering any other endpoint (e.g. trying ids one by one).
 */
const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  message: { error: 'Too many requests' },
});
app.use('/api', globalApiLimiter);

// ===========================================================================
//  PUBLIC WORLD: intake. Mounted first so nothing below can leak into it.
// ===========================================================================

/** Invitation-site origins allowed to post (exact, "https://*.domain", or "*"). */
const intakeOriginAllowed = makeOriginMatcher(env.intakeAllowedOrigins);

/**
 * CORS for intake only. No credentials: the invitation site must never be able
 * to send or receive our cookie. A browser on an unlisted origin gets no
 * allow-origin header, so its request is blocked before any RSVP is sent.
 */
const intakeCors = cors({
  origin(origin, callback) {
    // No Origin header = server-to-server or a tool like curl, which CORS does
    // not govern. Allowed; the token is still required.
    if (!origin) {
      callback(null, true);
      return;
    }
    callback(null, intakeOriginAllowed(origin));
  },
  credentials: false,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  maxAge: 600,
});

app.use(
  '/api/intake',
  intakeCors,
  requireJsonBody,
  express.json({ limit: '16kb', strict: true }),
  intakeRouter,
);

// ===========================================================================
//  PRIVATE WORLD: the dashboard API. Cookie-based, locked to the dashboard.
// ===========================================================================

/**
 * DASHBOARD_ORIGIN may list exact origins or "https://*.domain" wildcards.
 * This side is CREDENTIALED: a wildcard lets every such subdomain act with the
 * admin's cookie, and "*" is refused outright in production (see env.ts).
 */
const dashboardOriginAllowed = makeOriginMatcher(env.dashboardOrigins);

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header = same-origin or a non-browser caller.
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, dashboardOriginAllowed(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    // Lets the dashboard read the CSV's filename across origins.
    exposedHeaders: ['Content-Disposition'],
    maxAge: 600,
  }),
);

// CSRF: every state-changing request must come from a dashboard origin (or
// this server itself). See lib/security.ts for why CORS alone is not enough.
app.use(verifyOrigin(dashboardOriginAllowed));

app.use(cookieParser());
app.use(express.json({ limit: '32kb', strict: true }));

app.use('/api/auth', authRouter);
app.use('/api/events', eventsRouter);
app.use('/api/my', portalRouter);

// Any /api/* path we don't recognise ends here as a clean JSON 404.
app.use('/api', notFoundHandler);

// ===========================================================================
//  OPTIONAL: serve the built dashboard from this same server (production).
//  One origin => cookies and CSP are simplest and safest. Off unless set.
// ===========================================================================

export const clientDist = env.CLIENT_DIST ? path.resolve(process.cwd(), env.CLIENT_DIST) : '';
export const servingClient = Boolean(clientDist && existsSync(clientDist));

if (servingClient) {
  app.use(express.static(clientDist, { dotfiles: 'ignore', index: false }));
  // Single-page-app fallback: any non-API GET returns index.html so the
  // browser-side router can handle it.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else if (env.CLIENT_DIST) {
  console.warn(`  WARNING: CLIENT_DIST is set but does not exist: ${clientDist}`);
}

app.use(notFoundHandler);
app.use(errorHandler);
