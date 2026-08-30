# Security — what's protected, what's left

Plain-language summary after the Phase 8 hardening pass. Two lists: what the app
already does for you, and what still needs doing before real guest data goes in.

---

## ✅ Protected now

### Who can get in
- **Passwords are never stored.** Only a bcrypt hash (cost 12, ~0.5s per check).
  Even holding `db.json`, nobody can read a password.
- **Logins are throttled** — 5 wrong tries per 15 minutes per IP.
- **No username leak.** A wrong password and an unknown username give the exact
  same reply, in the same amount of time (a decoy hash burns the same ~0.5s).
- **Minimum password length** of 10 characters for every account, admin and client.

### Staying in
- **The login lives in a cookie the page's JavaScript cannot read** (httpOnly).
  An injected script can't steal your session.
- **In production the cookie is HTTPS-only** (Secure) — verified.
- **`SameSite=Lax`** stops another website from making your browser act as you.
- **The token only holds your user id.** Your role and which event you may see
  are re-checked from the server on every request, so a stolen token can't be
  edited to say "admin", and deleting an account ends its session immediately.

### Who can see what
- **Clients are boxed into their own event — structurally.** Their routes have
  no event id to tamper with; the server derives it from their login. Confirmed
  they get 403 on every admin route and cannot reach another event's answers.
- **The client never receives the intake token** (that's the secret for *sending*
  RSVPs) or any password.

### The public intake door
- **Its own separate CORS**, with no cookies — the invitation site can post an
  RSVP but can never touch an admin route or your session.
- **Only listed origins** may post from a browser (`INTAKE_ALLOWED_ORIGINS`).
- **A honeypot** silently swallows obvious bots.
- **Two rate limits** — per IP and per token.
- **Size-capped at 16 KB**, field-count capped, every value cleaned of control
  characters and dangerous keys (`__proto__` etc.).
- **One-click token rotation** instantly kills a leaked token.
- **A captcha slot** is wired in, ready to switch on (`intake/captcha.ts`).

### The data & the code
- **No SQL anywhere** — nothing to inject into. All data goes through one store
  module.
- **Every admin input is validated with Zod** before use.
- **Errors say nothing useful to an attacker** — no stack traces, no internals;
  malformed JSON and oversized bodies get clean, generic replies.
- **A global 300/min per-IP ceiling** on the whole API as a backstop.
- **Locked-down headers** (helmet): a strict Content-Security-Policy,
  `frame-ancestors 'none'` (can't be embedded/clickjacked), `object-src 'none'`,
  no referrer leakage, and HSTS in production.
- **CSV export is injection-safe** — a value like `=cmd()` can't run as a formula
  when the file is opened in Excel.
- **The server refuses to start** on a corrupt data file rather than losing data.

### Why there's no separate CSRF token
The combination already covers it: state-changing calls are JSON POST/PATCH/DELETE,
which a hostile site can't forge cross-origin without tripping our CORS, and the
`SameSite=Lax` cookie isn't sent on cross-site requests anyway.

---

## ⚠️ Still to do before real client data

1. **Serve it over HTTPS.** Everything cookie-related assumes it in production.
   Easiest path: put it behind a host that terminates HTTPS (Caddy, nginx,
   Cloudflare, or a platform like Render/Railway). The app already turns on
   Secure cookies + HSTS when `NODE_ENV=production`.

2. **Move off the single JSON file — the real risk.** It works, but it's one file
   with one auto-overwritten backup and no history. One bad disk or fat-fingered
   delete loses every RSVP. Options, in order of effort:
   - **Cheapest:** an automatic scheduled copy of `db.json` somewhere safe.
   - **Proper:** move to SQLite or PostgreSQL. Because all data access goes
     through one module, this is a rewrite of that one file — nothing else.

3. **Turn on a captcha** if you get spam. The slot is ready; drop in Cloudflare
   Turnstile or hCaptcha in `intake/captcha.ts`.

4. **Set real production values in `.env`:** a fresh long `JWT_SECRET`, a strong
   `ADMIN_PASSWORD`, and your real invitation-site domain(s) in
   `INTAKE_ALLOWED_ORIGINS` and `DASHBOARD_ORIGIN`.

5. **Back up before every deploy.** Copy `db.json` first. Always.

6. **Consider single-origin hosting** (set `CLIENT_DIST`) so the dashboard and API
   share one address — simpler and it sidesteps every cross-site cookie subtlety.
