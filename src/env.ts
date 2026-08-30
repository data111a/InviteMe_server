/**
 * Reads and checks the .env file.
 *
 * Nothing else in the app reads process.env directly. Everything imports `env`
 * from here, so a typo or a missing secret is caught once, at startup, with a
 * readable message - instead of blowing up in the middle of a request later.
 */
import 'dotenv/config';
import { z } from 'zod';

/** "http://localhost:5173" is an origin. "http://localhost:5173/app" is not. */
const origin = z
  .string()
  .trim()
  .regex(
    /^https?:\/\/[^/\s]+$/,
    'must look like http://localhost:5173 or https://example.com (no trailing slash, no path)',
  );

/** An origin (or wildcard subdomain), OR a bare "*" that allows ALL origins.
 *  Use "*" for local testing only — never in production. */
const originOrStar = z.union([z.literal('*'), origin]);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),

  JWT_SECRET: z.string().min(32, 'must be at least 32 characters - see .env.example for how to generate one'),
  JWT_EXPIRES_IN: z.string().trim().min(1).default('7d'),

  DASHBOARD_ORIGIN: originOrStar,
  // One comma-separated string in .env -> a clean, validated list of origins.
  // Each entry is checked with the same `origin` rule as DASHBOARD_ORIGIN, so a
  // trailing slash or stray path is rejected at startup with a readable message -
  // instead of silently failing the exact-match CORS check on every request.
  INTAKE_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(originOrStar)),

  ADMIN_USERNAME: z.string().trim().min(3, 'must be at least 3 characters'),
  ADMIN_PASSWORD: z.string().min(10, 'must be at least 10 characters'),

  // --- MongoDB Atlas: where all data now lives ---
  // The full connection string from Atlas (Connect -> Drivers). Keep it secret:
  // it contains the database user's password.
  MONGODB_URI: z
    .string()
    .trim()
    .regex(
      /^mongodb(\+srv)?:\/\/.+/,
      'must be a MongoDB connection string starting with mongodb+srv:// or mongodb://',
    ),
  // The database name inside the cluster. Created automatically on first write.
  MONGODB_DB: z.string().trim().min(1).default('inviteme'),

  // Legacy JSON store. Only used by "npm run migrate:mongo" to read the old
  // db.json and import it into Atlas. The running server no longer uses it.
  DATA_FILE: z.string().trim().min(1).default('./data/db.json'),

  // Optional. If set to the dashboard's built folder (e.g. ../client/dist),
  // this server also serves the dashboard, so the whole app runs on ONE origin
  // in production - which makes cookies and CSP simplest and safest. Leave empty
  // for API-only (the default, and what dev uses).
  CLIENT_DIST: z.string().trim().default(''),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((issue) => {
    const name = issue.path.join('.') || '(unknown)';
    const reason = issue.message === 'Required' ? 'is missing' : issue.message;
    return `    ${name.padEnd(24)} ${reason}`;
  });

  console.error(
    [
      '',
      '  Cannot start: your .env file needs attention.',
      '',
      ...lines,
      '',
      `  Fix these in:  ${process.cwd()}\\.env`,
      '  If you have no .env yet, copy .env.example to .env and fill it in.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',

  /** Already parsed and validated into a clean list of origins (see the schema above). */
  intakeAllowedOrigins: raw.INTAKE_ALLOWED_ORIGINS,
} as const;

export type Env = typeof env;
