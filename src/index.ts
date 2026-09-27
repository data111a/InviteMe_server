/**
 * The backend entry point: connect to MongoDB, then start listening.
 *
 * The app itself (routes and every security layer) lives in app.ts. This file
 * owns only the process: the database connection, the HTTP server and its
 * timeouts, and a clean shutdown when the host stops us.
 */
import { app, clientDist, servingClient } from './app';
import { env } from './env';
import { redactSecrets } from './lib/redact';
import { closeMongo, initStore, mongoTarget } from './store';
import { captchaEnabled } from './intake/captcha';

/** Settings that are allowed but deserve a loud reminder in the log. */
function startupWarnings(): string[] {
  const warnings: string[] = [];
  if (env.dashboardOrigins.includes('*')) {
    warnings.push('DASHBOARD_ORIGIN is "*": ANY site can act as a signed-in user (development only).');
  }
  if (env.isProduction && env.dashboardOrigins.some((o) => o.startsWith('http://'))) {
    warnings.push('DASHBOARD_ORIGIN includes a plain-http (localhost) origin - remove it once testing is done.');
  }
  if (env.intakeAllowedOrigins.includes('*')) {
    warnings.push('INTAKE_ALLOWED_ORIGINS is "*": any website can submit RSVPs (the token is still required).');
  }
  if (env.isProduction && !captchaEnabled()) {
    warnings.push('No captcha (TURNSTILE_SECRET) - RSVPs rely on the honeypot + rate limits.');
  }
  if (env.isProduction && env.cookieSameSite === 'none') {
    warnings.push(
      'Login cookie is cross-site (SameSite=None). Safari blocks these - host the dashboard and API on the same site and set COOKIE_SAMESITE=lax.',
    );
  }
  if (env.isProduction && env.jwtTtlSeconds > 86_400) {
    warnings.push(`Sessions last ${env.JWT_EXPIRES_IN} - consider JWT_EXPIRES_IN=12h.`);
  }
  if (env.isProduction && (env.ADMIN_PASSWORD || env.ADMIN_USERNAME)) {
    warnings.push('ADMIN_USERNAME/ADMIN_PASSWORD are set but only `npm run seed` needs them - remove them from the host.');
  }
  return warnings;
}

async function start(): Promise<void> {
  // Connect BEFORE listening: an unreachable cluster stops us here with an
  // explanation, instead of looking healthy and failing mid-request.
  await initStore();

  const server = app.listen(env.PORT, () => {
    console.log('');
    console.log(`  SystemUI server running`);
    console.log(`    http://localhost:${env.PORT}/api/health`);
    console.log(`    mode:        ${env.NODE_ENV}`);
    console.log(`    data:        MongoDB ${mongoTarget()}`);
    console.log(`    dashboard:   ${env.dashboardOrigins.join(', ')}`);
    console.log(`    intake ok:   ${env.intakeAllowedOrigins.join(', ') || '(none set)'}`);
    console.log(`    cookie:      SameSite=${env.cookieSameSite}${env.cookieSecure ? ', Secure' : ''}`);
    console.log(`    trust proxy: ${env.trustProxy}`);
    if (servingClient) console.log(`    serving:     ${clientDist} (single-origin mode)`);
    for (const w of startupWarnings()) console.log(`    WARNING:     ${w}`);
    console.log('');
  });

  // Slow-client protection. Keep-alive slightly longer than the host's load
  // balancer so it never reuses a connection we just closed (that shows up as
  // random 502s); headers and whole requests get hard deadlines.
  server.keepAliveTimeout = 61_000;
  server.headersTimeout = 62_000;
  server.requestTimeout = 65_000;

  // Render (and most hosts) send SIGTERM before replacing an instance: finish
  // in-flight requests, close the database, then exit.
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`  ${signal} received - shutting down gracefully`);
    server.close(() => {
      void closeMongo().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

// A bug that escapes every handler must not leave a half-broken process
// serving requests. Log it (credentials stripped) and let the host restart us.
process.on('unhandledRejection', (reason) => {
  const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  console.error('[unhandledRejection]', redactSecrets(detail));
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', redactSecrets(err.stack ?? err.message));
  process.exit(1);
});

start().catch((err: unknown) => {
  console.error('');
  console.error(`  Server did not start.`);
  console.error('');
  console.error(`  ${redactSecrets(err instanceof Error ? err.message : String(err))}`);
  console.error('');
  console.error(`  If this is a MongoDB connection error, check that:`);
  console.error(`    - MONGODB_URI is the full Atlas string (with the password filled in)`);
  console.error(`    - this machine's IP is allow-listed in Atlas (Network Access)`);
  console.error(`    - the database user and password are correct`);
  console.error('');
  process.exit(1);
});
