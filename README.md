# InviteMe — RSVP Server

The backend behind the InviteMe invitation sites. It receives guest RSVPs, stores them
in **MongoDB Atlas**, and serves the admin + per-event client dashboards.
**Node + Express + TypeScript.**

See **[PLAN.md](PLAN.md)** for the design and **[SECURITY.md](SECURITY.md)** for what's
protected and the go-live checklist.

## Setup

```bash
npm install
cp .env.example .env       # then fill in the values (see below)
npm run migrate:mongo      # optional: import an existing data/db.json into Atlas
npm run seed               # create the admin login from .env
npm run db:show            # confirm what's in the database (no secrets shown)
```

## Environment (`.env`)

| Key | What |
|---|---|
| `MONGODB_URI` | Atlas connection string — **secret** (contains the DB password) |
| `MONGODB_DB` | database name (default `inviteme`) |
| `JWT_SECRET` | long random string used to sign login cookies (32+ chars) |
| `JWT_EXPIRES_IN` | session length, default `12h` (5m–30d) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | **seed only** — the running server doesn't need them |
| `DASHBOARD_ORIGIN` | the dashboard URL(s), comma-separated. `*` is refused in production |
| `INTAKE_ALLOWED_ORIGINS` | invitation-site origin(s) allowed to POST RSVPs (comma-separated, no trailing slash) |
| `NODE_ENV` | `development` or `production` (prod: `__Host-` Secure cookies, HSTS, config guards) |
| `CLIENT_DIST` | optional: path to the client's built `dist/` for single-origin hosting |
| `COOKIE_SAMESITE` | optional: `lax` once dashboard + API share a site (default `none` in prod) |
| `TURNSTILE_SECRET` | optional: Cloudflare Turnstile secret — makes RSVPs require a captcha |
| `MAX_ANSWERS_PER_EVENT` | optional: storage cap per event (default 2000) |
| `TRUST_PROXY` | optional: proxy hops in front (default 1 on Render / in production) |

See **[SECURITY.md](SECURITY.md)** for everything the server enforces.

## Run

```bash
npm run dev      # tsx watch → http://localhost:4100
npm run build    # tsc → dist/
npm start        # node dist/index.js (production)
```

## API overview

| | |
|---|---|
| `GET /api/health` | liveness check |
| `POST /api/auth/login` · `/logout` · `GET /api/auth/me` | auth (httpOnly cookie) |
| `GET/POST/PATCH/DELETE /api/events…` | admin: events, answers, CSV, token rotation |
| `GET /api/my/…` | client portal (read-only, scoped to their event) |
| `POST /api/intake/:token` | **public** — invitation sites post guest RSVPs here |

`InviteMe.postman_collection.json` in this repo exercises the whole API.

> The **dashboard client** lives in its own repository.
