/**
 * Reads and checks the environment.
 *
 * Nothing else in the app reads process.env directly. Everything imports `env`
 * from here, so a typo, a missing secret or an INSECURE production setting is
 * caught once, at startup, with a readable message - instead of blowing up (or
 * silently running wide open) in the middle of a request later.
 */
import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

/** "http://localhost:5173" is an origin. "http://localhost:5173/app" is not. */
const origin = z
  .string()
  .trim()
  .regex(
    /^https?:\/\/[^/\s]+$/,
    'must look like http://localhost:5173 or https://example.com (no trailing slash, no path)',
  );

/** An origin (or wildcard subdomain "https://*.domain"), OR a bare "*" = allow all. */
const originOrStar = z.union([z.literal('*'), origin]);

/** One comma-separated string -> a clean, validated list of origins. */
const originList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(originOrStar));

/** Treat "KEY=" (empty) the same as not set, so optional settings stay optional. */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const DURATION = /^(\d+)\s*([smhd])$/;
const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86_400 } as const;

/** "12h" -> 43200. null if the format is not understood. */
function durationSeconds(value: string): number | null {
  const m = DURATION.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * UNIT_SECONDS[m[2] as keyof typeof UNIT_SECONDS];
}

function isLocalOrigin(value: string): boolean {
  const host = value.replace(/^https?:\/\//, '').split(':')[0] ?? '';
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(4000),

    JWT_SECRET: z
      .string()
      .min(32, 'must be at least 32 characters - see .env.example for how to generate one')
      .refine((s) => new Set(s).size >= 12, 'looks too predictable - generate a random one (see .env.example)'),
    // Short sessions limit the damage of a stolen cookie. 5 minutes .. 30 days.
    JWT_EXPIRES_IN: z
      .string()
      .trim()
      .default('12h')
      .refine((v) => {
        const s = durationSeconds(v);
        return s !== null && s >= 300 && s <= 30 * 86_400;
      }, 'must look like 30m, 12h or 7d (between 5 minutes and 30 days)'),

    // Where the dashboard runs. Comma-separated for more than one, e.g.
    // "https://app.inviteme.ge,http://localhost:5273". This side is CREDENTIALED.
    DASHBOARD_ORIGIN: originList.refine((l) => l.length > 0, 'must list at least one dashboard origin'),
    // Invitation sites that may POST RSVPs. Cookie-less, so "*" is tolerable here.
    INTAKE_ALLOWED_ORIGINS: originList,

    // Used ONLY by `npm run seed`. The running server never needs the admin's
    // plaintext password, so leave these out of the production environment.
    ADMIN_USERNAME: z.preprocess(blankToUndefined, z.string().trim().min(3).optional()),
    ADMIN_PASSWORD: z.preprocess(blankToUndefined, z.string().optional()),

    // --- MongoDB Atlas ---
    MONGODB_URI: z
      .string()
      .trim()
      .regex(
        /^mongodb(\+srv)?:\/\/.+/,
        'must be a MongoDB connection string starting with mongodb+srv:// or mongodb://',
      ),
    MONGODB_DB: z.string().trim().min(1).default('inviteme'),

    // Legacy JSON store, read only by `npm run migrate:mongo`.
    DATA_FILE: z.string().trim().min(1).default('./data/db.json'),

    // Optional: serve the built dashboard from this server (single origin).
    CLIENT_DIST: z.string().trim().default(''),

    // --- optional hardening knobs ---
    // Cookie SameSite. Default: "none" in production (dashboard on another site),
    // "lax" in development. Once the dashboard and API share a site
    // (app.inviteme.ge + api.inviteme.ge), set this to "lax" - it is safer.
    COOKIE_SAMESITE: z.preprocess(blankToUndefined, z.enum(['lax', 'strict', 'none']).optional()),
    // How many reverse proxies sit in front of us (Render = 1). Rate limits key
    // on the real client IP only when this is right.
    TRUST_PROXY: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(10).optional()),
    // Cloudflare Turnstile secret. When set, every RSVP must carry a valid
    // captchaToken. Leave empty to rely on the honeypot + rate limits.
    TURNSTILE_SECRET: z.preprocess(blankToUndefined, z.string().trim().min(1).optional()),
    // Hard ceiling on stored answers per event (stops a leaked token filling the DB).
    MAX_ANSWERS_PER_EVENT: z.coerce.number().int().min(1).max(100_000).default(2000),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV !== 'production') return;

    if (e.DASHBOARD_ORIGIN.includes('*')) {
      ctx.addIssue({
        code: 'custom',
        path: ['DASHBOARD_ORIGIN'],
        message: '"*" is not allowed in production (it lets ANY site act as a signed-in admin) - list your dashboard origin(s)',
      });
    }
    for (const o of e.DASHBOARD_ORIGIN) {
      if (o.startsWith('http://') && !isLocalOrigin(o)) {
        ctx.addIssue({
          code: 'custom',
          path: ['DASHBOARD_ORIGIN'],
          message: `${o} must use https:// in production (plain http is only allowed for localhost)`,
        });
      }
    }
    if (e.MONGODB_URI.startsWith('mongodb://') && !/[?&](tls|ssl)=true/i.test(e.MONGODB_URI)) {
      ctx.addIssue({
        code: 'custom',
        path: ['MONGODB_URI'],
        message: 'must use TLS in production (mongodb+srv://, or add tls=true)',
      });
    }
  });

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((issue) => {
    const name = issue.path.join('.') || '(unknown)';
    const reason = /received undefined/.test(issue.message) ? 'is missing' : issue.message;
    return `    ${name.padEnd(24)} ${reason}`;
  });

  console.error(
    [
      '',
      '  Cannot start: your environment needs attention.',
      '',
      ...lines,
      '',
      `  Fix these in:  ${path.join(process.cwd(), '.env')} (or your host's environment settings)`,
      '  If you have no .env yet, copy .env.example to .env and fill it in.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const raw = parsed.data;
const isProduction = raw.NODE_ENV === 'production';
const cookieSameSite = raw.COOKIE_SAMESITE ?? (isProduction ? 'none' : 'lax');

export const env = {
  ...raw,
  isProduction,

  /** Validated list of dashboard origins (credentialed CORS + CSRF check). */
  dashboardOrigins: raw.DASHBOARD_ORIGIN,
  /** Validated list of invitation-site origins (cookie-less intake CORS). */
  intakeAllowedOrigins: raw.INTAKE_ALLOWED_ORIGINS,

  cookieSameSite,
  /** Secure is mandatory in production and whenever SameSite=None. */
  cookieSecure: isProduction || cookieSameSite === 'none',

  /** Proxy hops to trust. Render sets RENDER=true; one hop there by default. */
  trustProxy: raw.TRUST_PROXY ?? (isProduction || process.env.RENDER ? 1 : 0),

  jwtTtlSeconds: durationSeconds(raw.JWT_EXPIRES_IN) ?? 12 * 3600,
} as const;

export type Env = typeof env;
