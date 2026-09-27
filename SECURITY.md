# Security — what's protected, what's left

What the server does for you, and what you still need to set up on the host.
Verified by an in-process test suite (87 checks) — see the bottom.

---

## ✅ Protected now

### Accounts & passwords
- **Passwords are never stored** — bcrypt hash only (cost 12).
- **Password policy** (NIST 800-63B style): 10+ characters, **at most 72 bytes**
  (bcrypt silently ignores anything longer), not a common password, not
  repetitive, must not contain the username.
- **Brute force is throttled two ways**: 5 failures / 15 min **per IP**, and
  10 failures / 15 min **per account** from any IP (stops botnets guessing "admin").
- **No username leak**: wrong password and unknown user give the same reply in
  the same time (decoy hash).
- The running server **does not need the admin's password** — only
  `npm run seed` does.

### Sessions
- Cookie is **httpOnly** (scripts can't read it). In production it is
  **`__Host-` prefixed + Secure**, so no other site or subdomain can plant or
  overwrite it; cross-site deployments add **Partitioned** (CHIPS).
- JWTs are **HS256-pinned** with issuer + audience checks — `alg: none`,
  other algorithms and foreign tokens are rejected.
- **Signing out really signs out**: the token is revoked server-side (a copied
  cookie dies too). Revocations expire automatically in MongoDB.
- **Changing a password or username signs that user out everywhere**
  (session version).
- Role and event ownership are re-read from the database on **every** request.
- Default session length **12h** (max 30 days).

### Cross-site attacks
- **CSRF**: every state-changing request must come from an allowed dashboard
  origin (or the server itself). Foreign, forged-Referer and `null` origins → 403.
- **CORS**: credentialed CORS only for the listed dashboard origins; intake
  has its own cookie-less CORS. **`DASHBOARD_ORIGIN=*` is refused in
  production**, and production dashboard origins must be `https://`.
- Clickjacking blocked (`frame-ancestors 'none'`), strict CSP, `nosniff`,
  `no-referrer`, Permissions-Policy, HSTS in production.
- API responses are **`Cache-Control: no-store`** — guest data never lands in a
  browser or proxy cache.

### The public intake door
- **JSON only** (415 otherwise) — no form-post spam, no empty submissions.
- Token **format-checked before** any database query; bad/rotated tokens get one
  bland reply.
- **Honeypot**, **per-IP** (20/min) and **per-token** (30/min) rate limits.
- **Captcha**: Cloudflare Turnstile, on when `TURNSTILE_SECRET` is set (fails closed).
- **Storage cap** per event (`MAX_ANSWERS_PER_EVENT`, default 2000) — a leaked
  token can't fill the database.
- Size-capped (16 KB, 60 fields, 2000 chars/value). Guest keys are made
  **MongoDB-safe** (`$where` → `where`, `a.b` → `a_b`), prototype keys dropped,
  nesting flattened, control characters stripped.

### Data & errors
- No string-built queries: every URL id is **format-validated** and every body is
  **Zod-validated** before use (no NoSQL operator injection).
- Admin "delete answer" is **scoped to its event**.
- The client portal is structurally read-only and never sees intake tokens.
- CSV export is **formula-injection safe**.
- Errors never reveal internals; **credentials are redacted** from all logs.
- **Audit log**: sign-ins (and failures), sign-outs, token rotations,
  credential changes, deletions and blocked CSRF attempts are logged as JSON.
- MongoDB must use **TLS** in production; unreachable DB = refuse to start.
- Server timeouts (slow-client protection), graceful shutdown, crash handlers.
- `npm audit`: **0 vulnerabilities**.

---

## ⚠️ Set these up on the host

1. **Environment on Render** (Environment tab):
   - `NODE_ENV=production`
   - `DASHBOARD_ORIGIN` = your dashboard's real URL(s), comma-separated — **not
     `*`** (the server will refuse to start). Add `http://localhost:5273` only
     while you test from your machine, then remove it.
   - `JWT_SECRET` = fresh random value (see `.env.example`)
   - `MONGODB_URI`, `MONGODB_DB`, `INTAKE_ALLOWED_ORIGINS`
   - **Remove** `ADMIN_USERNAME` / `ADMIN_PASSWORD` from the host.
2. **MongoDB Atlas**: give the app's database user **readWrite on the
   `inviteme` database only** (not Atlas admin), and keep a strong password.
3. **Best cookie setup**: host the dashboard and API on the **same site** with a
   custom domain (e.g. `app.inviteme.ge` + `api.inviteme.ge`) and set
   `COOKIE_SAMESITE=lax`. Cross-site cookies (two different `*.onrender.com`
   apps) are **blocked by Safari/iOS**, so logins fail there.
4. **Turn on the captcha** (`TURNSTILE_SECRET`) before sharing invitations widely.
5. **Backups**: the free Atlas tier has none — upgrade or schedule `mongodump`.
6. Rate limits are kept **in memory per instance**. Fine for one Render
   instance; if you ever scale out, move them to a shared store.

---

## Verification

Run without opening a port (in-process request injection, isolated test
database that is dropped afterwards): 72 attack-style checks against the app
(CSRF, CORS, JWT tampering / `alg:none` / wrong audience / expiry, logout and
password-change revocation, brute-force limits, NoSQL key injection, scoped
deletes, storage cap, malformed/oversized bodies, headers) plus 15
production-mode configuration guards.
