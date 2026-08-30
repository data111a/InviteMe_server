/**
 * The backend entry point.
 *
 * The important structural idea here is that there are TWO different worlds on
 * this one server, and they must not bleed into each other:
 *
 *   /api/intake/*   the public door. Reachable from your invitation site, which
 *                   is a DIFFERENT website. Cookie-less. Small body limit.
 *
 *   everything else the private dashboard API. Reachable only from the dashboard
 *                   origin, and only WITH the login cookie.
 *
 * Intake is mounted first, with its own CORS, so the credentialed dashboard
 * CORS never touches it. A hostile page can post an RSVP; it can never reach an
 * admin route or ride along on your session.
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
import { initStore, mongoTarget } from './store';
import { authRouter } from './auth/routes';
import { eventsRouter } from './events/routes';
import { intakeRouter } from './intake/routes';
import { portalRouter } from './portal/routes';

const app = express();

// Don't advertise "I am Express" in every response header.
app.disable('x-powered-by');

// Only trust the "X-Forwarded-For" header when a real reverse proxy sits in
// front of us. Trusting it in dev would let anyone fake their IP and slip past
// the rate limits.
if (env.isProduction) app.set('trust proxy', 1);

/**
 * Security headers, set explicitly rather than by helmet's defaults so the
 * policy is visible and reviewable.
 *
 * The Content-Security-Policy matters most when this server also serves the
 * dashboard HTML (CLIENT_DIST, below). For pure JSON responses it is harmless
 * belt-and-braces.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        // The app talks only to its own origin. If you ever host the dashboard
        // and API on different origins, add the API origin here.
        connectSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // 'unsafe-inline' for STYLES only - low risk, and avoids breaking the
        // occasional inline style. Scripts stay locked to same-origin files.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"], // no <object>/<embed> - a classic XSS vector
        frameAncestors: ["'none'"], // this app may not be framed (clickjacking)
        formAction: ["'self'"],
        ...(env.isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // We are an API + SPA host, not a document site; this referrer policy leaks
    // the least.
    referrerPolicy: { policy: 'no-referrer' },
    // HSTS only makes sense over real HTTPS, i.e. production.
    hsts: env.isProduction,
  }),
);

/** Is the server up? Kept before the rate limiter so monitoring never trips it. */
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'systemui-server',
    env: env.NODE_ENV,
    time: new Date().toISOString(),
  });
});

/**
 * A broad per-IP ceiling over the whole API. Login and intake have their own,
 * much tighter limits on top of this; this one is a backstop against a machine
 * hammering any other endpoint (e.g. trying event ids one by one).
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

/**
 * Which browser origins may post an RSVP. Built once from INTAKE_ALLOWED_ORIGINS,
 * which accepts exact origins ("https://invites.inviteme.ge") and wildcard
 * subdomains ("https://*.inviteme.ge", i.e. all subdomains of inviteme.ge).
 * Safe to wildcard here because intake is cookie-less - no session to ride on.
 */
const intakeOriginAllowed = makeOriginMatcher(env.intakeAllowedOrigins);

/**
 * CORS for intake only. Note what is NOT here: credentials. The invitation site
 * is a different website and must never be able to send or receive our cookie.
 * A browser on an origin we did not list gets no allow-origin header back, so
 * its request is blocked before any RSVP is sent.
 */
const intakeCors = cors({
  origin(origin, callback) {
    // No Origin header = a server-to-server call or a tool like curl, which
    // CORS does not govern. Allow it; the token is still required.
    if (!origin) {
      callback(null, true);
      return;
    }
    callback(null, intakeOriginAllowed(origin));
  },
  credentials: false,
  methods: ['POST', 'OPTIONS'],
});

app.use(
  '/api/intake',
  intakeCors,
  // Intake bodies are tiny. A far smaller cap than the dashboard's keeps a
  // flood of large payloads cheap to reject.
  express.json({ limit: '16kb' }),
  intakeRouter,
);

// ===========================================================================
//  PRIVATE WORLD: the dashboard API. Cookie-based, locked to the dashboard.
// ===========================================================================

// CORS = the browser rule for which websites may call this server. This one
// covers the dashboard only, and allows the login cookie through.
//
// DASHBOARD_ORIGIN may be an exact origin ("https://dashboard.inviteme.ge") or
// a wildcard ("https://*.inviteme.ge"). SECURITY NOTE: this side is CREDENTIALED,
// so a wildcard lets EVERY subdomain make requests carrying the admin's cookie.
// Prefer the single exact dashboard origin unless you trust every subdomain.
const dashboardOriginAllowed = makeOriginMatcher([env.DASHBOARD_ORIGIN]);

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header = same-origin (single-origin mode) or a non-browser
      // caller; CORS does not apply, so let it through.
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, dashboardOriginAllowed(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  }),
);

app.use(cookieParser());
app.use(express.json({ limit: '32kb' }));

app.use('/api/auth', authRouter);
app.use('/api/events', eventsRouter);
app.use('/api/my', portalRouter);

// Any /api/* path we don't recognise ends here as a clean JSON 404.
app.use('/api', notFoundHandler);

// ===========================================================================
//  OPTIONAL: serve the built dashboard from this same server (production).
//  One origin => cookies and CSP are simplest and safest. Off unless set.
// ===========================================================================

const clientDist = env.CLIENT_DIST ? path.resolve(process.cwd(), env.CLIENT_DIST) : '';

if (clientDist && existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // Single-page-app fallback: any non-API path returns index.html so the
  // browser-side router can handle it.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else if (env.CLIENT_DIST) {
  console.warn(`  WARNING: CLIENT_DIST is set but does not exist: ${clientDist}`);
}

app.use(notFoundHandler);
app.use(errorHandler);

/**
 * Connect to MongoDB Atlas BEFORE listening. If the cluster is unreachable we
 * stop here with an explanation - far better than starting up, looking healthy,
 * and failing halfway through somebody's request.
 */
async function start(): Promise<void> {
  await initStore();

  app.listen(env.PORT, () => {
    console.log('');
    console.log(`  SystemUI server running`);
    console.log(`    http://localhost:${env.PORT}/api/health`);
    console.log(`    mode:      ${env.NODE_ENV}`);
    console.log(`    data:      MongoDB ${mongoTarget()}`);
    console.log(`    dashboard: ${env.DASHBOARD_ORIGIN}`);
    console.log(`    intake ok: ${env.intakeAllowedOrigins.join(', ') || '(none set)'}`);
    if (clientDist && existsSync(clientDist)) {
      console.log(`    serving:   ${clientDist} (single-origin mode)`);
    }
    console.log('');
  });
}

start().catch((err: unknown) => {
  console.error('');
  console.error(`  Server did not start.`);
  console.error('');
  console.error(`  ${err instanceof Error ? err.message : String(err)}`);
  console.error('');
  console.error(`  If this is a MongoDB connection error, check that:`);
  console.error(`    - MONGODB_URI in .env is the full Atlas string (with the password filled in)`);
  console.error(`    - your current IP is allow-listed in Atlas (Network Access)`);
  console.error(`    - the database user and password are correct`);
  console.error('');
  process.exit(1);
});
